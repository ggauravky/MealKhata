import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const { createStagedReleaseController, createStagedReleaseJournal } =
  await import('../src/migrations/v3StagedRelease.service.js').catch(() => ({}));
const id = (clusterId, databaseName, replicaSet) => ({ clusterId, databaseName, replicaSet });
const identities = { source: id('source-c', 'v2_source', 'rs-s'),
  recovery: id('recovery-c', 'v2_recovery', 'rs-r'), target: id('target-c', 'v3_target', 'rs-t') };
const base = 'a'.repeat(64);
const frozen = 'b'.repeat(64);
const sidecar = 'c'.repeat(64);
const initial = { format: 'mealkhata-v3-stage-a-v1', releaseId: 'release-17',
  ...identities, financialStartDate: '2026-12-01', baseArchiveSha256: base,
  proceduresSha256: 'd'.repeat(64), expiresAt: '2026-11-06T00:00:00.000Z' };
const owner = generateKeyPairSync('ed25519');
const operator = generateKeyPairSync('ed25519');
const signers = { owner: { owner1: owner.publicKey }, operator: { operator2: operator.publicKey } };
const at = new Date('2026-11-05T12:00:00.000Z');
const expiry = '2026-11-05T12:04:00.000Z';
function approval(planDigest, action, nonce) {
  const payload = Buffer.from(`${planDigest}\n${action}\n${expiry}\n${nonce}`);
  return { planDigest, action, nonce, expiresAt: expiry, signatures: [
    { role: 'owner', signerId: 'owner1', signature: sign(null, payload, owner.privateKey).toString('base64') },
    { role: 'operator', signerId: 'operator2', signature: sign(null, payload, operator.privateKey).toString('base64') },
  ] };
}
let replica;
let connection;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  connection = await mongoose.createConnection(replica.getUri('release_control')).asPromise();
});
after(async () => { await connection?.close(); await replica?.stop(); });
beforeEach(async () => { await connection.db.dropDatabase(); });
function setup(overrides = {}) {
  const journal = createStagedReleaseJournal({ collection: connection.db.collection('approvals'),
    startSession: () => connection.startSession() });
  const controller = createStagedReleaseController({ journal, trustedAllowlist: identities,
    observeControlPlane: async role => identities[role],
    observeConnection: async role => identities[role], trustedSigners: signers,
    verifyFrozenEvidence: async amendment => ({ passed: true,
      finalArchiveSha256: amendment.finalArchiveSha256,
      sidecarSha256: amendment.snapshotSidecarSha256,
      inventoryComparisonSha256: amendment.inventoryComparisonSha256,
      finalMealDeltaSha256: amendment.finalMealDeltaSha256,
      frozenInventorySha256: amendment.frozenInventorySha256,
      freezeAttestationSha256: amendment.freezeAttestationSha256 }),
    handlers: Object.fromEntries(['read-source-inventory', 'archive-source', 'restore-recovery',
      'create-target', 'apply-history', 'freeze-source-writes', 'archive-frozen-source',
      'replay-final-meals'].map(action => [action, async () => ({ checkpointId: action,
      evidenceDigest: action === 'archive-source' ? base : action === 'archive-frozen-source'
        ? frozen : action === 'freeze-source-writes' ? '3'.repeat(64)
          : 'e'.repeat(64) })])), now: () => at, ...overrides });
  return { journal, controller };
}
async function throughA(controller, plan = initial, prefix = 'nonce') {
  const digest = controller.digestStageA(plan);
  await controller.createStageA(plan, approval(digest, 'approve-preflight-plan', `${prefix}-plan`));
  for (const [index, action] of ['read-source-inventory', 'archive-source', 'restore-recovery',
    'create-target', 'apply-history', 'freeze-source-writes', 'archive-frozen-source'].entries()) {
    await controller.execute(plan.releaseId, action, approval(digest, action, `${prefix}-${index}`));
  }
  return digest;
}
function amendment(digest) {
  return { format: 'mealkhata-v3-stage-b-amendment-v1', releaseId: initial.releaseId,
    stageAPlanDigest: digest, source: identities.source, baseArchiveSha256: base,
    finalArchiveSha256: frozen, snapshotSidecarSha256: sidecar,
    inventoryComparisonSha256: 'f'.repeat(64), finalMealDeltaSha256: '1'.repeat(64),
    frozenInventorySha256: '2'.repeat(64), freezeAttestationSha256: '3'.repeat(64),
    freezeAt: '2026-11-05T12:00:00.000Z', expiresAt: '2026-11-05T18:00:00.000Z',
    unexplainedChanges: [],
    financialStartDate: initial.financialStartDate };
}

