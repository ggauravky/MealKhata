import assert from 'node:assert/strict';
import { test } from 'node:test';

const { buildV3RollbackWriteRegister } =
  await import('../src/migrations/production/v3RollbackRegister.service.js').catch(() => ({}));

test('rollback register inventories additions, updates and removals without leaking credentials', () => {
  assert.equal(typeof buildV3RollbackWriteRegister, 'function');
  const before = { databaseName: 'candidate', collectionOrder: ['meal_days', 'payments', 'user_accounts'],
    documents: { meal_days: [{ _id: 'old-day', date: '2026-09-30', importedFromLegacy: true }],
      payments: [], user_accounts: [{ _id: 'admin', email: 'admin@example.test', passwordHash: 'secret-hash' }] } };
  const after = { databaseName: 'candidate', collectionOrder: ['meal_days', 'payments', 'user_accounts'],
    documents: { meal_days: [{ _id: 'old-day', date: '2026-09-30', importedFromLegacy: true },
      { _id: 'new-day', date: '2026-11-02', importedFromLegacy: false }],
    payments: [{ _id: 'p1', paymentId: 'payment-1', memberId: 'gaurav', amountPaise: 125,
      upiReference: 'BANK-ONE', recordedAt: new Date('2026-11-02T12:00:00Z') }],
    user_accounts: [{ _id: 'admin', email: 'admin@example.test', passwordHash: 'new-secret-hash' }] } };
  const result = buildV3RollbackWriteRegister({ before, after, writesStopped: true });
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries.map(item => [item.collection, item.change]), [
    ['meal_days', 'ADDED'], ['payments', 'ADDED'], ['user_accounts', 'UPDATED']]);
  assert.equal(result.entries.find(item => item.collection === 'payments').amountPaise, 125);
  assert.equal(result.entries.find(item => item.collection === 'payments').externalReference, 'BANK-ONE');
  assert.equal(JSON.stringify(result).includes('secret-hash'), false);
  assert.throws(() => buildV3RollbackWriteRegister({ before, after, writesStopped: false }), /writes|frozen/i);
});

test('rollback register flags duplicate external references across new ledgers', () => {
  const before = { databaseName: 'candidate', collectionOrder: [], documents: {} };
  const after = { databaseName: 'candidate', collectionOrder: ['payments', 'room_payments'],
    documents: { payments: [{ _id: 'p1', upiReference: 'same  ref', amountPaise: 100 }],
      room_payments: [{ _id: 'r1', reference: 'SAME REF', amountPaise: 100 }] } };
  const register = buildV3RollbackWriteRegister({ before, after, writesStopped: true });
  assert.equal(register.duplicateExternalReferences.length, 1);
  assert.equal(register.duplicateExternalReferences[0], 'SAME REF');
});

test('restricted register covers all v3-only meal, finance, student and account domains', () => {
  const names = ['meal_days', 'meal_history_corrections', 'payments', 'room_charges',
    'room_payments', 'expenses', 'expense_reimbursements',
    'hostel_deposit_transactions', 'unallocated_credits', 'credit_allocations',
    'students', 'user_accounts'];
  const before = { databaseName: 'target_db', collectionOrder: names,
    documents: Object.fromEntries(names.map(name => [name, []])) };
  const after = { ...before, documents: Object.fromEntries(names.map((name, index) =>
    [name, [{ _id: `new-${index}`, memberId: 'fourth-student', amountPaise: index + 1,
      actorId: 'super-admin', createdAt: '2026-11-06T12:00:00.000Z',
      passwordHash: 'must-never-leak', jwtSecret: 'must-never-leak' }]])) };
  after.documents.payments[0].upiReference = 'BANK-NEW-1';
  const register = buildV3RollbackWriteRegister({ before, after, writesStopped: true });
  assert.deepEqual(register.entries.map(row => row.collection).sort(), [...names].sort());
  assert.equal(register.entries.find(row => row.collection === 'payments').externalReference,
    'BANK-NEW-1');
  assert.equal(JSON.stringify(register).includes('must-never-leak'), false);
  assert.match(register.registerSha256, /^[a-f0-9]{64}$/);
});
