import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validatePlateAllocation,
  getEffectiveMealAllocation,
  splitMealCost,
  deriveParticipationStatuses,
  createPresetAllocation,
} from '../src/meals/plateAllocation.service.js';
import { serializeMealDay } from '../src/meals/meal.serializer.js';
import { createDefaultMealDay } from '../src/meals/meal.defaults.js';
import { MealDay } from '../src/meals/meal.model.js';
import { getMealPath } from '../src/meals/meal.constants.js';
import { createMealService } from '../src/meals/meal.service.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { buildLegacyMealSnapshot } from '../src/migrations/legacyMealSnapshot.service.js';
import { resolvePhysicalPlateLimit } from '../src/meals/plateAllocation.constants.js';

const ids = ['gaurav', 'nikhil', 'devansh', 'student_0123456789abcdef0123456789abcdef'];

test('four eligible students retain all shares and exact cost with stable persisted order', () => {
  const allocation = validatePlateAllocation({
    mode: 'custom',
    plates: [
      { shares: { gaurav: 3, [ids[3]]: 3 } },
      { shares: { nikhil: 2, devansh: 2, [ids[3]]: 2 } },
    ],
  }, { participants: ids, maxPhysicalPlates: 4 });
  const effective = getEffectiveMealAllocation({ customAllocation: allocation, participants: ids });
  const cost = splitMealCost({ date: '2026-11-03', mealType: 'morning', effectiveAllocation: effective, pricePaise: 101, participants: ids });
  assert.deepEqual(deriveParticipationStatuses(effective, { participants: ids }), Object.fromEntries(ids.map((id) => [id, 'taking'])));
  assert.equal(cost.members[ids[3]].shareUnits, 5);
  assert.equal(Object.values(cost.memberAmountsPaise).reduce((sum, paise) => sum + paise, 0), 202);
  assert.equal(cost.members[ids[3]].amountPaise, 84);
});

test('one through twelve students conserve exact morning and night costs with stable order', () => {
  for (let count = 1; count <= 12; count += 1) {
    const participants = Array.from({ length: count }, (_, index) => `student_${index}`);
    const allocation = validatePlateAllocation({ mode: 'custom', plates: participants.map((studentId) => ({ shares: { [studentId]: 6 } })) }, {
      participants,
      maxPhysicalPlates: Math.max(3, count),
    });
    for (const mealType of ['morning', 'night']) {
      const first = splitMealCost({ date: '2026-11-03', mealType, allocation, participants, pricePaise: 101 });
      const second = splitMealCost({ date: '2026-11-03', mealType, allocation, participants, pricePaise: 101 });
      assert.deepEqual(first.memberAmountsPaise, second.memberAmountsPaise);
      assert.equal(Object.values(first.memberAmountsPaise).reduce((a, b) => a + b, 0), count * 101);
    }
  }
});

test('saved v3 day serializes a fourth student in both daily totals and custom shares', () => {
  const day = createDefaultMealDay('2026-11-03', ids);
  day.participantOrder = ids;
  day.meals.morning[ids[3]] = 'taking';
  day.allocations.morning = { mode: 'custom', plates: [{ shares: { [ids[3]]: 6 } }] };
  const serialized = serializeMealDay(day, day.date);
  assert.equal(serialized.dailyCostSummary.members[ids[3]].morningAmountPaise, 5000);
  assert.equal(serialized.allocations.morning.cost.memberAmountsPaise[ids[3]], 5000);
});

test('four individual plates and dynamic status paths validate in v3 storage', async () => {
  const day = createDefaultMealDay('2026-11-03', ids);
  day.allocations.morning = { mode: 'custom', plates: ids.map((id) => ({ shares: { [id]: 6 } })) };
  await new MealDay(day).validate();
  assert.equal(getMealPath('morning', ids[3]), `meals.morning.${ids[3]}`);
});

test('a fourth student can take a meal and receive exact cost through the service', async () => {
  const repository = new InMemoryMealRepository();
  const students = { listEligibleOn: async () => ids.map((studentId) => ({ studentId })) };
  const service = createMealService({ repository, students });
  const result = await service.changeStatus({ date: '2026-11-03', mealType: 'morning', memberId: ids[3], status: 'taking', actorRole: 'admin' });
  assert.equal(result.data.meals.morning[ids[3]], 'taking');
  assert.equal(result.data.dailyCostSummary.members[ids[3]].morningAmountPaise, 5000);
  assert.deepEqual(result.data.participantOrder, ids);
});

