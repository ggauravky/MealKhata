import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { checksumValue } from '../src/migrations/sourceInventory.service.js';
import { createStagedReleaseJournal, createStagedReleaseController } from
  '../src/migrations/v3StagedRelease.service.js';
import { createAtlasIdentityObserver } from '../src/migrations/production/atlasIdentityObserver.js';

const emergencyModule = await import('../src/migrations/production/emergencyRollbackController.js').catch(() => ({}));
const source = { projectId: 'project-1', clusterId: 'source-cluster', databaseName: 'source_db',
  replicaSet: 'source-rs', endpointIdentity: 'source.example', principal: 'source-reader',
  expectedPrivileges: ['find', 'listCollections', 'listIndexes'] };
const role = name => ({ projectId: 'project-1', clusterId: `${name}-cluster`,
  databaseName: `${name}_db`, replicaSet: `${name}-rs`, endpointIdentity: `${name}.example`,
  principal: `${name}-principal`, expectedPrivileges: ['find', 'insert', 'update'] });
const allowlist = { source, recovery: role('recovery'), target: role('target'),
  control: { ...role('control'), expectedPrivileges: ['find', 'insert', 'update', 'createIndex'] } };
const owner = generateKeyPairSync('ed25519');
const operator = generateKeyPairSync('ed25519');
const trustedSigners = { owner: { owner: owner.publicKey }, operator: { operator: operator.publicKey } };
const frozen = 'a'.repeat(64);
const target = 'b'.repeat(64);
const outage = { evidenceRef: 'target-outage-1', lastKnownTargetFingerprint: target,
  evidenceDigest: 'c'.repeat(64), targetState: 'unreachable',
  observedAt: '2026-11-06T11:59:00.000Z' };
const plan = { format: 'mealkhata-v3-stage-a-v1', releaseId: 'release-18b',
  source: { clusterId: source.clusterId, databaseName: source.databaseName,
    replicaSet: source.replicaSet },
  recovery: { clusterId: allowlist.recovery.clusterId,
    databaseName: allowlist.recovery.databaseName, replicaSet: allowlist.recovery.replicaSet },
  target: { clusterId: allowlist.target.clusterId, databaseName: allowlist.target.databaseName,
    replicaSet: allowlist.target.replicaSet },
  financialStartDate: '2026-12-01', baseArchiveSha256: 'd'.repeat(64),
  proceduresSha256: 'e'.repeat(64), expiresAt: '2026-11-05T18:00:00.000Z' };
const stageAPlanDigest = checksumValue(plan);
const amendment = { format: 'mealkhata-v3-stage-b-amendment-v1', releaseId: plan.releaseId,
  stageAPlanDigest, source: plan.source, financialStartDate: plan.financialStartDate,
  expiresAt: '2026-11-05T18:00:00.000Z' };
const stageBPlanDigest = checksumValue({ stageAPlanDigest, amendment });
const at = new Date('2026-11-06T12:00:00.000Z'); // Stage B has expired.

let replica;
let connection;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  connection = await mongoose.createConnection(replica.getUri('control_db')).asPromise();
});
after(async () => { await connection?.close(); await replica?.stop(); });
beforeEach(async () => { await connection.db.dropDatabase(); });

function approval(nonce = 'emergency-once', expiry = '2026-11-06T12:04:00.000Z') {
  const action = 'emergency-rollback-connection';
  const payload = Buffer.from(`${stageBPlanDigest}\n${action}\n${expiry}\n${nonce}`);
  return { planDigest: stageBPlanDigest, action, expiresAt: expiry, nonce, signatures: [
    { role: 'owner', signerId: 'owner', signature: sign(null, payload, owner.privateKey).toString('base64') },
    { role: 'operator', signerId: 'operator', signature: sign(null, payload, operator.privateKey).toString('base64') },
  ] };
}

