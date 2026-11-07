import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MonthlySettlement } from '../src/settlement/monthlySettlement.model.js';
import { monthlySettlementRepository } from '../src/settlement/monthlySettlement.repository.js';
import { serializeSettlement } from '../src/settlement/monthlySettlement.serializer.js';

let replSet;
const fourth = 'student_0123456789abcdef0123456789abcdef';
const member = (bill) => ({ displayName: 'Fourth Student', morningParticipationCount: 1,
  morningShareUnits: 6, totalShareUnits: 6, billAmountPaise: bill, paidAmountPaise: bill, remainingAmountPaise: 0 });
const snapshot = (bill) => ({
  studentIds: [fourth], members: { [fourth]: member(bill) },
  room: { morningPhysicalPlates: 1, totalPhysicalPlates: 1, billAmountPaise: bill, paidAmountPaise: bill, remainingAmountPaise: 0 },
  rates: { morningPricePaise: bill, nightPricePaise: 100 }, pricingAdjustments: [],
});

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'mealkhata_task10_settlement_test' });
  await MonthlySettlement.init();
});

after(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

test('replica-set settlement stores fourth student, rejects concurrent close, and preserves reopen history', async () => {
  const create = (settlementId) => monthlySettlementRepository.createSettlement({
    settlementId, month: '2026-09', sequence: 1, snapshotVersion: 3,
    snapshot: snapshot(101), closedByRole: 'superadmin',
  });
  const results = await Promise.allSettled([create('task10-a'), create('task10-b')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const active = await monthlySettlementRepository.findActiveByMonth('2026-09');
  assert.equal(serializeSettlement(active).snapshot.members[fourth].billAmountPaise, 101);

  await monthlySettlementRepository.reopenSettlement({ settlementId: active.settlementId, reopenReason: 'Verified correction' });
  await monthlySettlementRepository.createSettlement({
    settlementId: 'task10-c', month: '2026-09', sequence: 2, snapshotVersion: 3,
    snapshot: snapshot(102), closedByRole: 'superadmin',
  });
  const history = await monthlySettlementRepository.findHistoryByMonth('2026-09');
  assert.deepEqual(history.map((item) => item.sequence), [2, 1]);
  assert.equal(history[1].snapshot.members[fourth].billAmountPaise, 101);
});

test('replica-set reads a legacy version 2 settlement without modifying it', async () => {
  await MonthlySettlement.create({ settlementId: 'task10-legacy', month: '2026-08', sequence: 1,
    snapshotVersion: 2, closedByRole: 'superadmin', snapshot: {
      members: { gaurav: { billAmountPaise: 100, paidAmountPaise: 100, remainingAmountPaise: 0 } },
      room: { billAmountPaise: 100, paidAmountPaise: 100, remainingAmountPaise: 0 },
      rates: { morningPricePaise: 100, nightPricePaise: 100 },
    } });
  const beforeDoc = await MonthlySettlement.findOne({ settlementId: 'task10-legacy' }).lean();
  assert.equal(serializeSettlement(beforeDoc).snapshot.members.gaurav.billAmountPaise, 100);
  const afterDoc = await MonthlySettlement.findOne({ settlementId: 'task10-legacy' }).lean();
  assert.deepEqual(afterDoc.snapshot, beforeDoc.snapshot);
});
