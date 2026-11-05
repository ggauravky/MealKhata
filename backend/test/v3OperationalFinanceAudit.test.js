import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { auditV3OperationalFinances } from '../src/migrations/v3OperationalFinanceAudit.service.js';

let replica;
let connection;
const boundary = '2026-11-05';
const at = date => new Date(`${date}T12:00:00.000Z`);

before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  connection = await mongoose.createConnection(replica.getUri('v3_finance_audit')).asPromise();
});
after(async () => { await connection?.close(); await replica?.stop(); });
beforeEach(async () => { await connection.db.dropDatabase(); });

test('accepts post-boundary receipts linked to a historical Stay context', async () => {
  const db = connection.db;
  await db.collection('hostel_stays').insertOne({ stayId: 'stay-old', memberId: 'gaurav', joinedOn: '2026-10-01' });
  await db.collection('hostel_deposit_accounts').insertOne({ depositAccountId: 'account-new', stayId: 'stay-old', memberId: 'gaurav' });
  await db.collection('hostel_deposit_transactions').insertOne({ depositTransactionId: 'receipt-new',
    depositAccountId: 'account-new', stayId: 'stay-old', memberId: 'gaurav', type: 'RECEIVED',
    amountPaise: 1000, status: 'recorded', recordedAt: at(boundary), reference: 'TEST-RECEIPT' });
  await db.collection('payment_reference_claims').insertOne({ normalizedReference: 'TEST-RECEIPT',
    ledger: 'HOSTEL_DEPOSIT', documentId: 'receipt-new', memberId: 'gaurav' });
  const result = await auditV3OperationalFinances(db, boundary);
  assert.deepEqual(result.issues, []);
});

test('accepts exact reclassification and a credit-funded reimbursement', async () => {
  const db = connection.db;
  await db.collection('hostel_stays').insertOne({ stayId: 'stay-historical', memberId: 'nikhil', joinedOn: '2026-10-01' });
  await db.collection('hostel_deposit_accounts').insertOne({ depositAccountId: 'account-new',
    stayId: 'stay-historical', memberId: 'nikhil' });
  await db.collection('hostel_deposit_transactions').insertOne({ depositTransactionId: 'receipt-new',
    depositAccountId: 'account-new', stayId: 'stay-historical', memberId: 'nikhil',
    type: 'RECEIVED', amountPaise: 1000, status: 'reclassified',
    reclassificationId: 'reclass-new', recordedAt: at(boundary) });
  await db.collection('payment_reclassifications').insertOne({ reclassificationId: 'reclass-new',
    sourceDepositTransactionId: 'receipt-new', memberId: 'nikhil', amountPaise: 1000,
    paymentDate: at(boundary), allocations: [{ amountPaise: 1000 }] });
  await db.collection('unallocated_credits').insertOne({ creditId: 'credit-new',
    reclassificationId: 'reclass-new', sourceDepositTransactionId: 'receipt-new',
    memberId: 'nikhil', amountPaise: 1000, allocatedAmountPaise: 250,
    settledAmountPaise: 0, remainingAmountPaise: 750, paymentDate: at(boundary) });
  await db.collection('expenses').insertOne({ expenseId: 'expense-new', date: boundary,
    month: '2026-11', paidByMemberId: 'gaurav', amountPaise: 500,
    allocations: [{ memberId: 'nikhil', amountPaise: 500 }] });
  await db.collection('expense_reimbursements').insertOne({ reimbursementId: 'reimb-new',
    expenseId: 'expense-new', expenseMonth: '2026-11', fromMemberId: 'nikhil',
    toMemberId: 'gaurav', amountPaise: 250, status: 'recorded', recordedAt: at(boundary),
    fundingSource: 'UNALLOCATED_CREDIT', sourceCreditAllocationId: 'alloc-new' });
  await db.collection('credit_allocations').insertOne({ creditAllocationId: 'alloc-new',
    creditId: 'credit-new', reclassificationId: 'reclass-new',
    sourceDepositTransactionId: 'receipt-new', memberId: 'nikhil',
    destinationType: 'EXPENSE_REIMBURSEMENT', targetRecordId: 'expense-new',
    targetLedgerRecordId: 'reimb-new', amountPaise: 250, completedAt: at(boundary) });
  const result = await auditV3OperationalFinances(db, boundary);
  assert.deepEqual(result.issues, []);
});