async function setup(changes = {}) {
  const collection = connection.db.collection('approvals');
  const journal = createStagedReleaseJournal({ collection, startSession: () => connection.startSession(),
    observeConnectionIdentity: async () => allowlist.control });
  await journal.initialize();
  await collection.insertOne({ _id: `release:${plan.releaseId}`, kind: 'release',
    releaseId: plan.releaseId, phase: 'B', stageAPlanDigest, stageBPlanDigest,
    plan, amendment, version: 0, actions: {
      'archive-frozen-source': { status: 'complete', evidenceDigest: frozen },
      'switch-connection': { status: 'complete', evidenceDigest: 'f'.repeat(64) },
    } });
  const observedRoles = [];
  const identityObserver = createAtlasIdentityObserver({ trustedAllowlist: allowlist,
    observeAtlas: async name => { observedRoles.push(name); return {
      projectId: allowlist[name].projectId, clusterId: allowlist[name].clusterId,
      endpointIdentity: allowlist[name].endpointIdentity }; },
    observeHandshake: async name => ({ databaseName: allowlist[name].databaseName,
      replicaSet: allowlist[name].replicaSet, endpointIdentity: allowlist[name].endpointIdentity }),
    observePrivileges: async name => ({ principal: allowlist[name].principal,
      actions: allowlist[name].expectedPrivileges }) });
  let executions = 0;
  const options = { mode: 'isolated-rehearsal', identityObserver, trustedSigners, now: () => at,
    verifyCurrentSignerAuthority: async () => true,
    verifyTargetOutage: async () => ({ passed: true, ...outage,
      switchCheckpointDigest: 'f'.repeat(64) }),
    verifySourceUnchanged: async () => ({ passed: true, frozenArchiveSha256: frozen }),
    verifyPreviousRelease: async () => ({ passed: true, releaseId: 'v2-release',
      configSha256: '1'.repeat(64), sourceIdentitySha256: checksumValue(source) }),
    verifyWritesStopped: async () => ({ passed: true, evidenceDigest: '2'.repeat(64) }),
    restorePreviousConnection: async () => { executions += 1; return {
      checkpointId: 'previous-release-restored', evidenceDigest: '3'.repeat(64) }; },
    verifyCheckpoint: async () => true,
    ...changes,
    journal: { ...journal, ...(changes.journal ?? {}) } };
  return { controller: emergencyModule.createEmergencyRollbackController?.(options),
    options, journal, collection, observedRoles, get executions() { return executions; } };
}

test('emergency controller cannot be activated as an unreviewed production executor', async () => {
  const fixture = await setup();
  assert.throws(() => emergencyModule.createEmergencyRollbackController({
    ...fixture.options, mode: 'production' }), /rehearsal|production|test/i);
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => emergencyModule.createEmergencyRollbackController(fixture.options),
      /rehearsal|production|test/i);
  } finally { process.env.NODE_ENV = prior; }
});

test('target outage rollback uses only reverified source and control, consumes one nonce, and leaves writes closed', async () => {
  assert.equal(typeof emergencyModule.createEmergencyRollbackController, 'function');
  const fixture = await setup();
  const result = await fixture.controller.execute(plan.releaseId, approval(), outage);
  assert.equal(result.status, 'complete');
  assert.equal(result.writesAllowed, false);
  assert.equal(fixture.executions, 1);
  assert.equal(fixture.observedRoles.includes('target'), false);
  assert.equal((await fixture.journal.readRelease(plan.releaseId)).actions['emergency-rollback-connection'].status,
    'complete');
  assert.deepEqual((await fixture.journal.readRelease(plan.releaseId))
    .actions['emergency-rollback-connection'].emergencyEvidence, {
    outageEvidenceRef: outage.evidenceRef,
    outageEvidenceDigest: outage.evidenceDigest,
    lastKnownTargetFingerprint: target,
    outageObservedAt: outage.observedAt,
    sourceIdentitySha256: checksumValue(source),
    controlIdentitySha256: checksumValue(allowlist.control),
    previousConfigSha256: '1'.repeat(64),
    writesStoppedDigest: '2'.repeat(64),
  });
  assert.equal(await fixture.collection.countDocuments({ kind: 'nonce' }), 1);
  await assert.rejects(fixture.controller.execute(plan.releaseId, approval('another-nonce'), outage),
    /used|reserved|rollback|closed/i);
});

