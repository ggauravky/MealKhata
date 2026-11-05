import { createHash } from 'node:crypto';
import { validateProductionCutoverPlan, verifyProductionActionApproval } from './v3ProductionGate.service.js';

const STEPS = Object.freeze([
  'read-source-inventory', 'archive-source', 'restore-recovery', 'create-target',
  'apply-history', 'freeze-source-writes', 'archive-frozen-source',
  'replay-final-meals', 'configure-financial-boundary', 'configure-operations',
  'deploy-backend', 'deploy-frontend', 'switch-connection', 'open-writes',
]);
const SAFE_CHECKPOINT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DURABLE_WRITE = { w: 'majority', j: true };
const nonceDigest = nonce => createHash('sha256').update(nonce).digest('hex');

/** The collection belongs to a separate release-control database, never the source or target. */
export function createMongoApprovalJournal(collection) {
  if (!collection?.insertOne || !collection?.listIndexes) throw new Error('A durable approval collection is required');
  return {
    databaseName: collection.dbName,
    async initialize() {
      await collection.createIndex({ planDigest: 1, action: 1 },
        { unique: true, name: 'one_action_per_plan', writeConcern: DURABLE_WRITE });
    },
    async assertReady() {
      const indexes = await collection.listIndexes().toArray().catch(() => []);
      if (!indexes.some(index => index.name === 'one_action_per_plan' && index.unique === true
        && index.key?.planDigest === 1 && index.key?.action === 1)) {
        throw new Error('Approval journal lacks its unique action index');
      }
    },
    async completedActions(planDigest) {
      const rows = await collection.find({ planDigest, status: 'complete' },
        { projection: { action: 1, _id: 0 } }).toArray();
      return new Set(rows.map(row => row.action));
    },
    async reserve({ planDigest, action, nonce, at }) {
      const id = nonceDigest(nonce);
      try {
        await collection.insertOne({ _id: id, planDigest, action, status: 'reserved',
          checkpointId: null, evidenceDigest: null, reservedAt: at },
        { writeConcern: DURABLE_WRITE });
      } catch (error) {
        if (error?.code === 11000) {
          // eslint-disable-next-line preserve-caught-error -- Mongo errors can include credential-bearing connection details.
          throw new Error('Approval nonce or action was already used or reserved');
        }
        // eslint-disable-next-line preserve-caught-error -- Raw database errors must not reach release logs.
        throw new Error('Approval journal reservation failed');
      }
      return id;
    },
    async complete(id, { checkpointId, evidenceDigest, at }) {
      if (!SAFE_CHECKPOINT.test(checkpointId ?? '') || !SHA256.test(evidenceDigest ?? '')) {
        throw new Error('Execution returned an invalid safe checkpoint');
      }
      const result = await collection.updateOne({ _id: id, status: 'reserved' },
        { $set: { status: 'complete', checkpointId, evidenceDigest, completedAt: at } },
        { writeConcern: DURABLE_WRITE });
      if (result.matchedCount !== 1) throw new Error('Approval checkpoint is no longer reserved');
    },
    async fail(id, at) {
      const result = await collection.updateOne({ _id: id, status: 'reserved' },
        { $set: { status: 'failed', failedAt: at, failureCode: 'EXECUTION_FAILED' } },
        { writeConcern: DURABLE_WRITE });
      if (result.matchedCount !== 1) throw new Error('Approval failure checkpoint could not be recorded');
    },
  };
}

/** No Atlas connector or production handler is bundled here. All dependencies are injected. */
export function createV3ProductionController({ trustedAllowlist, observeControlPlane,
  observeConnection, trustedSigners, journal, handlers, log = () => {}, now = () => new Date() }) {
  if (typeof observeControlPlane !== 'function' || typeof observeConnection !== 'function'
    || observeControlPlane === observeConnection || !journal?.reserve || !journal?.assertReady
    || !handlers || typeof log !== 'function') {
    throw new Error('Independent observers, durable journal and trusted handlers are required');
  }
  const allowlist = structuredClone(trustedAllowlist);
  const validatePlan = plan => validateProductionCutoverPlan({ plan,
    trustedAllowlist: allowlist, observedIdentities: allowlist });
  const safeLog = event => { try { log(event); } catch { /* Durable journal remains authoritative. */ } };

  return {
    validatePlan, // Offline plan check only. execute() independently observes all identities again.
    async execute({ plan: inputPlan, action, approval: inputApproval }) {
      const plan = structuredClone(inputPlan);
      const approval = structuredClone(inputApproval);
      const validated = validatePlan(plan);
      const at = now();
      verifyProductionActionApproval({ approval, planDigest: validated.planDigest,
        action, trustedSigners, now: at });
      if (new Date(approval.expiresAt).getTime() - at.getTime() > 5 * 60_000) {
        throw new Error('Production approval must expire within five minutes');
      }
      if (!STEPS.includes(action) && action !== 'rollback-connection') {
        throw new Error('Unknown production cutover step');
      }
      if (typeof handlers[action] !== 'function') throw new Error('Trusted production step handler is unavailable');
      if (!journal.databaseName || ['source', 'recovery', 'target']
        .some(role => validated[role].databaseName === journal.databaseName)) {
        throw new Error('Approval journal must use a separate release-control database');
      }
      await journal.assertReady();
      const observedControlPlane = {};
      const observedConnection = {};
      try {
        for (const role of ['source', 'recovery', 'target']) {
          observedControlPlane[role] = await observeControlPlane(role);
          observedConnection[role] = await observeConnection(role);
        }
      } catch {
        throw new Error('Independent Atlas identity observation failed');
      }
      validateProductionCutoverPlan({ plan, trustedAllowlist: allowlist,
        observedIdentities: observedControlPlane });
      validateProductionCutoverPlan({ plan, trustedAllowlist: allowlist,
        observedIdentities: observedConnection });
      const completed = await journal.completedActions(validated.planDigest);
      const predecessor = action === 'rollback-connection' ? 'switch-connection'
        : STEPS[STEPS.indexOf(action) - 1];
      if (predecessor && !completed.has(predecessor)) {
        throw new Error('A preceding production cutover step is incomplete or out of order');
      }
      const reservation = await journal.reserve({ planDigest: validated.planDigest,
        action, nonce: approval.nonce, at });
      try {
        safeLog({ event: 'v3.cutover.step_reserved', action, planDigest: validated.planDigest });
        const checkpoint = await handlers[action]({ action, plan: validated });
        await journal.complete(reservation, { ...checkpoint, at: now() });
        safeLog({ event: 'v3.cutover.step_complete', action, planDigest: validated.planDigest,
          checkpointId: checkpoint.checkpointId, evidenceDigest: checkpoint.evidenceDigest });
        return { status: 'complete', action, planDigest: validated.planDigest,
          checkpointId: checkpoint.checkpointId, evidenceDigest: checkpoint.evidenceDigest };
      } catch {
        await journal.fail(reservation, now()).catch(() => {});
        safeLog({ event: 'v3.cutover.step_failed', action, planDigest: validated.planDigest });
        throw new Error('Production cutover step failed; inspect the protected checkpoint and stop');
      }
    },
  };
}