test('two-stage release requires an independently signed amendment and preserves action history', async () => {
  assert.equal(typeof createStagedReleaseController, 'function');
  const { journal, controller } = setup();
  await journal.initialize();
  const aDigest = await throughA(controller);
  const change = amendment(aDigest);
  const bDigest = controller.digestStageB(change);
  await assert.rejects(controller.approveStageB(change, null), /approv|signature/i);
  await controller.approveStageB(change, approval(bDigest, 'approve-frozen-amendment', 'nonce-amend'));
  const result = await controller.execute(initial.releaseId, 'replay-final-meals',
    approval(bDigest, 'replay-final-meals', 'nonce-replay'));
  assert.equal(result.status, 'complete');
  const saved = await journal.readRelease(initial.releaseId);
  assert.equal(saved.stageAPlanDigest, aDigest);
  assert.equal(saved.stageBPlanDigest, bDigest);
  assert.equal(saved.actions['archive-source'].status, 'complete');
  assert.equal(saved.actions['replay-final-meals'].status, 'complete');
  assert.equal(saved.amendmentApproval.signatures.length, 2);
  await assert.rejects(controller.execute(initial.releaseId, 'archive-source',
    approval(aDigest, 'archive-source', 'new-version-nonce')), /stage|used|complete/i);
});

test('changed frozen checksum, source identity, boundary or unexplained drift prevents amendment', async () => {
  const { journal, controller } = setup();
  await journal.initialize();
  const aDigest = await throughA(controller);
  for (const bad of [
    { finalArchiveSha256: '9'.repeat(64) },
    { source: id('other', 'v2_source', 'rs-s') },
    { financialStartDate: '2027-01-01' },
    { unexplainedChanges: ['payments'] },
  ]) {
    const change = { ...amendment(aDigest), ...bad };
    await assert.rejects(controller.approveStageB(change,
      approval(controller.digestStageB(change), 'approve-frozen-amendment', `nonce-bad-${Object.keys(bad)[0]}`)));
  }
  assert.equal((await journal.readRelease(initial.releaseId)).stageBPlanDigest, undefined);
});

test('nonce and release action cannot be replayed after restart or a changed Stage A digest', async () => {
  const first = setup();
  await first.journal.initialize();
  const digest = first.controller.digestStageA(initial);
  await first.controller.createStageA(initial, approval(digest, 'approve-preflight-plan', 'nonce-plan'));
  await first.controller.execute(initial.releaseId, 'read-source-inventory',
    approval(digest, 'read-source-inventory', 'nonce-shared'));
  const restarted = setup();
  await assert.rejects(restarted.controller.execute(initial.releaseId, 'read-source-inventory',
    approval(digest, 'read-source-inventory', 'nonce-shared')), /used|complete|reserved/i);
  await assert.rejects(restarted.controller.createStageA({ ...initial, proceduresSha256: '9'.repeat(64) },
    approval(restarted.controller.digestStageA({ ...initial, proceduresSha256: '9'.repeat(64) }),
      'approve-preflight-plan', 'nonce-another')), /release|exist|used/i);
});

test('failed action cannot be bypassed by a different plan or retry nonce', async () => {
  const { journal, controller } = setup({ handlers: {
    'read-source-inventory': async () => { throw new Error('secret connection string'); },
  } });
  await journal.initialize();
  const digest = controller.digestStageA(initial);
  await controller.createStageA(initial, approval(digest, 'approve-preflight-plan', 'nonce-plan'));
  await assert.rejects(controller.execute(initial.releaseId, 'read-source-inventory',
    approval(digest, 'read-source-inventory', 'nonce-fail')), /step failed/i);
  await assert.rejects(controller.execute(initial.releaseId, 'read-source-inventory',
    approval(digest, 'read-source-inventory', 'nonce-again')), /failed|used/i);
  assert.equal((await journal.readRelease(initial.releaseId)).actions['read-source-inventory'].status, 'failed');
});