test('emergency rollback fails closed for mismatched source, unavailable control and invalid approval', async () => {
  for (const change of [
    { verifySourceUnchanged: async () => ({ passed: false }) },
    { verifyTargetOutage: async () => ({ passed: true, ...outage,
      switchCheckpointDigest: 'f'.repeat(64),
      lastKnownTargetFingerprint: '9'.repeat(64) }) },
    { verifyTargetOutage: async () => ({ passed: true, ...outage,
      switchCheckpointDigest: 'f'.repeat(64), targetState: 'reachable' }) },
  ]) {
    const fixture = await setup(change);
    await assert.rejects(fixture.controller.execute(plan.releaseId, approval(), outage));
    assert.equal(fixture.executions, 0);
    await fixture.collection.deleteMany({});
  }
  const control = await setup({ journal: { databaseName: 'control_db',
    observeConnectionIdentity: async () => { throw new Error('mongodb://private'); } } });
  await assert.rejects(control.controller.execute(plan.releaseId, approval(), outage),
    error => !error.message.includes('mongodb://'));
  assert.equal(control.executions, 0);
  await control.collection.deleteMany({});
  const substituted = await setup({ journal: { observeConnectionIdentity: async () =>
    ({ ...allowlist.control, principal: 'substituted-principal' }) } });
  await assert.rejects(substituted.controller.execute(plan.releaseId, approval(), outage),
    /control|journal|identity/i);
  assert.equal(substituted.executions, 0);
  await substituted.collection.deleteMany({});
  const invalid = await setup();
  await assert.rejects(invalid.controller.execute(plan.releaseId, approval('bad',
    '2026-11-06T11:59:00.000Z'), outage), /expired|approv/i);
  assert.equal(invalid.executions, 0);
});

test('stale outage proof, incomplete switch and absent frozen source stop before reservation', async () => {
  const fixture = await setup();
  await assert.rejects(fixture.controller.execute(plan.releaseId, approval(), {
    ...outage, observedAt: '2026-11-06T11:40:00.000Z' }), /outage|evidence|stale/i);
  await fixture.collection.updateOne({ _id: `release:${plan.releaseId}` },
    { $set: { 'actions.switch-connection.status': 'reserved' } });
  await assert.rejects(fixture.controller.execute(plan.releaseId, approval(), outage),
    /switch|lineage|rollback/i);
  await fixture.collection.updateOne({ _id: `release:${plan.releaseId}` },
    { $set: { 'actions.switch-connection.status': 'complete' },
      $unset: { 'actions.archive-frozen-source': '' } });
  await assert.rejects(fixture.controller.execute(plan.releaseId, approval(), outage),
    /archive|source|evidence/i);
  assert.equal(fixture.executions, 0);
  assert.equal(await fixture.collection.countDocuments({ kind: 'nonce' }), 0);
});

test('missing switch checkpoint digest cannot establish a trusted last target fingerprint', async () => {
  const fixture = await setup();
  await fixture.collection.updateOne({ _id: `release:${plan.releaseId}` },
    { $unset: { 'actions.switch-connection.evidenceDigest': '' } });
  await assert.rejects(fixture.controller.execute(plan.releaseId, approval(), outage),
    /switch|checkpoint|lineage|evidence/i);
  assert.equal(await fixture.collection.countDocuments({ kind: 'nonce' }), 0);
});

test('observed source substitution stops before rollback and leaves the approval unused', async () => {
  const fixture = await setup();
  const controller = emergencyModule.createEmergencyRollbackController({ ...fixture.options,
    identityObserver: { ...fixture.options.identityObserver,
      observeRole: async name => name === 'source'
        ? { ...source, clusterId: 'substituted-cluster' }
        : fixture.options.identityObserver.observeRole(name) } });
  await assert.rejects(controller.execute(plan.releaseId, approval(), outage),
    /source|identity|lineage/i);
  assert.equal(fixture.executions, 0);
  assert.equal(await fixture.collection.countDocuments({ kind: 'nonce' }), 0);
});

