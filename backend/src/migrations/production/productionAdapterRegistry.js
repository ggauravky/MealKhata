import { createReleaseStepRegistry } from './releaseStepRegistry.js';
import { createStagedReleaseController } from '../v3StagedRelease.service.js';
import { checksumValue } from '../sourceInventory.service.js';

const LIVE_ACTIONS = new Set(['deploy-backend', 'deploy-frontend', 'switch-connection',
  'open-writes', 'rollback-connection', 'freeze-source-writes']);

/** Task 18A can only wire disposable handlers. Live adapters are deliberately absent. */
export function createTask18AAdapterRegistry({ mode, operationHandlers = {},
  verifyEvidence = async () => false, verifyCheckpoint = async () => false,
  mockLiveActions = false } = {}) {
  if (mode !== 'isolated-rehearsal' || process.env.NODE_ENV !== 'test') {
    throw new Error('Task 18A adapters are limited to isolated rehearsal; production activation is unavailable');
  }
  if (!mockLiveActions && Object.keys(operationHandlers).some(action => LIVE_ACTIONS.has(action))) {
    throw new Error('Deployment and writer actions require explicit disposable mock adapters');
  }
  return createReleaseStepRegistry({ operationHandlers, verifyEvidence, verifyCheckpoint });
}

/** Rehearsal-only bridge to the Task 17 signed, durable state machine. */
export function createTask18ARehearsalController({ identityObserver, journal, trustedSigners,
  verifyFrozenEvidence, operationHandlers, verifyEvidence, verifyCheckpoint,
  verifyCurrentSignerAuthority, mockLiveActions = false, now, log }) {
  if (!identityObserver?.observeAll || !identityObserver?.planAllowlist
    || !identityObserver.controlDatabaseName
    || journal?.databaseName !== identityObserver.controlDatabaseName
    || typeof journal.observeConnectionIdentity !== 'function') {
    throw new Error('Release journal must match the independently allowlisted control database');
  }
  if (typeof verifyCurrentSignerAuthority !== 'function') {
    throw new Error('Independent current signer authority verifier is required');
  }
  const registry = createTask18AAdapterRegistry({ mode: 'isolated-rehearsal',
    operationHandlers, mockLiveActions,
    verifyEvidence: async input => {
      const observed = await identityObserver.observeAll();
      return await verifyEvidence?.({ ...input, observed }) === true;
    }, verifyCheckpoint });
  const observe = async role => {
    const observed = await identityObserver.observeAll();
    const value = observed[role];
    return { clusterId: value.clusterId, databaseName: value.databaseName,
      replicaSet: value.replicaSet };
  };
  const observeControlPlane = role => observe(role);
  const observeConnection = role => observe(role);
  const controller = createStagedReleaseController({ journal,
    trustedAllowlist: identityObserver.planAllowlist,
    observeControlPlane, observeConnection, trustedSigners,
    verifyFrozenEvidence, handlers: registry.handlers, now, log });
  const assertCurrentSigners = async (action, approval) => {
    let authorized = false;
    try {
      authorized = await verifyCurrentSignerAuthority({ action,
        signers: (approval?.signatures ?? []).map(({ role, signerId }) => ({ role, signerId })) });
    } catch { /* Do not expose protected signer-directory errors. */ }
    if (authorized !== true) throw new Error('Current owner/operator signer authority is unverified');
  };
  const assertJournalIdentity = async () => {
    let actual;
    let expected;
    try {
      actual = await journal.observeConnectionIdentity();
      expected = await identityObserver.observeRole('control');
    } catch { throw new Error('Release journal connection identity observation failed'); }
    const fields = ['projectId', 'clusterId', 'databaseName', 'replicaSet',
      'endpointIdentity', 'principal', 'expectedPrivileges'];
    if (!actual || Object.keys(actual).length !== fields.length
      || fields.some(field => !Object.hasOwn(actual, field))
      || checksumValue(actual) !== checksumValue(Object.fromEntries(fields
        .map(field => [field, expected[field]])))) {
      throw new Error('Release journal connection differs from the trusted control identity');
    }
  };
  return Object.freeze({ ...controller,
    async createStageA(plan, approval) {
      await assertJournalIdentity();
      await assertCurrentSigners('approve-preflight-plan', approval);
      return controller.createStageA(plan, approval);
    },
    async approveStageB(change, approval) {
      await assertJournalIdentity();
      await assertCurrentSigners('approve-frozen-amendment', approval);
      return controller.approveStageB(change, approval);
    },
    async execute(releaseId, action, approval) {
      await assertJournalIdentity();
      await assertCurrentSigners(action, approval);
      return controller.execute(releaseId, action, approval);
    },
  });
}
