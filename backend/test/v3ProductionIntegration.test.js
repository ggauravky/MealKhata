import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createStagedReleaseJournal } from '../src/migrations/v3StagedRelease.service.js';

const observerModule = await import('../src/migrations/production/atlasIdentityObserver.js').catch(() => ({}));
const registryModule = await import('../src/migrations/production/releaseStepRegistry.js').catch(() => ({}));
const integrationModule = await import('../src/migrations/production/productionAdapterRegistry.js').catch(() => ({}));
const preflightModule = await import('../src/migrations/production/releaseExecutionPreflight.js').catch(() => ({}));
const checkpointModule = await import('../src/migrations/production/releaseCheckpointVerifier.js').catch(() => ({}));
const failureModule = await import('../src/migrations/production/releaseFailurePolicy.js').catch(() => ({}));

const identity = (name, principal) => ({ projectId: 'project-1', clusterId: `${name}-cluster`,
  databaseName: `${name}_db`, replicaSet: `${name}-rs`,
  endpointIdentity: `${name}.mongodb.example`, principal,
  expectedPrivileges: name === 'source' ? ['find', 'listCollections', 'listIndexes']
    : name === 'control' ? ['find', 'insert', 'update', 'createIndex'] : ['find', 'insert', 'update'] });
const allowlist = { source: identity('source', 'source-reader'),
  recovery: identity('recovery', 'recovery-operator'),
  target: identity('target', 'target-operator'),
  control: identity('control', 'release-journal') };
const mockOperation = (action, run, changes = {}) => ({ kind: 'disposable-mock',
  resources: [...registryModule.RELEASE_STEP_CONTRACTS[action].resources],
  operations: [...registryModule.RELEASE_STEP_CONTRACTS[action].operations], run, ...changes });
function sources(overrides = {}) {
  return { trustedAllowlist: allowlist,
    observeAtlas: async role => ({ projectId: allowlist[role].projectId,
      clusterId: allowlist[role].clusterId, endpointIdentity: allowlist[role].endpointIdentity }),
    observeHandshake: async role => ({ databaseName: allowlist[role].databaseName,
      replicaSet: allowlist[role].replicaSet, endpointIdentity: allowlist[role].endpointIdentity }),
    observePrivileges: async role => ({ principal: allowlist[role].principal,
      actions: allowlist[role].expectedPrivileges }), ...overrides };
}

test('independent identity observation binds all four roles and least-privilege principal', async () => {
  assert.equal(typeof observerModule.createAtlasIdentityObserver, 'function');
  const observer = observerModule.createAtlasIdentityObserver(sources());
  const evidence = await observer.observeAll();
  assert.equal(evidence.source.databaseName, 'source_db');
  assert.equal(evidence.control.principal, 'release-journal');
  assert.deepEqual(observer.planAllowlist.source,
    { clusterId: 'source-cluster', databaseName: 'source_db', replicaSet: 'source-rs' });
  assert.equal(JSON.stringify(evidence).includes('mongodb://'), false);
});

test('identity observation rejects changed cluster, endpoint, principal and excessive privileges', async () => {
  const cases = [
    { observeAtlas: async role => ({ projectId: 'project-1', clusterId: role === 'source'
      ? 'wrong-cluster' : allowlist[role].clusterId, endpointIdentity: allowlist[role].endpointIdentity }) },
    { observeHandshake: async role => ({ databaseName: allowlist[role].databaseName,
      replicaSet: allowlist[role].replicaSet, endpointIdentity: 'untrusted.example' }) },
    { observePrivileges: async role => ({ principal: role === 'source' ? 'wrong-user' : allowlist[role].principal,
      actions: allowlist[role].expectedPrivileges }) },
    { observePrivileges: async role => ({ principal: allowlist[role].principal,
      actions: [...allowlist[role].expectedPrivileges, 'dropDatabase'] }) },
  ];
  for (const change of cases) {
    const observer = observerModule.createAtlasIdentityObserver(sources(change));
    await assert.rejects(observer.observeAll(), /identity|privilege|principal|observation/i);
  }
  assert.throws(() => observerModule.createAtlasIdentityObserver(sources({
    trustedAllowlist: { ...allowlist, target: { ...allowlist.source } } })), /distinct/i);
  const duplicated = sources();
  assert.throws(() => observerModule.createAtlasIdentityObserver({ ...duplicated,
    observeHandshake: duplicated.observeAtlas }), /independent/i);
});

