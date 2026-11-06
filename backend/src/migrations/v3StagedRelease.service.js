import { createHash } from 'node:crypto';
import { checksumValue } from './sourceInventory.service.js';
import { validateProductionCutoverPlan, verifyProductionActionApproval } from './v3ProductionGate.service.js';

const A_STEPS = Object.freeze(['read-source-inventory', 'archive-source', 'restore-recovery',
  'create-target', 'apply-history', 'freeze-source-writes', 'archive-frozen-source']);
const B_STEPS = Object.freeze(['replay-final-meals', 'configure-financial-boundary',
  'configure-operations', 'deploy-backend', 'deploy-frontend', 'switch-connection', 'open-writes']);
const SHA = /^[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const EMERGENCY_EVIDENCE_FIELDS = ['outageEvidenceRef', 'outageEvidenceDigest',
  'lastKnownTargetFingerprint', 'outageObservedAt', 'sourceIdentitySha256', 'controlIdentitySha256',
  'previousConfigSha256', 'writesStoppedDigest'];
const WRITE = { w: 'majority', j: true };
const nonceId = value => createHash('sha256').update(value).digest('hex');
const releaseKey = value => `release:${value}`;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => keys.includes(key));
}

function validateExpiry(expiresAt, now, hours) {
  const expiry = new Date(expiresAt);
  if (typeof expiresAt !== 'string' || !Number.isFinite(expiry.getTime())
    || expiry <= now || expiry.getTime() - now.getTime() > hours * 3_600_000) {
    throw new Error('Release phase has an invalid or excessive expiry');
  }
}

function validateStageA(plan, allowlist, now) {
  const keys = ['format', 'releaseId', 'source', 'recovery', 'target', 'financialStartDate',
    'baseArchiveSha256', 'proceduresSha256', 'expiresAt'];
  if (!exactKeys(plan, keys) || plan.format !== 'mealkhata-v3-stage-a-v1'
    || !SAFE.test(plan.releaseId ?? '') || !SHA.test(plan.proceduresSha256 ?? '')
    || (plan.baseArchiveSha256 !== null && !SHA.test(plan.baseArchiveSha256 ?? ''))) {
    throw new Error('Invalid immutable Stage A release plan');
  }
  validateExpiry(plan.expiresAt, now, 24);
  const bridge = { format: 'mealkhata-v3-production-cutover-plan-v1',
    source: plan.source, recovery: plan.recovery, target: plan.target,
    financialStartDate: plan.financialStartDate,
    sourceArchiveSha256: plan.baseArchiveSha256 ?? '0'.repeat(64),
    frozenArchiveSha256: '0'.repeat(64) };
  validateProductionCutoverPlan({ plan: bridge, trustedAllowlist: allowlist,
    observedIdentities: allowlist });
  return checksumValue(plan);
}

function validateStageB(change, release, now) {
  const keys = ['format', 'releaseId', 'stageAPlanDigest', 'source', 'baseArchiveSha256',
    'finalArchiveSha256', 'snapshotSidecarSha256', 'inventoryComparisonSha256',
    'finalMealDeltaSha256', 'frozenInventorySha256', 'freezeAttestationSha256',
    'freezeAt', 'expiresAt', 'unexplainedChanges', 'financialStartDate'];
  if (!exactKeys(change, keys) || change.format !== 'mealkhata-v3-stage-b-amendment-v1'
    || change.releaseId !== release.releaseId
    || change.stageAPlanDigest !== release.stageAPlanDigest
    || checksumValue(change.source) !== checksumValue(release.plan.source)
    || change.financialStartDate !== release.plan.financialStartDate
    || ![change.baseArchiveSha256, change.finalArchiveSha256,
      change.snapshotSidecarSha256, change.inventoryComparisonSha256,
      change.finalMealDeltaSha256, change.frozenInventorySha256,
      change.freezeAttestationSha256].every(value => SHA.test(value ?? ''))
    || !Array.isArray(change.unexplainedChanges) || change.unexplainedChanges.length
    || change.baseArchiveSha256 !== release.actions['archive-source']?.evidenceDigest
    || change.finalArchiveSha256 !== release.actions['archive-frozen-source']?.evidenceDigest
    || change.freezeAttestationSha256 !== release.actions['freeze-source-writes']?.evidenceDigest
    || (release.plan.baseArchiveSha256 != null
      && change.baseArchiveSha256 !== release.plan.baseArchiveSha256)) {
    throw new Error('Frozen amendment changes identity, archive or approved boundary');
  }
  const freeze = new Date(change.freezeAt);
  if (typeof change.freezeAt !== 'string' || !Number.isFinite(freeze.getTime())
    || freeze > now || freeze < release.actions['freeze-source-writes']?.completedAt) {
    throw new Error('Frozen amendment lacks an observed write-freeze checkpoint');
  }
  validateExpiry(change.expiresAt, now, 24);
  return checksumValue({ stageAPlanDigest: release.stageAPlanDigest, amendment: change });
}