test('rejects orphan and pre-boundary reimbursement obligations', async () => {
  const db = connection.db;
  await db.collection('expenses').insertOne({ expenseId: 'old-expense', date: '2026-11-04', month: '2026-11',
    paidByMemberId: 'gaurav', amountPaise: 1001, allocations: [{ memberId: 'nikhil', amountPaise: 501 }] });
  await db.collection('expense_reimbursements').insertMany([
    { reimbursementId: 'reimbursement-old', expenseId: 'old-expense', expenseMonth: '2026-11',
      fromMemberId: 'nikhil', toMemberId: 'gaurav', amountPaise: 501, status: 'recorded', recordedAt: at(boundary) },
    { reimbursementId: 'reimbursement-orphan', expenseId: 'missing', expenseMonth: '2026-11',
      fromMemberId: 'nikhil', toMemberId: 'gaurav', amountPaise: 1, status: 'recorded', recordedAt: at(boundary) },
  ]);
  const result = await auditV3OperationalFinances(db, boundary);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some(issue => issue.includes('old-expense') && issue.includes('boundary')));
  assert.ok(result.issues.some(issue => issue.includes('reimbursement-orphan') && issue.includes('missing expense')));
});

test('rejects duplicate obligations, impossible credit balances and orphan claims', async () => {
  const db = connection.db;
  await db.collection('room_charges').insertMany([
    { chargeId: 'charge-a', memberId: 'gaurav', month: '2026-11', baseAmountPaise: 1000, adjustments: [] },
    { chargeId: 'charge-b', memberId: 'gaurav', month: '2026-11', baseAmountPaise: 1000, adjustments: [] },
  ]);
  await db.collection('unallocated_credits').insertOne({ creditId: 'credit-bad', reclassificationId: 'missing',
    sourceDepositTransactionId: 'missing', memberId: 'gaurav', amountPaise: 1000,
    allocatedAmountPaise: 250, settledAmountPaise: 0, remainingAmountPaise: 751,
    paymentDate: at(boundary) });
  await db.collection('payment_reference_claims').insertOne({ normalizedReference: 'MISSING-CLAIM',
    ledger: 'MESS_PAYMENT', documentId: 'missing-payment', memberId: 'gaurav' });
  const result = await auditV3OperationalFinances(db, boundary);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some(issue => issue.includes('duplicate room charge')));
  assert.ok(result.issues.some(issue => issue.includes('credit-bad') && issue.includes('conservation')));
  assert.ok(result.issues.some(issue => issue.includes('MISSING-CLAIM') && issue.includes('missing')));
});

test('rejects credit allocations tied to pre-boundary or missing obligations', async () => {
  const db = connection.db;
  await db.collection('credit_allocations').insertMany([
    { creditAllocationId: 'alloc-before', creditId: 'credit-a', reclassificationId: 'reclass-a',
      sourceDepositTransactionId: 'receipt-a', memberId: 'gaurav', destinationType: 'MESS',
      targetRecordId: '2026-10', amountPaise: 100, completedAt: at(boundary) },
    { creditAllocationId: 'alloc-orphan', creditId: 'credit-a', reclassificationId: 'reclass-a',
      sourceDepositTransactionId: 'receipt-a', memberId: 'gaurav', destinationType: 'ROOM_FEE',
      targetRecordId: 'missing-charge', amountPaise: 100, completedAt: at(boundary) },
  ]);
  const result = await auditV3OperationalFinances(db, boundary);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some(issue => issue.includes('alloc-before') && issue.includes('boundary')));
  assert.ok(result.issues.some(issue => issue.includes('alloc-orphan') && issue.includes('missing')));
});