test('four-student allocation updates statuses and exact amounts atomically', async () => {
  const repository = new InMemoryMealRepository();
  const students = { listEligibleOn: async () => ids.map((studentId) => ({ studentId })) };
  const service = createMealService({ repository, students });
  const result = await service.setAllocation({
    date: '2026-11-03', mealType: 'morning', actorRole: 'superadmin',
    allocation: { mode: 'custom', plates: [{ shares: { gaurav: 3, [ids[3]]: 3 } }] },
  });
  assert.equal(result.data.meals.morning[ids[3]], 'taking');
  assert.equal(result.data.dailyCostSummary.members[ids[3]].morningAmountPaise, 2500);
  assert.equal(result.data.dailyCostSummary.room.morningAmountPaise, 5000);
});

test('calendar counts a fourth student from a saved day', async () => {
  const day = createDefaultMealDay('2026-11-03', ids);
  day.meals.morning[ids[3]] = 'taking';
  const repository = { findInDateRange: async () => [day] };
  const month = await createMonthMealService({ repository }).getMonth('2026-11');
  const third = month.days.find((item) => item.date === day.date);
  assert.equal(third.counts.morningTaking, 1);
  assert.equal(third.counts.morningNotSet, 3);
  assert.equal(third.dailyCostSummary.members[ids[3]].morningAmountPaise, 5000);
});

test('unsaved calendar dates use each date eligible roster without writing meal days', async () => {
  const calls = [];
  const repository = { findInDateRange: async () => [] };
  const students = { listEligibleOn: async (date) => {
    calls.push(date);
    return date < '2026-11-15' ? [] : ids.map((studentId) => ({ studentId }));
  } };
  const month = await createMonthMealService({ repository, students }).getMonth('2026-11');
  assert.equal(month.days.find((day) => day.date === '2026-11-14').counts.morningNotSet, 0);
  assert.equal(month.days.find((day) => day.date === '2026-11-15').counts.morningNotSet, 4);
  assert.equal(calls.length, 30);
});

test('a v3 stored day requires an explicit unique participant order', async () => {
  await new MealDay(createDefaultMealDay('2026-11-04', [])).validate();
  const day = createDefaultMealDay('2026-11-03', ids);
  delete day.participantOrder;
  await assert.rejects(new MealDay(day).validate(), /participantOrder/i);
  const stray = createDefaultMealDay('2026-11-05', ['gaurav']);
  stray.allocations.morning = { mode: 'custom', plates: [{ shares: { stranger: 6 } }] };
  await assert.rejects(new MealDay(stray).validate(), /participant|recorded|order/i);
});

test('physical plate limit grows with roster and honors a safe configured cap', () => {
  assert.equal(resolvePhysicalPlateLimit(5), 5);
  assert.equal(resolvePhysicalPlateLimit(5, '4'), 4);
  assert.throws(() => resolvePhysicalPlateLimit(5, '101'), /physical plate limit/i);
  assert.throws(() => validatePlateAllocation({ mode: 'custom', plates: ids.map((id) => ({ shares: { [id]: 6 } })) }, {
    participants: ids,
    maxPhysicalPlates: resolvePhysicalPlateLimit(4, '3'),
  }), /more than 3/i);
});

test('cost splitter rejects dropped or invalid shares instead of inventing or losing paise', () => {
  assert.throws(() => splitMealCost({
    effectiveAllocation: { plates: [{ shares: { gaurav: 3, stranger: 3 } }] },
    participants: ['gaurav'], pricePaise: 101,
  }), /unknown|participant/i);
  assert.throws(() => splitMealCost({
    effectiveAllocation: { plates: [{ shares: { gaurav: 5 } }] },
    participants: ['gaurav'], pricePaise: 101,
  }), /six|6/i);
  assert.throws(() => getEffectiveMealAllocation({
    customAllocation: { mode: 'custom', plates: [{ shares: { gaurav: 3, stranger: 3 } }] },
    participants: ['gaurav'],
  }), /unknown|participant/i);
  assert.throws(() => splitMealCost({
    allocation: { plates: [{ shares: { gaurav: 6 } }] },
    participants: ['gaurav'], pricePaise: Number.MAX_SAFE_INTEGER,
  }), /safe|overflow/i);
});

test('financial mutation locks the fourth student and prior allocation participants', async () => {
  const inner = new InMemoryMealRepository();
  const locked = [];
  const repository = new Proxy(inner, { get(target, key) {
    if (key === 'executeFinancialMutation') return async ({ memberIds }, work) => {
      locked.push(memberIds);
      return work({ session: null, guard: async () => {} });
    };
    return target[key];
  } });
  const students = { listEligibleOn: async () => ids.map((studentId) => ({ studentId })) };
  const service = createMealService({ repository, students });
  await service.changeStatus({ date: '2026-11-03', mealType: 'morning', memberId: ids[3], status: 'taking', actorRole: 'admin' });
  assert.ok(locked[0].includes(ids[3]));
});