test('v3-only payments remain in the isolated target after emergency connection restoration', async () => {
  const fixture = await setup();
  const targetPayments = connection.client.db('target_db').collection('payments');
  const sourcePayments = connection.client.db('source_db').collection('payments');
  await targetPayments.insertOne({ _id: 'v3-only-payment', amountPaise: 125,
    reference: 'BANK-V3-ONLY' });
  await sourcePayments.insertOne({ _id: 'v2-original-payment', amountPaise: 75 });
  await fixture.controller.execute(plan.releaseId, approval(), outage);
  assert.equal(await targetPayments.countDocuments({ _id: 'v3-only-payment' }), 1);
  assert.equal(await sourcePayments.countDocuments({ _id: 'v3-only-payment' }), 0);
  assert.equal(await sourcePayments.countDocuments({ _id: 'v2-original-payment' }), 1);
});

test('completed emergency rollback closes ordinary rollback and every forward action', async () => {
  const fixture = await setup();
  await fixture.controller.execute(plan.releaseId, approval(), outage);
  let called = false;
  const staged = createStagedReleaseController({ journal: fixture.journal,
    trustedAllowlist: { source: plan.source, recovery: plan.recovery, target: plan.target },
    observeControlPlane: async name => plan[name],
    observeConnection: async name => plan[name], trustedSigners,
    verifyFrozenEvidence: async () => ({ passed: true }),
    handlers: { 'rollback-connection': async () => { called = true;
      return { checkpointId: 'ordinary-rollback', evidenceDigest: '4'.repeat(64) }; } },
    now: () => at });
  const ordinary = action => {
    const nonce = `later-${action}`;
    const expiry = '2026-11-06T12:04:00.000Z';
    const payload = Buffer.from(`${stageBPlanDigest}\n${action}\n${expiry}\n${nonce}`);
    return { planDigest: stageBPlanDigest, action, nonce, expiresAt: expiry, signatures: [
      { role: 'owner', signerId: 'owner', signature: sign(null, payload, owner.privateKey).toString('base64') },
      { role: 'operator', signerId: 'operator', signature: sign(null, payload, operator.privateKey).toString('base64') },
    ] };
  };
  await assert.rejects(staged.execute(plan.releaseId, 'rollback-connection',
    ordinary('rollback-connection')), /emergency|rollback|closed/i);
  await assert.rejects(staged.execute(plan.releaseId, 'open-writes',
    ordinary('open-writes')), /emergency|rollback|closed/i);
  assert.equal(called, false);
});

test('rollback reservation, crash and replay remain non-retryable after v3-only writes', async () => {
  const fixture = await setup({ restorePreviousConnection: async () => {
    throw new Error('mongodb://private-target'); } });
  await assert.rejects(fixture.controller.execute(plan.releaseId, approval(), outage),
    error => !error.message.includes('mongodb://') && /failed|stop/i.test(error.message));
  assert.equal((await fixture.journal.readRelease(plan.releaseId)).actions['emergency-rollback-connection'].status,
    'failed');
  const restarted = emergencyModule.createEmergencyRollbackController(fixture.options);
  await assert.rejects(restarted.execute(plan.releaseId, approval('retry'), outage));
});

test('process restart with a reserved emergency action cannot repeat a partial connection switch', async () => {
  const fixture = await setup();
  await fixture.collection.updateOne({ _id: `release:${plan.releaseId}` },
    { $set: { 'actions.emergency-rollback-connection': { status: 'reserved',
      planDigest: stageBPlanDigest, reservedAt: at } } });
  const restarted = emergencyModule.createEmergencyRollbackController(fixture.options);
  await assert.rejects(restarted.execute(plan.releaseId, approval('fresh-after-crash'), outage),
    /rollback|lineage|used/i);
  assert.equal(fixture.executions, 0);
  assert.equal((await fixture.journal.readRelease(plan.releaseId))
    .actions['emergency-rollback-connection'].status, 'reserved');
});