test('step registry exposes exact action contracts and rejects unreviewed handlers and unsafe checkpoints', async () => {
  assert.equal(typeof registryModule.createReleaseStepRegistry, 'function');
  let received;
  const registry = registryModule.createReleaseStepRegistry({
    operationHandlers: { 'read-source-inventory': mockOperation('read-source-inventory',
      async input => { received = input; return { checkpointId: 'inventory-1',
        evidenceDigest: 'a'.repeat(64) }; }) },
    verifyEvidence: async () => true,
    verifyCheckpoint: async () => true,
  });
  assert.equal(registry.contracts['read-source-inventory'].phase, 'A');
  assert.equal(Object.isFrozen(registry.contracts['read-source-inventory'].resources), true);
  assert.equal(Object.isFrozen(registry.contracts['read-source-inventory'].operations), true);
  assert.equal(registry.contracts['replay-final-meals'].phase, 'B');
  assert.equal(registry.contracts['approve-frozen-amendment'].approvalOnly, true);
  assert.equal(registry.contracts['rollback-connection'].rollback, true);
  assert.deepEqual(Object.keys(await registry.handlers['read-source-inventory']({
    action: 'read-source-inventory', phase: 'A', releaseId: 'release-1',
    plan: { source: { databaseName: 'source_db' } }, amendment: null })),
  ['checkpointId', 'evidenceDigest']);
  assert.deepEqual(received, { action: 'read-source-inventory', phase: 'A', releaseId: 'release-1' });
  assert.throws(() => registryModule.createReleaseStepRegistry({
    operationHandlers: { 'arbitrary-shell': async () => ({}) },
    verifyEvidence: async () => true, verifyCheckpoint: async () => true }), /unknown|unreviewed/i);
  assert.throws(() => registryModule.createReleaseStepRegistry({
    operationHandlers: { 'read-source-inventory': mockOperation('read-source-inventory',
      async () => ({}), { operations: ['read', 'shell'] }) },
    verifyEvidence: async () => true, verifyCheckpoint: async () => true }), /scope|operation|permission/i);
  assert.throws(() => registryModule.createReleaseStepRegistry({
    operationHandlers: { 'approve-frozen-amendment': mockOperation('approve-frozen-amendment',
      async () => ({})) },
    verifyEvidence: async () => true, verifyCheckpoint: async () => true }), /approval|handler|unreviewed/i);
  const unsafe = registryModule.createReleaseStepRegistry({
    operationHandlers: { 'read-source-inventory': mockOperation('read-source-inventory',
      async () => ({ checkpointId: 'safe',
        evidenceDigest: 'a'.repeat(64), uri: 'mongodb://secret' })) },
    verifyEvidence: async () => true, verifyCheckpoint: async () => true });
  await assert.rejects(unsafe.handlers['read-source-inventory']({ action: 'read-source-inventory',
    phase: 'A', releaseId: 'release-1', plan: {}, amendment: null }), /checkpoint/i);
});

test('Task 18A integration cannot enable live production handlers', () => {
  assert.equal(typeof integrationModule.createTask18AAdapterRegistry, 'function');
  assert.throws(() => integrationModule.createTask18AAdapterRegistry({ mode: 'production' }),
    /rehearsal|production/i);
  assert.throws(() => integrationModule.createTask18AAdapterRegistry({ mode: 'isolated-rehearsal',
    operationHandlers: { 'deploy-backend': async () => ({}) } }), /disposable|approval|deployment/i);
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => integrationModule.createTask18AAdapterRegistry({
      mode: 'isolated-rehearsal', operationHandlers: {},
      verifyEvidence: async () => true, verifyCheckpoint: async () => true }),
    /test|rehearsal|production/i);
  } finally { process.env.NODE_ENV = prior; }
});

