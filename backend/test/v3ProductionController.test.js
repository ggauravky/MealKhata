import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const implementation = await import('../src/migrations/v3ProductionController.service.js').catch(() => ({}));
const { createV3ProductionController, createMongoApprovalJournal } = implementation;
const id = (clusterId, databaseName, replicaSet) => ({ clusterId, databaseName, replicaSet });
const allowlist = {
  source: id('atlas-source', 'v2_source', 'rs-source'),
  recovery: id('atlas-recovery', 'v2_recovery', 'rs-recovery'),
  target: id('atlas-target', 'v3_target', 'rs-target'),
};
const plan = { format: 'mealkhata-v3-production-cutover-plan-v1', ...allowlist,
  sourceArchiveSha256: 'a'.repeat(64), frozenArchiveSha256: 'b'.repeat(64),
  financialStartDate: '2026-12-01' };
const owner = generateKeyPairSync('ed25519');
const operator = generateKeyPairSync('ed25519');
const trustedSigners = { owner: { owner1: owner.publicKey }, operator: { operator2: operator.publicKey } };
const now = new Date('2026-11-05T12:00:00.000Z');
const expiry = '2026-11-05T12:05:00.000Z';
const signApproval = (planDigest, action, nonce) => {
  const payload = Buffer.from(`${planDigest}\n${action}\n${expiry}\n${nonce}`);
  return { planDigest, action, nonce, expiresAt: expiry, signatures: [
    { role: 'owner', signerId: 'owner1', signature: sign(null, payload, owner.privateKey).toString('base64') },
    { role: 'operator', signerId: 'operator2', signature: sign(null, payload, operator.privateKey).toString('base64') },
  ] };
};

let replica;
let connection;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  connection = await mongoose.createConnection(replica.getUri('v3_approval_journal')).asPromise();
});
after(async () => { await connection?.close(); await replica?.stop(); });
beforeEach(async () => { await connection.db.dropDatabase(); });

test('controller requires an independent observation and one approval per ordered action', async () => {
  assert.equal(typeof createV3ProductionController, 'function');
  assert.equal(typeof createMongoApprovalJournal, 'function');
  const journal = createMongoApprovalJournal(connection.db.collection('cutover_approvals'));
  await journal.initialize();
  const events = [];
  const handled = [];
  const controller = createV3ProductionController({ trustedAllowlist: allowlist,
    observeControlPlane: async role => allowlist[role],
    observeConnection: async role => allowlist[role],
    trustedSigners, journal, now: () => now,
    handlers: {
      'read-source-inventory': async () => { handled.push('inventory'); return { checkpointId: 'inventory-1', evidenceDigest: 'c'.repeat(64) }; },
      'archive-source': async () => { handled.push('archive'); return { checkpointId: 'archive-1', evidenceDigest: 'd'.repeat(64) }; },
    }, log: event => events.push(event) });
  const digest = controller.validatePlan(plan).planDigest;
  await assert.rejects(controller.execute({ plan, action: 'archive-source',
    approval: signApproval(digest, 'archive-source', 'nonce-before') }), /preceding|order/i);
  const first = await controller.execute({ plan, action: 'read-source-inventory',
    approval: signApproval(digest, 'read-source-inventory', 'nonce-first') });
  assert.equal(first.status, 'complete');
  await assert.rejects(controller.execute({ plan, action: 'read-source-inventory',
    approval: signApproval(digest, 'read-source-inventory', 'nonce-first') }), /used|reserved|complete/i);
  await assert.rejects(controller.execute({ plan, action: 'read-source-inventory',
    approval: signApproval(digest, 'read-source-inventory', 'nonce-another') }), /used|reserved|complete/i);
  await controller.execute({ plan, action: 'archive-source',
    approval: signApproval(digest, 'archive-source', 'nonce-second') });
  assert.deepEqual(handled, ['inventory', 'archive']);
  assert.equal(await connection.db.collection('cutover_approvals').countDocuments(), 2);
  assert.equal(events.some(event => JSON.stringify(event).includes('nonce-first')), false);
  assert.equal(events.some(event => JSON.stringify(event).includes('signature')), false);
});