function shortApproval(approval, digest, action, signers, now) {
  verifyProductionActionApproval({ approval, planDigest: digest, action,
    trustedSigners: signers, now });
  if (new Date(approval.expiresAt).getTime() - now.getTime() > 5 * 60_000) {
    throw new Error('Release action approval exceeds five minutes');
  }
}

function assertStoredReleaseIntegrity(release) {
  if (!release?.plan || checksumValue(release.plan) !== release.stageAPlanDigest
    || (release.phase === 'B' && (!release.amendment
      || checksumValue({ stageAPlanDigest: release.stageAPlanDigest,
        amendment: release.amendment }) !== release.stageBPlanDigest))) {
    throw new Error('Stored release plan or amendment digest was tampered with');
  }
}

/** One protected collection holds both release lineage and globally unique nonce hashes. */
export function createStagedReleaseJournal({ collection, startSession, observeConnectionIdentity }) {
  if (!collection?.insertOne || typeof startSession !== 'function') {
    throw new Error('A separate durable release-control collection is required');
  }
  async function transaction(work) {
    const session = await startSession();
    try { return await session.withTransaction(() => work(session),
      { readConcern: { level: 'snapshot' }, writeConcern: WRITE }); }
    finally { await session.endSession(); }
  }
  async function consumeNonce(approval, releaseId, action, session) {
    await collection.insertOne({ _id: nonceId(approval.nonce), kind: 'nonce',
      releaseId, action, usedAt: new Date() }, { session });
  }
  return {
    databaseName: collection.dbName,
    ...(typeof observeConnectionIdentity === 'function'
      ? { observeConnectionIdentity: () => observeConnectionIdentity(collection) } : {}),
    async initialize() {
      await collection.createIndex({ kind: 1, releaseId: 1 },
        { name: 'release_lineage', writeConcern: WRITE });
    },
    async assertReady() {
      const indexes = await collection.listIndexes().toArray().catch(() => []);
      if (!indexes.some(index => index.name === 'release_lineage')) {
        throw new Error('Release lineage journal has not been initialized');
      }
    },
    readRelease(releaseId) { return collection.findOne({ _id: releaseKey(releaseId), kind: 'release' }); },
    async create(plan, digest, approval) {
      try {
        return await transaction(async session => {
          await consumeNonce(approval, plan.releaseId, 'approve-preflight-plan', session);
          await collection.insertOne({ _id: releaseKey(plan.releaseId), kind: 'release',
            releaseId: plan.releaseId, phase: 'A', stageAPlanDigest: digest,
            plan, stageAApproval: approval, actions: {}, version: 0 }, { session });
          return digest;
        });
      } catch {
        throw new Error('Release ID already exists or approval nonce was consumed');
      }
    },
    async amend(change, digest, approval) {
      try {
        return await transaction(async session => {
          const release = await collection.findOne({ _id: releaseKey(change.releaseId) }, { session });
          if (!release || release.phase !== 'A' || release.stageAPlanDigest !== change.stageAPlanDigest
            || A_STEPS.some(action => release.actions[action]?.status !== 'complete')) {
            throw new Error('Preflight release is incomplete or already amended');
          }
          await consumeNonce(approval, change.releaseId, 'approve-frozen-amendment', session);
          const updated = await collection.updateOne({ _id: release._id, phase: 'A', version: release.version },
            { $set: { phase: 'B', stageBPlanDigest: digest, amendment: change,
              amendmentApproval: approval }, $inc: { version: 1 } }, { session });
          if (updated.matchedCount !== 1) throw new Error('Release amendment lost its atomic version check');
          return digest;
        });
      } catch {
        throw new Error('Frozen amendment is incomplete, already used or failed');
      }
    },
    async reserve(releaseId, phase, digest, action, approval, predecessor, at,
      emergencyEvidence = null) {
      if (action === 'emergency-rollback-connection'
        ? !exactKeys(emergencyEvidence, EMERGENCY_EVIDENCE_FIELDS)
          || !SAFE.test(emergencyEvidence.outageEvidenceRef ?? '')
          || !Number.isFinite(new Date(emergencyEvidence.outageObservedAt).getTime())
          || EMERGENCY_EVIDENCE_FIELDS.slice(1)
            .filter(field => field !== 'outageObservedAt')
            .some(field => !SHA.test(emergencyEvidence[field] ?? ''))
        : emergencyEvidence !== null) {
        throw new Error('Emergency reservation evidence is missing or unexpected');
      }
      try {
        return await transaction(async session => {
          const release = await collection.findOne({ _id: releaseKey(releaseId) }, { session });
          if (!release || release.phase !== phase
            || (phase === 'A' ? release.stageAPlanDigest : release.stageBPlanDigest) !== digest
            || release.actions[action]
            || (predecessor && release.actions[predecessor]?.status !== 'complete')) {
            throw new Error('Release action is out of phase, used, failed or incomplete');
          }
          await consumeNonce(approval, releaseId, action, session);
          const result = await collection.updateOne({ _id: release._id, version: release.version },
            { $set: { [`actions.${action}`]: { status: 'reserved', approval,
              planDigest: digest, reservedAt: at,
              ...(emergencyEvidence ? { emergencyEvidence } : {}) } },
            $inc: { version: 1 } }, { session });
          if (result.matchedCount !== 1) throw new Error('Concurrent action changed the release');
          return true;
        });
      } catch {
        throw new Error('Release action or approval nonce is used, failed or out of phase');
      }
    },
    async complete(releaseId, action, checkpoint, at) {
      if (!SAFE.test(checkpoint?.checkpointId ?? '') || !SHA.test(checkpoint?.evidenceDigest ?? '')) {
        throw new Error('Release handler returned an invalid safe checkpoint');
      }
      const result = await collection.updateOne({ _id: releaseKey(releaseId),
        [`actions.${action}.status`]: 'reserved' }, { $set: {
        [`actions.${action}.status`]: 'complete',
        [`actions.${action}.checkpointId`]: checkpoint.checkpointId,
        [`actions.${action}.evidenceDigest`]: checkpoint.evidenceDigest,
        [`actions.${action}.completedAt`]: at,
      }, $inc: { version: 1 } }, { writeConcern: WRITE });
      if (result.matchedCount !== 1) throw new Error('Release checkpoint was not reserved');
    },
    async fail(releaseId, action, at) {
      await collection.updateOne({ _id: releaseKey(releaseId),
        [`actions.${action}.status`]: 'reserved' }, { $set: {
        [`actions.${action}.status`]: 'failed', [`actions.${action}.failedAt`]: at,
      }, $inc: { version: 1 } }, { writeConcern: WRITE });
    },
  };
}