test('checks embedded charge adjustments and clearance snapshots by effective date', async () => {
  const db = connection.db;
  await db.collection('hostel_stays').insertOne({ stayId: 'historical-context', memberId: 'gaurav',
    joinedOn: '2026-10-01' });
  await db.collection('room_charges').insertOne({ chargeId: 'charge-adjusted', memberId: 'gaurav',
    month: '2026-12', baseAmountPaise: 1000, adjustments: [
      { adjustmentId: 'old-adjustment', amountPaise: 10, createdAt: at('2026-11-04') },
    ] });
  await db.collection('hostel_clearances').insertMany([
    { clearanceId: 'clearance-valid', stayId: 'historical-context', memberId: 'gaurav',
      financialAsOf: at(boundary) },
    { clearanceId: 'clearance-old', stayId: 'historical-context', memberId: 'gaurav',
      financialAsOf: at('2026-11-04') },
  ]);
  const result = await auditV3OperationalFinances(db, boundary);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some(issue => issue.includes('old-adjustment') && issue.includes('boundary')));
  assert.ok(result.issues.some(issue => issue.includes('clearance-old') && issue.includes('boundary')));
  assert.equal(result.issues.some(issue => issue.includes('clearance-valid')), false);
});

async function auditWhileCommitting(triggerCollection, delayedCollection, write) {
  const db = connection.db;
  let triggerRead;
  let writeFinished;
  const afterTrigger = new Promise(resolve => { triggerRead = resolve; });
  const afterWrite = new Promise(resolve => { writeFinished = resolve; });
  const observedDb = {
    client: db.client,
    collection(name) {
      const collection = db.collection(name);
      if (name !== triggerCollection && name !== delayedCollection) return collection;
      return { find(query, options) {
        const cursor = collection.find(query, options);
        return { async toArray() {
          if (name === delayedCollection) await afterWrite;
          const rows = await cursor.toArray();
          if (name === triggerCollection) triggerRead();
          return rows;
        } };
      } };
    },
  };
  const writer = (async () => {
    await afterTrigger;
    const session = await connection.startSession();
    try { await session.withTransaction(() => write(db, session)); }
    finally { await session.endSession(); writeFinished(); }
  })();
  const result = await auditV3OperationalFinances(observedDb, boundary);
  await writer;
  return result;
}

test('concurrent payment and reference claim are read from one ledger snapshot', async () => {
  const result = await auditWhileCommitting('payments', 'payment_reference_claims', async (db, session) => {
    await db.collection('payments').insertOne({ paymentId: 'concurrent-payment', memberId: 'gaurav',
      month: '2026-11', amountPaise: 101, recordedAt: at(boundary), upiReference: 'NEW-REF' }, { session });
    await db.collection('payment_reference_claims').insertOne({ normalizedReference: 'NEW-REF',
      ledger: 'MESS_PAYMENT', documentId: 'concurrent-payment', memberId: 'gaurav' }, { session });
  });
  assert.equal(result.passed, true, result.issues.join('; '));
  assert.equal(result.counts.payments, 0);
  assert.equal(result.counts.payment_reference_claims, 0);
});

test('concurrent reimbursement cannot be paired with an earlier expense balance', async () => {
  await connection.db.collection('expenses').insertOne({ expenseId: 'expense-race',
    date: boundary, month: '2026-11', paidByMemberId: 'gaurav', amountPaise: 100,
    allocations: [{ memberId: 'nikhil', amountPaise: 100 }] });
  const result = await auditWhileCommitting('expenses', 'expense_reimbursements', async (db, session) => {
    await db.collection('expenses').updateOne({ expenseId: 'expense-race' },
      { $set: { amountPaise: 200, allocations: [{ memberId: 'nikhil', amountPaise: 200 }] } }, { session });
    await db.collection('expense_reimbursements').insertOne({ reimbursementId: 'reimb-race',
      expenseId: 'expense-race', expenseMonth: '2026-11', fromMemberId: 'nikhil',
      toMemberId: 'gaurav', amountPaise: 200, status: 'recorded', recordedAt: at(boundary) }, { session });
  });
  assert.equal(result.passed, true, result.issues.join('; '));
  assert.equal(result.counts.expense_reimbursements, 0);
});