test('rehearsal controller binds the release journal to the separately observed control database', async () => {
  assert.equal(typeof integrationModule.createTask18ARehearsalController, 'function');
  const observer = observerModule.createAtlasIdentityObserver(sources());
  const journal = { databaseName: 'control_db', readRelease: async () => null,
    reserve: async () => {}, assertReady: async () => {},
    observeConnectionIdentity: async () => allowlist.control };
  const rehearsal = integrationModule.createTask18ARehearsalController({
    identityObserver: observer, journal, trustedSigners: {},
    verifyCurrentSignerAuthority: async () => true,
    verifyFrozenEvidence: async () => ({ passed: true }),
    operationHandlers: {}, verifyEvidence: async () => true,
    verifyCheckpoint: async () => true });
  assert.equal(typeof rehearsal.createStageA, 'function');
  assert.throws(() => integrationModule.createTask18ARehearsalController({
    identityObserver: observer, journal: { ...journal, databaseName: 'source_db' },
    trustedSigners: {}, verifyCurrentSignerAuthority: async () => true,
    verifyFrozenEvidence: async () => true,
    operationHandlers: {}, verifyEvidence: async () => true,
    verifyCheckpoint: async () => true }), /control|journal/i);
  assert.throws(() => integrationModule.createTask18ARehearsalController({
    identityObserver: observer, journal, trustedSigners: {},
    verifyFrozenEvidence: async () => true, operationHandlers: {},
    verifyEvidence: async () => true, verifyCheckpoint: async () => true }), /signer|authority/i);
});

test('revoked signer authority blocks Stage A before journal mutation', async () => {
  const observer = observerModule.createAtlasIdentityObserver(sources());
  let journalUsed = false;
  const journal = { databaseName: 'control_db', readRelease: async () => null,
    reserve: async () => {}, assertReady: async () => { journalUsed = true; },
    observeConnectionIdentity: async () => allowlist.control };
  const controller = integrationModule.createTask18ARehearsalController({
    identityObserver: observer, journal, trustedSigners: {},
    verifyCurrentSignerAuthority: async () => false,
    verifyFrozenEvidence: async () => true, operationHandlers: {},
    verifyEvidence: async () => true, verifyCheckpoint: async () => true });
  await assert.rejects(controller.createStageA({}, {}), /signer|authority/i);
  assert.equal(journalUsed, false);
});

test('journal connection identity must match the independently allowed control role before Stage A', async () => {
  const observer = observerModule.createAtlasIdentityObserver(sources());
  let journalUsed = false;
  const journal = { databaseName: 'control_db', readRelease: async () => null,
    reserve: async () => {}, assertReady: async () => { journalUsed = true; },
    observeConnectionIdentity: async () => ({ ...allowlist.control, clusterId: 'source-cluster' }) };
  const controller = integrationModule.createTask18ARehearsalController({
    identityObserver: observer, journal, trustedSigners: {},
    verifyCurrentSignerAuthority: async () => true,
    verifyFrozenEvidence: async () => true, operationHandlers: {},
    verifyEvidence: async () => true, verifyCheckpoint: async () => true });
  await assert.rejects(controller.createStageA({}, {}), /journal|control|identity/i);
  assert.equal(journalUsed, false);
});