/** Offline protocol only: callers must inject independently reviewed observers and handlers. */
export function createStagedReleaseController({ journal, trustedAllowlist, observeControlPlane,
  observeConnection, trustedSigners, verifyFrozenEvidence, handlers, now = () => new Date(),
  log = () => {} }) {
  if (!journal?.readRelease || !journal?.reserve || !journal?.databaseName
    || typeof observeControlPlane !== 'function' || typeof observeConnection !== 'function'
    || observeControlPlane === observeConnection || typeof verifyFrozenEvidence !== 'function'
    || !handlers || typeof log !== 'function') {
    throw new Error('Independent observers, evidence verifier and release journal are required');
  }
  const allowlist = structuredClone(trustedAllowlist);
  if (Object.values(allowlist).some(role => role.databaseName === journal.databaseName)) {
    throw new Error('Release journal must use a separate database');
  }
  const safeLog = event => { try { log(event); } catch { /* The journal is authoritative. */ } };
  async function observe(plan) {
    const control = {};
    const connection = {};
    try {
      for (const role of ['source', 'recovery', 'target']) {
        control[role] = await observeControlPlane(role);
        connection[role] = await observeConnection(role);
      }
    } catch { throw new Error('Independent identity observation failed'); }
    const bridge = { format: 'mealkhata-v3-production-cutover-plan-v1',
      source: plan.source, recovery: plan.recovery, target: plan.target,
      sourceArchiveSha256: plan.baseArchiveSha256 ?? '0'.repeat(64),
      frozenArchiveSha256: '0'.repeat(64), financialStartDate: plan.financialStartDate };
    for (const observations of [control, connection]) {
      validateProductionCutoverPlan({ plan: bridge, trustedAllowlist: allowlist,
        observedIdentities: observations });
    }
  }
  return {
    digestStageA(plan) { return validateStageA(plan, allowlist, now()); },
    digestStageB(change) { return checksumValue({ stageAPlanDigest: change.stageAPlanDigest,
      amendment: change }); },
    async createStageA(plan, approval) {
      const at = now();
      const digest = validateStageA(plan, allowlist, at);
      shortApproval(approval, digest, 'approve-preflight-plan', trustedSigners, at);
      await journal.assertReady();
      await observe(plan);
      await journal.create(structuredClone(plan), digest, structuredClone(approval));
      safeLog({ event: 'v3.release.stage_a_approved', releaseId: plan.releaseId, planDigest: digest });
      return { releaseId: plan.releaseId, planDigest: digest, phase: 'A' };
    },
    async approveStageB(change, approval) {
      const at = now();
      const release = await journal.readRelease(change?.releaseId);
      if (!release || release.phase !== 'A') throw new Error('Unknown or previously amended release');
      assertStoredReleaseIntegrity(release);
      const digest = validateStageB(change, release, at);
      shortApproval(approval, digest, 'approve-frozen-amendment', trustedSigners, at);
      await observe(release.plan);
      let evidence;
      try { evidence = await verifyFrozenEvidence(structuredClone(change), structuredClone(release)); }
      catch { throw new Error('Frozen source evidence verification failed'); }
      if (!evidence?.passed || evidence.finalArchiveSha256 !== change.finalArchiveSha256
        || evidence.sidecarSha256 !== change.snapshotSidecarSha256
        || evidence.inventoryComparisonSha256 !== change.inventoryComparisonSha256
        || evidence.finalMealDeltaSha256 !== change.finalMealDeltaSha256
        || evidence.frozenInventorySha256 !== change.frozenInventorySha256
        || evidence.freezeAttestationSha256 !== change.freezeAttestationSha256) {
        throw new Error('Frozen source evidence does not match the signed amendment');
      }
      await journal.amend(structuredClone(change), digest, structuredClone(approval));
      safeLog({ event: 'v3.release.stage_b_approved', releaseId: change.releaseId, planDigest: digest });
      return { releaseId: change.releaseId, planDigest: digest, phase: 'B' };
    },
    async execute(releaseId, action, approval) {
      const release = await journal.readRelease(releaseId);
      if (!release) throw new Error('Unknown release ID');
      assertStoredReleaseIntegrity(release);
      const rollback = action === 'rollback-connection';
      if (release.actions['emergency-rollback-connection']
        || (!rollback && release.actions['rollback-connection'])) {
        throw new Error('Release rollback has closed all forward actions');
      }
      const phase = A_STEPS.includes(action) ? 'A' : B_STEPS.includes(action) || rollback ? 'B' : null;
      if (!phase || release.phase !== phase) throw new Error('Release action is outside the approved stage');
      const at = now();
      // Rollback has its own fresh approval and must remain possible after the amendment expires.
      if (!rollback) validateExpiry(phase === 'A' ? release.plan.expiresAt : release.amendment.expiresAt, at, 24);
      const digest = phase === 'A' ? release.stageAPlanDigest : release.stageBPlanDigest;
      shortApproval(approval, digest, action, trustedSigners, at);
      if (typeof handlers[action] !== 'function') throw new Error('Trusted release handler is unavailable');
      await journal.assertReady();
      await observe(release.plan);
      const sequence = phase === 'A' ? A_STEPS : B_STEPS;
      const predecessor = rollback ? 'switch-connection' : sequence[sequence.indexOf(action) - 1] ?? null;
      try {
        await journal.reserve(releaseId, phase, digest, action, structuredClone(approval), predecessor, at);
      } catch {
        throw new Error('Release journal reservation failed or is ambiguous; stop and inspect protected state');
      }
      try {
        safeLog({ event: 'v3.release.step_reserved', releaseId, action, planDigest: digest });
        const checkpoint = await handlers[action]({ action, releaseId, phase,
          plan: structuredClone(release.plan), amendment: structuredClone(release.amendment ?? null) });
        if (action === 'archive-source' && release.plan.baseArchiveSha256
          && checkpoint?.evidenceDigest !== release.plan.baseArchiveSha256) {
          throw new Error('Base archive checkpoint differs from Stage A approval');
        }
        await journal.complete(releaseId, action, checkpoint, now());
        safeLog({ event: 'v3.release.step_complete', releaseId, action, planDigest: digest,
          checkpointId: checkpoint.checkpointId, evidenceDigest: checkpoint.evidenceDigest });
        return { status: 'complete', action, releaseId, planDigest: digest, ...checkpoint };
      } catch {
        await journal.fail(releaseId, action, now()).catch(() => {});
        safeLog({ event: 'v3.release.step_failed', releaseId, action, planDigest: digest });
        throw new Error('Release step failed; preserve checkpoint and stop');
      }
    },
  };
}
