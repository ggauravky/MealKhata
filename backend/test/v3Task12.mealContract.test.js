import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeMealDay } from '../src/meals/meal.serializer.js';
import { createDashboardService } from '../src/dashboard/dashboard.service.js';
import { serializeDashboardSummary } from '../src/dashboard/dashboard.serializer.js';

test('meal day exposes the server plate limit for its dynamic participant count', () => {
  const participants = ['gaurav', 'nikhil', 'devansh', 'student_fourth'];
  const day = serializeMealDay(null, '2026-11-04', { participants });
  assert.deepEqual(Object.keys(day.meals.morning), participants);
  assert.equal(day.maxPhysicalPlates, 4);
});

test('dashboard meal cards receive authoritative shared costs without adding later students to a saved day', async () => {
  const fourth = 'student_0123456789abcdef0123456789abcdef';
  const later = 'student_11111111111111111111111111111111';
  const savedDay = {
    date: '2026-11-04', saved: true, calculationVersion: 'v3', participantOrder: ['gaurav', fourth],
    meals: { morning: { gaurav: 'taking', [fourth]: 'taking' }, night: { gaurav: 'skip', [fourth]: 'skip' } },
    allocations: { morning: { mode: 'custom', plates: [{ shares: { gaurav: 3, [fourth]: 3 } }] }, night: null },
  };
  const service = createDashboardService({
    mealService: { getDay: async () => savedDay },
    reportService: { getMonthlyReport: async () => ({ toDate: { members: {}, room: {} }, projection: { members: {}, room: {} } }) },
    paymentSummaryService: { getSummary: async () => ({ members: {}, room: {} }) },
    settlementService: { getSettlementStatus: async () => ({ state: 'not_ready', blockers: [] }) },
    reminderSettingsService: { getSettings: async () => ({ reminders: {} }) },
    students: { listCurrent: async () => [
      { studentId: 'gaurav', displayName: 'Gaurav' },
      { studentId: fourth, displayName: 'Fourth Student' },
      { studentId: later, displayName: 'Later Student' },
    ] },
    now: () => new Date('2026-11-04T05:00:00Z'),
  });
  const dashboard = await service.getDashboardSummary({ auth: { role: 'admin' } });
  assert.equal(dashboard.meals.allocations.morning.cost.members[fourth].amountPaise, 2500);
  assert.equal(dashboard.meals.allocations.morning.cost.totalCostPaise, 5000);
  assert.deepEqual(dashboard.meals.participantOrder, ['gaurav', fourth]);
  assert.equal(dashboard.householdToday.members.some((row) => row.memberId === later), false);
  const response = serializeDashboardSummary(dashboard);
  assert.equal(response.meals.allocations.morning.cost.members[fourth].amountPaise, 2500);
  assert.equal(response.meals.pricing.morning.effectivePricePaise, 5000);
  assert.deepEqual(response.meals.participantOrder, ['gaurav', fourth]);
});

test('dashboard does not append current but date-ineligible students to an unsaved day', async () => {
  const unsavedDay = serializeMealDay(null, '2026-11-04', { participants: ['gaurav'] });
  const service = createDashboardService({
    mealService: { getDay: async () => unsavedDay },
    reportService: { getMonthlyReport: async () => ({ toDate: { members: {}, room: {} }, projection: { members: {}, room: {} } }) },
    paymentSummaryService: { getSummary: async () => ({ members: {}, room: {} }) },
    settlementService: { getSettlementStatus: async () => ({ state: 'not_ready', blockers: [] }) },
    reminderSettingsService: { getSettings: async () => ({ reminders: {} }) },
    students: { listCurrent: async () => [
      { studentId: 'gaurav', displayName: 'Gaurav' },
      { studentId: 'nikhil', displayName: 'Nikhil' },
    ] },
    now: () => new Date('2026-11-04T05:00:00Z'),
  });
  const dashboard = await service.getDashboardSummary({ auth: { role: 'admin' } });
  assert.deepEqual(dashboard.meals.participantOrder, ['gaurav']);
  assert.deepEqual(dashboard.householdToday.members.map((row) => row.memberId), ['gaurav']);
});