test('read-only source authorization is action-specific, short-lived and separate from archive authority', () => {
  assert.equal(typeof preflightModule.verifyReadOnlyInventoryAuthorization, 'function');
  const owner = generateKeyPairSync('ed25519');
  const operator = generateKeyPairSync('ed25519');
  const digest = 'd'.repeat(64);
  const now = new Date('2026-11-06T10:00:00.000Z');
  const expiresAt = '2026-11-06T10:04:00.000Z';
  const approval = (action, expiry = expiresAt) => {
    const nonce = 'inventory-once';
    const payload = Buffer.from(`${digest}\n${action}\n${expiry}\n${nonce}`);
    return { planDigest: digest, action, nonce, expiresAt: expiry, signatures: [
      { role: 'owner', signerId: 'owner', signature: sign(null, payload, owner.privateKey).toString('base64') },
      { role: 'operator', signerId: 'operator', signature: sign(null, payload, operator.privateKey).toString('base64') },
    ] };
  };
  const args = { approval: approval('read-source-inventory'), planDigest: digest,
    trustedSigners: { owner: { owner: owner.publicKey }, operator: { operator: operator.publicKey } },
    principal: 'source-reader', expectedPrincipal: 'source-reader',
    observedPrivileges: ['find', 'listCollections', 'listIndexes'], now };
  assert.equal(preflightModule.verifyReadOnlyInventoryAuthorization(args).action,
    'read-source-inventory');
  assert.throws(() => preflightModule.verifyReadOnlyInventoryAuthorization({ ...args,
    approval: approval('archive-source') }), /inventory|approved/i);
  assert.throws(() => preflightModule.verifyReadOnlyInventoryAuthorization({ ...args,
    observedPrivileges: [...args.observedPrivileges, 'insert'] }), /read.only|privilege/i);
  assert.throws(() => preflightModule.verifyReadOnlyInventoryAuthorization({ ...args,
    principal: 'other-reader' }), /principal|allowlist/i);
  assert.throws(() => preflightModule.verifyReadOnlyInventoryAuthorization({ ...args,
    approval: approval('read-source-inventory', '2026-11-06T10:06:00.000Z') }), /five|minute|expiry/i);
});

test('checkpoint verification rejects handler substitution and failure policy stops ambiguous partial effects', async () => {
  assert.equal(typeof checkpointModule.createReleaseCheckpointVerifier, 'function');
  assert.equal(typeof failureModule.decideReleaseFailure, 'function');
  const checkpoint = { checkpointId: 'archive-1', evidenceDigest: 'a'.repeat(64) };
  const verifier = checkpointModule.createReleaseCheckpointVerifier({
    readProtectedEvidence: async () => ({ action: 'archive-source', releaseId: 'release-1',
      ...checkpoint, resourceFingerprint: 'b'.repeat(64) }),
    verifyResourceState: async () => true });
  const input = { action: 'archive-source', context: { releaseId: 'release-1' }, checkpoint };
  assert.equal(await verifier(input), true);
  assert.equal(await verifier({ ...input, action: 'restore-recovery' }), false);
  assert.equal(await verifier({ ...input, checkpoint: { ...checkpoint,
    evidenceDigest: 'c'.repeat(64) } }), false);
  assert.deepEqual(failureModule.decideReleaseFailure({ reserved: true,
    sideEffectsPossible: true, checkpointVerified: false }),
  { decision: 'STOP_MANUAL_REVIEW', retryAllowed: false, writesAllowed: false });
});