test('concurrent deposit receipt and reference claim cannot split across reads', async () => {
  await connection.db.collection('hostel_stays').insertOne({ stayId: 'stay-race', memberId: 'gaurav' });
  await connection.db.collection('hostel_deposit_accounts').insertOne({
    depositAccountId: 'deposit-race', stayId: 'stay-race', memberId: 'gaurav' });
  const result = await auditWhileCommitting('hostel_deposit_transactions', 'payment_reference_claims',
    async (db, session) => {
      await db.collection('hostel_deposit_transactions').insertOne({ depositTransactionId: 'receipt-race',
        depositAccountId: 'deposit-race', stayId: 'stay-race', memberId: 'gaurav',
        type: 'RECEIVED', amountPaise: 100, status: 'recorded', recordedAt: at(boundary),
        reference: 'DEPOSIT-REF' }, { session });
      await db.collection('payment_reference_claims').insertOne({ normalizedReference: 'DEPOSIT-REF',
        ledger: 'HOSTEL_DEPOSIT', documentId: 'receipt-race', memberId: 'gaurav' }, { session });
    });
  assert.equal(result.passed, true, result.issues.join('; '));
  assert.equal(result.counts.hostel_deposit_transactions, 0);
  assert.equal(result.counts.payment_reference_claims, 0);
});

test('concurrent credit allocation cannot see a funded ledger from another instant', async () => {
  const db = connection.db;
  await db.collection('hostel_stays').insertOne({ stayId: 'stay-credit', memberId: 'nikhil' });
  await db.collection('hostel_deposit_accounts').insertOne({ depositAccountId: 'account-credit',
    stayId: 'stay-credit', memberId: 'nikhil' });
  await db.collection('hostel_deposit_transactions').insertOne({ depositTransactionId: 'receipt-credit',
    depositAccountId: 'account-credit', stayId: 'stay-credit', memberId: 'nikhil',
    type: 'RECEIVED', amountPaise: 1000, status: 'reclassified', reclassificationId: 'reclass-credit',
    recordedAt: at(boundary) });
  await db.collection('payment_reclassifications').insertOne({ reclassificationId: 'reclass-credit',
    sourceDepositTransactionId: 'receipt-credit', memberId: 'nikhil', amountPaise: 1000,
    paymentDate: at(boundary), allocations: [{ amountPaise: 1000 }] });
  await db.collection('unallocated_credits').insertOne({ creditId: 'credit-race',
    reclassificationId: 'reclass-credit', sourceDepositTransactionId: 'receipt-credit',
    memberId: 'nikhil', amountPaise: 1000, allocatedAmountPaise: 0,
    settledAmountPaise: 0, remainingAmountPaise: 1000, paymentDate: at(boundary) });
  await db.collection('expenses').insertOne({ expenseId: 'expense-credit', date: boundary,
    month: '2026-11', paidByMemberId: 'gaurav', amountPaise: 100,
    allocations: [{ memberId: 'nikhil', amountPaise: 100 }] });
  const result = await auditWhileCommitting('expense_reimbursements', 'credit_allocations',
    async (target, session) => {
      await target.collection('expense_reimbursements').insertOne({ reimbursementId: 'reimb-credit',
        expenseId: 'expense-credit', expenseMonth: '2026-11', fromMemberId: 'nikhil',
        toMemberId: 'gaurav', amountPaise: 100, status: 'recorded', recordedAt: at(boundary),
        sourceCreditAllocationId: 'alloc-credit' }, { session });
      await target.collection('credit_allocations').insertOne({ creditAllocationId: 'alloc-credit',
        creditId: 'credit-race', reclassificationId: 'reclass-credit',
        sourceDepositTransactionId: 'receipt-credit', memberId: 'nikhil',
        destinationType: 'EXPENSE_REIMBURSEMENT', targetRecordId: 'expense-credit',
        targetLedgerRecordId: 'reimb-credit', amountPaise: 100, completedAt: at(boundary) }, { session });
      await target.collection('unallocated_credits').updateOne({ creditId: 'credit-race' },
        { $set: { allocatedAmountPaise: 100, remainingAmountPaise: 900 } }, { session });
    });
  assert.equal(result.passed, true, result.issues.join('; '));
  assert.equal(result.counts.expense_reimbursements, 0);
  assert.equal(result.counts.credit_allocations, 0);
});