test('wrong independent identity observation blocks the release before nonce reservation', async () => {
  const { journal, controller } = setup({ observeConnection: async role => role === 'source'
    ? id('wrong', 'v2_source', 'rs-s') : identities[role] });
  await journal.initialize();
  const digest = controller.digestStageA(initial);
  await assert.rejects(controller.createStageA(initial,
    approval(digest, 'approve-preflight-plan', 'nonce-plan')), /identity/i);
  assert.equal(await connection.db.collection('approvals').countDocuments(), 0);
});

test('Stage A may defer its base fingerprint only until the archived checkpoint binds it', async () => {
  const { journal, controller } = setup();
  await journal.initialize();
  const provisional = { ...initial, baseArchiveSha256: null };
  const aDigest = await throughA(controller, provisional);
  const frozenChange = amendment(aDigest);
  const bDigest = controller.digestStageB(frozenChange);
  assert.equal((await controller.approveStageB(frozenChange,
    approval(bDigest, 'approve-frozen-amendment', 'nonce-provisional'))).phase, 'B');
  assert.equal((await journal.readRelease(initial.releaseId)).actions['archive-source'].evidenceDigest, base);
});

test('journal plan or amendment tampering cannot reuse signatures for changed release instructions', async () => {
  const { journal, controller } = setup();
  await journal.initialize();
  const aDigest = controller.digestStageA(initial);
  await controller.createStageA(initial, approval(aDigest, 'approve-preflight-plan', 'nonce-plan'));
  const records = connection.db.collection('approvals');
  await records.updateOne({ _id: `release:${initial.releaseId}` },
    { $set: { 'plan.financialStartDate': '2027-01-01' } });
  await assert.rejects(controller.execute(initial.releaseId, 'read-source-inventory',
    approval(aDigest, 'read-source-inventory', 'nonce-tampered-plan')), /digest|tamper|plan/i);
  await records.updateOne({ _id: `release:${initial.releaseId}` },
    { $set: { 'plan.financialStartDate': initial.financialStartDate } });
  for (const [index, action] of ['read-source-inventory', 'archive-source', 'restore-recovery',
    'create-target', 'apply-history', 'freeze-source-writes', 'archive-frozen-source'].entries()) {
    await controller.execute(initial.releaseId, action, approval(aDigest, action, `nonce-action-${index}`));
  }
  const change = amendment(aDigest);
  const bDigest = controller.digestStageB(change);
  await controller.approveStageB(change, approval(bDigest, 'approve-frozen-amendment', 'nonce-amend'));
  await records.updateOne({ _id: `release:${initial.releaseId}` },
    { $set: { 'amendment.financialStartDate': '2027-01-01' } });
  await assert.rejects(controller.execute(initial.releaseId, 'replay-final-meals',
    approval(bDigest, 'replay-final-meals', 'nonce-tampered-amend')), /digest|tamper|amendment/i);
});

test('known base archive and freeze proof must match their Stage A checkpoints before advancing', async () => {
  const handlers = { 'read-source-inventory': async () => ({ checkpointId: 'inventory',
    evidenceDigest: 'e'.repeat(64) }),
  'archive-source': async () => ({ checkpointId: 'wrong-base', evidenceDigest: '9'.repeat(64) }) };
  const { journal, controller } = setup({ handlers });
  await journal.initialize();
  const digest = controller.digestStageA(initial);
  await controller.createStageA(initial, approval(digest, 'approve-preflight-plan', 'nonce-plan'));
  await controller.execute(initial.releaseId, 'read-source-inventory',
    approval(digest, 'read-source-inventory', 'nonce-inventory'));
  await assert.rejects(controller.execute(initial.releaseId, 'archive-source',
    approval(digest, 'archive-source', 'nonce-wrong-base')), /step failed|archive/i);
  assert.equal((await journal.readRelease(initial.releaseId)).actions['archive-source'].status, 'failed');
  const safe = setup();
  const other = { ...initial, releaseId: 'release-freeze-proof' };
  const otherDigest = await throughA(safe.controller, other, 'other');
  const changed = { ...amendment(otherDigest), releaseId: other.releaseId,
    freezeAttestationSha256: '9'.repeat(64) };
  await assert.rejects(safe.controller.approveStageB(changed,
    approval(safe.controller.digestStageB(changed), 'approve-frozen-amendment', 'nonce-wrong-freeze')),
  /freeze|archive|amendment/i);
});