test('complete disposable Stage A and B rehearsal records every signed action once', async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const connection = await mongoose.createConnection(replica.getUri('control_db')).asPromise();
  try {
    const journal = createStagedReleaseJournal({ collection: connection.db.collection('release_journal'),
      startSession: () => connection.startSession(),
      observeConnectionIdentity: async () => ({ ...allowlist.control,
        databaseName: connection.db.databaseName }) });
    await journal.initialize();
    const owner = generateKeyPairSync('ed25519');
    const operator = generateKeyPairSync('ed25519');
    const trustedSigners = { owner: { owner: owner.publicKey },
      operator: { operator: operator.publicKey } };
    const now = new Date('2026-11-05T12:00:00.000Z');
    const expiresAt = '2026-11-05T12:04:00.000Z';
    const signAction = (digest, action, nonce) => {
      const message = Buffer.from(`${digest}\n${action}\n${expiresAt}\n${nonce}`);
      return { planDigest: digest, action, nonce, expiresAt, signatures: [
        { role: 'owner', signerId: 'owner', signature: sign(null, message, owner.privateKey).toString('base64') },
        { role: 'operator', signerId: 'operator', signature: sign(null, message, operator.privateKey).toString('base64') },
      ] };
    };
    const A = ['read-source-inventory', 'archive-source', 'restore-recovery',
      'create-target', 'apply-history', 'freeze-source-writes', 'archive-frozen-source'];
    const B = ['replay-final-meals', 'configure-financial-boundary', 'configure-operations',
      'deploy-backend', 'deploy-frontend', 'switch-connection', 'open-writes'];
    const base = 'a'.repeat(64);
    const frozen = 'b'.repeat(64);
    const freeze = 'c'.repeat(64);
    const operationHandlers = Object.fromEntries([...A, ...B].map(action => [action,
      mockOperation(action, async () => ({ checkpointId: action, evidenceDigest: action === 'archive-source'
        ? base : action === 'archive-frozen-source' ? frozen
          : action === 'freeze-source-writes' ? freeze : 'd'.repeat(64) }))]));
    const observer = observerModule.createAtlasIdentityObserver(sources());
    const controller = integrationModule.createTask18ARehearsalController({
      identityObserver: observer, journal, trustedSigners, now: () => now,
      verifyCurrentSignerAuthority: async ({ signers }) => signers.length === 2,
      verifyFrozenEvidence: async change => ({ passed: true,
        finalArchiveSha256: change.finalArchiveSha256,
        sidecarSha256: change.snapshotSidecarSha256,
        inventoryComparisonSha256: change.inventoryComparisonSha256,
        finalMealDeltaSha256: change.finalMealDeltaSha256,
        frozenInventorySha256: change.frozenInventorySha256,
        freezeAttestationSha256: change.freezeAttestationSha256 }),
      operationHandlers, mockLiveActions: true,
      verifyEvidence: async ({ observed }) => observed.control.databaseName === 'control_db',
      verifyCheckpoint: async () => true });
    const plan = { format: 'mealkhata-v3-stage-a-v1', releaseId: 'task18a-rehearsal',
      ...observer.planAllowlist, financialStartDate: '2026-12-01',
      baseArchiveSha256: base, proceduresSha256: 'e'.repeat(64),
      expiresAt: '2026-11-05T18:00:00.000Z' };
    const aDigest = controller.digestStageA(plan);
    await controller.createStageA(plan, signAction(aDigest, 'approve-preflight-plan', 'nonce-plan'));
    for (const [index, action] of A.entries()) {
      await controller.execute(plan.releaseId, action, signAction(aDigest, action, `nonce-a-${index}`));
    }
    const change = { format: 'mealkhata-v3-stage-b-amendment-v1', releaseId: plan.releaseId,
      stageAPlanDigest: aDigest, source: plan.source, baseArchiveSha256: base,
      finalArchiveSha256: frozen, snapshotSidecarSha256: '1'.repeat(64),
      inventoryComparisonSha256: '2'.repeat(64), finalMealDeltaSha256: '3'.repeat(64),
      frozenInventorySha256: '4'.repeat(64), freezeAttestationSha256: freeze,
      freezeAt: now.toISOString(), expiresAt: '2026-11-05T18:00:00.000Z',
      unexplainedChanges: [], financialStartDate: plan.financialStartDate };
    const bDigest = controller.digestStageB(change);
    await controller.approveStageB(change,
      signAction(bDigest, 'approve-frozen-amendment', 'nonce-amend'));
    for (const [index, action] of B.entries()) {
      await controller.execute(plan.releaseId, action, signAction(bDigest, action, `nonce-b-${index}`));
    }
    const saved = await journal.readRelease(plan.releaseId);
    assert.equal(saved.phase, 'B');
    assert.equal(Object.values(saved.actions).filter(action => action.status === 'complete').length, 14);
    assert.equal(await connection.db.collection('release_journal').countDocuments({ kind: 'nonce' }), 16);
  } finally {
    await connection.close();
    await replica.stop();
  }
});