test('financial guard includes a concurrently created saved roster inside the transaction', async () => {
  const inner = new InMemoryMealRepository();
  await inner.create(createDefaultMealDay('2026-11-03', ids));
  let firstRead = true;
  let guarded = [];
  const repository = new Proxy(inner, { get(target, key) {
    if (key === 'findByDate') return async (...args) => {
      if (firstRead) { firstRead = false; return null; }
      return target.findByDate(...args);
    };
    if (key === 'executeFinancialMutation') return async ({ memberIds }, work) => work({
      session: {}, guard: async ({ memberIds: currentIds } = {}) => { guarded = currentIds ?? memberIds; },
    });
    return target[key];
  } });
  const students = { listEligibleOn: async () => ids.slice(0, 3).map((studentId) => ({ studentId })) };
  const service = createMealService({ repository, students });
  await service.setPriceOverride({ date: '2026-11-03', mealType: 'morning', pricePaise: 5151, actorRole: 'superadmin' });
  assert.ok(guarded.includes(ids[3]));
});

test('individual preset creates one full plate for each selected eligible student', () => {
  const allocation = createPresetAllocation('individual', { participants: ids, members: ids });
  assert.equal(allocation.plates.length, 4);
  assert.equal(allocation.plates[3].shares[ids[3]], 6);
  assert.equal(Object.values(allocation.plates[3].shares).reduce((a, b) => a + b, 0), 6);
});

test('three-way shared preset uses selected students including a new identity', () => {
  const selected = ['gaurav', 'nikhil', ids[3]];
  const allocation = createPresetAllocation('one_plate_three_shared', { participants: ids, members: selected });
  assert.deepEqual(Object.fromEntries(Object.entries(allocation.plates[0].shares).filter(([, units]) => units > 0)), {
    gaurav: 2, nikhil: 2, [ids[3]]: 2,
  });
});

test('saved meal rejects an identity absent from its persisted participant order', async () => {
  const repository = new InMemoryMealRepository();
  await repository.create(createDefaultMealDay('2026-11-03', ids));
  const service = createMealService({ repository, students: { listEligibleOn: async () => [...ids, 'student_new'].map((studentId) => ({ studentId })) } });
  await assert.rejects(service.changeStatus({ date: '2026-11-03', mealType: 'morning', memberId: 'student_new', status: 'taking', actorRole: 'admin' }), /participant|saved meal/i);
  const day = await repository.findByDate('2026-11-03');
  assert.equal(Object.hasOwn(day.meals.morning, 'student_new'), false);
});

test('historical reads use verified legacy-v2 costs and reject a one-paisa snapshot mismatch', async () => {
  const day = createDefaultMealDay('2026-09-09', ids.slice(0, 3));
  delete day.schemaVersion;
  delete day.participantOrder;
  day.meals.morning.gaurav = 'taking';
  day.revision = 1;
  const repository = new InMemoryMealRepository();
  await repository.create(day);
  const snapshot = buildLegacyMealSnapshot(await repository.findByDate(day.date));
  const snapshots = { findByDateAndVersion: async () => snapshot };
  const service = createMealService({ repository, snapshots, students: { listEligibleOn: async () => [] } });
  const read = await service.getDay(day.date);
  assert.equal(read.dailyCostSummary.members.gaurav.morningAmountPaise, snapshot.costs.morning.memberAmountsPaise.gaurav);
  assert.equal(read.calculationVersion, 'legacy-v2');
  snapshot.costs.morning.memberAmountsPaise.gaurav += 1;
  await assert.rejects(service.getDay(day.date), /snapshot.*mismatch/i);
});

test('historical read fails closed when the frozen snapshot is missing', async () => {
  const day = createDefaultMealDay('2026-09-09', ids.slice(0, 3));
  delete day.schemaVersion;
  delete day.participantOrder;
  const repository = new InMemoryMealRepository();
  await repository.create(day);
  const service = createMealService({ repository, snapshots: { findByDateAndVersion: async () => null } });
  await assert.rejects(service.getDay(day.date), /snapshot.*missing/i);
});

test('calendar uses verified frozen historical amount and reports missing snapshots', async () => {
  const source = createDefaultMealDay('2026-09-09', ids.slice(0, 3));
  delete source.schemaVersion;
  delete source.participantOrder;
  source.meals.morning.gaurav = 'taking';
  const snapshot = buildLegacyMealSnapshot(source);
  const repository = { findInDateRange: async () => [source] };
  const snapshots = { findByDateAndVersion: async () => snapshot };
  const students = { listEligibleOn: async () => [] };
  const month = await createMonthMealService({ repository, snapshots, students }).getMonth('2026-09');
  assert.equal(month.days[8].dailyCostSummary.members.gaurav.morningAmountPaise, 5000);
  assert.equal(month.days[9].counts.morningNotSet, 0);
  snapshots.findByDateAndVersion = async () => null;
  await assert.rejects(createMonthMealService({ repository, snapshots, students }).getMonth('2026-09'), /snapshot.*missing/i);
});