test('parallel approvals cannot run one step twice or reuse a nonce for another action', async () => {
  assert.equal(typeof createMongoApprovalJournal, 'function');
  const journal = createMongoApprovalJournal(connection.db.collection('cutover_approvals'));
  await journal.initialize();
  let calls = 0;
  const controller = createV3ProductionController({ trustedAllowlist: allowlist,
    observeControlPlane: async role => allowlist[role], observeConnection: async role => allowlist[role],
    trustedSigners, journal, now: () => now,
    handlers: { 'read-source-inventory': async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 30));
      return { checkpointId: 'inventory-1', evidenceDigest: 'e'.repeat(64) };
    }, 'archive-source': async () => { calls += 1; return { checkpointId: 'bad', evidenceDigest: 'f'.repeat(64) }; } },
    log: () => {} });
  const digest = controller.validatePlan(plan).planDigest;
  const approval = signApproval(digest, 'read-source-inventory', 'nonce-parallel');
  const results = await Promise.allSettled([
    controller.execute({ plan, action: 'read-source-inventory', approval }),
    controller.execute({ plan, action: 'read-source-inventory', approval }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(calls, 1);
  assert.equal(await connection.db.collection('cutover_approvals').countDocuments(), 1);
  await assert.rejects(controller.execute({ plan, action: 'archive-source',
    approval: signApproval(digest, 'archive-source', 'nonce-parallel') }), /used|reserved|complete/i);
});

test('observation mismatch and failed handler leave fail-closed checkpoints without secrets', async () => {
  assert.equal(typeof createMongoApprovalJournal, 'function');
  const journal = createMongoApprovalJournal(connection.db.collection('cutover_approvals'));
  await journal.initialize();
  const events = [];
  let calls = 0;
  const controller = createV3ProductionController({ trustedAllowlist: allowlist,
    observeControlPlane: async role => allowlist[role],
    observeConnection: async role => role === 'target'
      ? id('wrong-cluster', 'v3_target', 'rs-target') : allowlist[role],
    trustedSigners, journal, now: () => now,
    handlers: { 'read-source-inventory': async () => { calls += 1; return { checkpointId: 'unused', evidenceDigest: 'f'.repeat(64) }; } },
    log: event => events.push(event) });
  const digest = controller.validatePlan(plan).planDigest;
  await assert.rejects(controller.execute({ plan, action: 'read-source-inventory',
    approval: signApproval(digest, 'read-source-inventory', 'nonce-mismatch') }), /identity/i);
  assert.equal(calls, 0);
  assert.equal(await connection.db.collection('cutover_approvals').countDocuments(), 0);
  const failure = createV3ProductionController({ trustedAllowlist: allowlist,
    observeControlPlane: async role => allowlist[role], observeConnection: async role => allowlist[role],
    trustedSigners, journal, now: () => now,
    handlers: { 'read-source-inventory': async () => { throw new Error('mongodb+srv://secret:password@private'); } },
    log: event => events.push(event) });
  await assert.rejects(failure.execute({ plan, action: 'read-source-inventory',
    approval: signApproval(digest, 'read-source-inventory', 'nonce-fail') }), /step failed/i);
  const record = await connection.db.collection('cutover_approvals').findOne({});
  assert.equal(record.status, 'failed');
  assert.equal(record.checkpointId, null);
  assert.equal(JSON.stringify(events).includes('private'), false);
  await assert.rejects(failure.execute({ plan, action: 'read-source-inventory',
    approval: signApproval(digest, 'read-source-inventory', 'nonce-retry') }), /used|reserved|failed/i);
});

test('journal survives controller restart and a logging failure cannot undo a completed checkpoint', async () => {
  const collection = connection.db.collection('cutover_approvals');
  const journal = createMongoApprovalJournal(collection);
  await assert.rejects(journal.assertReady(), /index/i);
  await journal.initialize();
  const makeController = () => createV3ProductionController({ trustedAllowlist: allowlist,
    observeControlPlane: async role => allowlist[role], observeConnection: async role => allowlist[role],
    trustedSigners, journal: createMongoApprovalJournal(collection), now: () => now,
    handlers: { 'read-source-inventory': async () => ({ checkpointId: 'first', evidenceDigest: '1'.repeat(64) }) },
    log: () => { throw new Error('log sink unavailable'); } });
  const first = makeController();
  const digest = first.validatePlan(plan).planDigest;
  const approved = signApproval(digest, 'read-source-inventory', 'nonce-restart');
  assert.equal((await first.execute({ plan, action: 'read-source-inventory', approval: approved })).status, 'complete');
  const persisted = await collection.findOne({});
  assert.equal(persisted.status, 'complete');
  await assert.rejects(makeController().execute({ plan, action: 'read-source-inventory', approval: approved }),
    /used|reserved|complete/i);
});

test('all production steps require distinct signed approvals in order, including frozen archive', async () => {
  const journal = createMongoApprovalJournal(connection.db.collection('cutover_approvals'));
  await journal.initialize();
  const sequence = ['read-source-inventory', 'archive-source', 'restore-recovery', 'create-target',
    'apply-history', 'freeze-source-writes', 'archive-frozen-source', 'replay-final-meals',
    'configure-financial-boundary', 'configure-operations', 'deploy-backend', 'deploy-frontend',
    'switch-connection', 'open-writes'];
  const called = [];
  const handlers = Object.fromEntries(sequence.map((action, index) => [action, async () => {
    called.push(action);
    return { checkpointId: `step-${index}`, evidenceDigest: index.toString(16).padStart(64, '0') };
  }]));
  const controller = createV3ProductionController({ trustedAllowlist: allowlist,
    observeControlPlane: async role => allowlist[role], observeConnection: async role => allowlist[role],
    trustedSigners, journal, handlers, now: () => now });
  const digest = controller.validatePlan(plan).planDigest;
  for (const [index, action] of sequence.entries()) {
    const result = await controller.execute({ plan, action,
      approval: signApproval(digest, action, `nonce-step-${index}`) });
    assert.equal(result.status, 'complete');
  }
  assert.deepEqual(called, sequence);
  assert.equal(await connection.db.collection('cutover_approvals').countDocuments({ status: 'complete' }), 14);
});

test('controller rejects long-lived approval before it can reserve a nonce', async () => {
  const journal = createMongoApprovalJournal(connection.db.collection('cutover_approvals'));
  await journal.initialize();
  const controller = createV3ProductionController({ trustedAllowlist: allowlist,
    observeControlPlane: async role => allowlist[role], observeConnection: async role => allowlist[role],
    trustedSigners, journal, handlers: { 'read-source-inventory': async () => {
      throw new Error('should not run');
    } }, now: () => now });
  const digest = controller.validatePlan(plan).planDigest;
  const late = '2026-11-05T12:06:00.000Z';
  const nonce = 'nonce-long';
  const payload = Buffer.from(`${digest}\nread-source-inventory\n${late}\n${nonce}`);
  const approval = { planDigest: digest, action: 'read-source-inventory', nonce, expiresAt: late,
    signatures: [
      { role: 'owner', signerId: 'owner1', signature: sign(null, payload, owner.privateKey).toString('base64') },
      { role: 'operator', signerId: 'operator2', signature: sign(null, payload, operator.privateKey).toString('base64') },
    ] };
  await assert.rejects(controller.execute({ plan, action: 'read-source-inventory', approval }), /five minutes/i);
  assert.equal(await connection.db.collection('cutover_approvals').countDocuments(), 0);
});

test('observer failures redact connection secrets and a source-hosted journal is rejected', async () => {
  const journal = createMongoApprovalJournal(connection.db.collection('cutover_approvals'));
  await journal.initialize();
  const controller = createV3ProductionController({ trustedAllowlist: allowlist,
    observeControlPlane: async role => allowlist[role],
    observeConnection: async () => { throw new Error('mongodb+srv://user:secret@private'); },
    trustedSigners, journal, now: () => now,
    handlers: { 'read-source-inventory': async () => ({ checkpointId: 'never',
      evidenceDigest: 'f'.repeat(64) }) } });
  const digest = controller.validatePlan(plan).planDigest;
  await assert.rejects(controller.execute({ plan, action: 'read-source-inventory',
    approval: signApproval(digest, 'read-source-inventory', 'nonce-observer') }), error => {
    assert.match(error.message, /observation/i);
    assert.doesNotMatch(error.message, /secret|mongodb/i);
    return true;
  });
  assert.equal(await connection.db.collection('cutover_approvals').countDocuments(), 0);
  const unsafeJournal = { ...journal, databaseName: allowlist.source.databaseName };
  const unsafe = createV3ProductionController({ trustedAllowlist: allowlist,
    observeControlPlane: async role => allowlist[role], observeConnection: async role => allowlist[role],
    trustedSigners, journal: unsafeJournal, now: () => now,
    handlers: { 'read-source-inventory': async () => ({ checkpointId: 'never',
      evidenceDigest: 'f'.repeat(64) }) } });
  await assert.rejects(unsafe.execute({ plan, action: 'read-source-inventory',
    approval: signApproval(digest, 'read-source-inventory', 'nonce-unsafe-journal') }), /journal.*separate/i);
});
