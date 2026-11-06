const SHA = /^[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const sameScope = (actual, expected) => Array.isArray(actual)
  && actual.length === expected.length && new Set(actual).size === expected.length
  && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

const step = (phase, predecessor, resources, operations, evidence, checkpoint,
  stop, recovery, rollback = false) => Object.freeze({ phase, predecessor,
  requiredRole: 'owner-and-operator', approval: 'separate-dual-signed-action',
  evidence: Object.freeze([...evidence]), resources: Object.freeze([...resources]),
  operations: Object.freeze([...operations]),
  writeScope: Object.freeze(operations.filter(item => item !== 'read')),
  checkpoint, verification: 'independent-evidence-and-checkpoint', stop, recovery, rollback });

/** Declarative review surface. No command strings, connection strings or generic force action. */
export const RELEASE_STEP_CONTRACTS = Object.freeze({
  'read-source-inventory': step('A', null, ['source', 'control'], ['read'],
    ['identity', 'read-only-snapshot'], 'source-inventory', 'identity-or-snapshot-drift', 'stop-and-reinventory'),
  'archive-source': step('A', 'read-source-inventory', ['source', 'control', 'protected-archive'], ['read', 'archive-write'],
    ['source-inventory'], 'base-archive', 'archive-mismatch', 'stop-and-retain-source'),
  'restore-recovery': step('A', 'archive-source', ['recovery', 'control', 'protected-archive'], ['read', 'recovery-write'],
    ['base-archive'], 'recovery-restore', 'restore-mismatch', 'stop-and-isolate-recovery'),
  'create-target': step('A', 'restore-recovery', ['target', 'control'], ['read', 'target-create'],
    ['recovery-restore', 'empty-target'], 'target-created', 'target-not-empty', 'stop-and-isolate-target'),
  'apply-history': step('A', 'create-target', ['target', 'control', 'protected-archive'], ['read', 'target-history-write'],
    ['base-archive', 'historical-costs'], 'history-applied', 'one-paisa-or-audit-drift', 'stop-and-rebuild-empty-target'),
  'freeze-source-writes': step('A', 'apply-history', ['source', 'control', 'render-writers'], ['read', 'writer-disable'],
    ['source-writer-inventory'], 'source-frozen', 'writer-remains', 'keep-writes-stopped'),
  'archive-frozen-source': step('A', 'freeze-source-writes', ['source', 'control', 'protected-archive'], ['read', 'archive-write'],
    ['write-freeze'], 'frozen-archive', 'archive-or-freeze-mismatch', 'stop-and-retain-frozen-source'),
  'approve-frozen-amendment': Object.freeze({ ...step('A_TO_B', 'archive-frozen-source',
    ['source', 'control', 'protected-archive'], ['read', 'journal-write'],
    ['final-archive', 'snapshot-sidecar', 'inventory-comparison', 'write-freeze', 'bounded-meal-delta'],
    'stage-b-amendment', 'unverified-frozen-source', 'keep-source-frozen'), approvalOnly: true }),
  'replay-final-meals': step('B', 'approve-frozen-amendment', ['target', 'control', 'protected-archive'], ['read', 'target-meal-write'],
    ['frozen-amendment', 'bounded-meal-delta'], 'final-meals', 'one-paisa-or-delta-drift', 'stop-and-rebuild-empty-target'),
  'configure-financial-boundary': step('B', 'replay-final-meals', ['target', 'control'], ['read', 'target-setting-write'],
    ['owner-boundary-decision', 'historical-costs'], 'financial-boundary', 'boundary-mismatch', 'stop-with-writes-closed'),
  'configure-operations': step('B', 'configure-financial-boundary', ['target', 'control'], ['read', 'target-configuration-write'],
    ['eligibility-decisions', 'fresh-finance-plan'], 'operations-configured', 'missing-eligibility', 'stop-with-writes-closed'),
  'deploy-backend': step('B', 'configure-operations', ['render', 'control'], ['read', 'render-deploy'],
    ['immutable-revision', 'protected-config', 'rollback-release'], 'backend-deployed', 'health-or-config-failure', 'restore-previous-release'),
  'deploy-frontend': step('B', 'deploy-backend', ['vercel', 'control'], ['read', 'vercel-deploy'],
    ['immutable-build', 'api-rewrite-check'], 'frontend-deployed', 'browser-or-route-failure', 'restore-previous-release'),
  'switch-connection': step('B', 'deploy-frontend', ['render', 'target', 'source', 'control'], ['read', 'connection-switch'],
    ['rollback-credentials', 'target-health'], 'connection-switched', 'identity-or-health-failure', 'rollback-connection'),
  'open-writes': step('B', 'switch-connection', ['render', 'target', 'control'], ['read', 'writer-enable'],
    ['full-smoke', 'financial-audit', 'historical-costs'], 'writes-opened', 'smoke-or-finance-failure', 'stop-writes-and-rollback'),
  'rollback-connection': step('B', 'switch-connection', ['render', 'source', 'target', 'control'], ['read', 'writer-disable', 'connection-switch'],
    ['v3-only-write-register', 'source-unchanged', 'rollback-credentials'], 'connection-rolled-back',
    'unreconciled-external-reference', 'keep-both-sides-frozen', true),
});

/** Wraps independently reviewed operation handlers with evidence and safe-checkpoint gates. */
export function createReleaseStepRegistry({ operationHandlers, verifyEvidence, verifyCheckpoint }) {
  if (!operationHandlers || typeof operationHandlers !== 'object' || Array.isArray(operationHandlers)
    || typeof verifyEvidence !== 'function' || typeof verifyCheckpoint !== 'function') {
    throw new Error('Reviewed operation, evidence and checkpoint adapters are required');
  }
  for (const [action, adapter] of Object.entries(operationHandlers)) {
    const contract = RELEASE_STEP_CONTRACTS[action];
    if (!contract || contract.approvalOnly || !adapter || typeof adapter !== 'object'
      || Object.keys(adapter).length !== 4
      || !['kind', 'resources', 'operations', 'run'].every(key => Object.hasOwn(adapter, key))
      || adapter.kind !== 'disposable-mock' || typeof adapter.run !== 'function') {
      throw new Error('Unknown or unreviewed release operation handler');
    }
    if (!sameScope(adapter.resources, contract.resources)
      || !sameScope(adapter.operations, contract.operations)) {
      throw new Error('Release operation handler scope differs from the reviewed action contract');
    }
  }
  const handlers = {};
  for (const [action, adapter] of Object.entries(operationHandlers)) {
    const contract = RELEASE_STEP_CONTRACTS[action];
    const run = adapter.run;
    handlers[action] = async context => {
      if (context?.action !== action || context.phase !== contract.phase
        || !SAFE.test(context.releaseId ?? '')) {
        throw new Error('Release handler context differs from reviewed action contract');
      }
      if (await verifyEvidence({ action, contract, context }) !== true) {
        throw new Error('Required release evidence is missing or invalid');
      }
      const checkpoint = await run({ action, phase: context.phase, releaseId: context.releaseId });
      if (!checkpoint || Object.keys(checkpoint).length !== 2
        || !Object.hasOwn(checkpoint, 'checkpointId')
        || !Object.hasOwn(checkpoint, 'evidenceDigest')
        || !SAFE.test(checkpoint.checkpointId ?? '')
        || !SHA.test(checkpoint.evidenceDigest ?? '')
        || await verifyCheckpoint({ action, contract, context, checkpoint }) !== true) {
        throw new Error('Release handler returned an invalid or unverified safe checkpoint');
      }
      return { checkpointId: checkpoint.checkpointId, evidenceDigest: checkpoint.evidenceDigest };
    };
  }
  return Object.freeze({ contracts: RELEASE_STEP_CONTRACTS, handlers: Object.freeze(handlers) });
}
