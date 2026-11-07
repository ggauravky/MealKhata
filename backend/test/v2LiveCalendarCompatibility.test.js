import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createDefaultMealDay } from '../src/meals/meal.defaults.js';

const savedV2Day = createDefaultMealDay('2026-11-01', ['gaurav', 'nikhil', 'devansh']);
delete savedV2Day.schemaVersion;
delete savedV2Day.participantOrder;
savedV2Day.meals.morning.gaurav = 'taking';

const missingSnapshots = { findByDateAndVersion: async () => null };
const students = { listEligibleOn: async () => ['gaurav', 'nikhil', 'devansh'].map((studentId) => ({ studentId })) };

test('v2 calendar reads saved meal days without requiring v3 migration snapshots', async () => {
  const service = createMonthMealService({
    repository: { findInDateRange: async () => [savedV2Day] },
    snapshots: missingSnapshots,
    students,
    runtimeProfile: 'v2',
  });
  const month = await service.getMonth('2026-11');
  const first = month.days[0];
  assert.equal(first.saved, true);
  assert.equal(first.counts.morningTaking, 1);
  assert.equal(first.dailyCostSummary.members.gaurav.morningAmountPaise, 5000);
});

test('v2 daily meal reads saved meal days without requiring v3 migration snapshots', async () => {
  const service = createMealService({
    repository: { findByDate: async () => savedV2Day },
    snapshots: missingSnapshots,
    students,
    runtimeProfile: 'v2',
  });
  const day = await service.getDay('2026-11-01');
  assert.equal(day.saved, true);
  assert.equal(day.meals.morning.gaurav, 'taking');
  assert.equal(day.dailyCostSummary.members.gaurav.morningAmountPaise, 5000);
});
