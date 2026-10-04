import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { DEFAULT_MEAL_STATUS, MEAL_STATUSES, WRITABLE_MEAL_STATUSES } from '../src/meals/meal.constants.js';
import { createDefaultMealDay } from '../src/meals/meal.defaults.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createPaymentSummaryService } from '../src/payments/paymentSummary.service.js';
import { createReminderDispatchService } from '../src/push/reminderDispatch.service.js';
import { createReportService } from '../src/reports/report.service.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { InMemoryMonthlyRateRepository } from './helpers/inMemoryMonthlyRateRepository.js';
import { InMemoryPaymentRepository } from './helpers/inMemoryPaymentRepository.js';

describe('Critical Data Semantics Fix & Invariants', () => {
  let mealRepo;
  let rateRepo;
  let paymentRepo;
  let mealService;
  let monthMealService;
  let rateService;
  let reportService;
  let paymentSummaryService;

  const TEST_NOW = new Date('2026-10-05T06:00:00.000Z'); // 11:30 AM IST Oct 5 2026
  const TIMEZONE = 'Asia/Kolkata';

  beforeEach(() => {
    mealRepo = new InMemoryMealRepository();
    rateRepo = new InMemoryMonthlyRateRepository();
    paymentRepo = new InMemoryPaymentRepository();

    mealService = createMealService({ repository: mealRepo, timezone: TIMEZONE });
    monthMealService = createMonthMealService({ repository: mealRepo, timezone: TIMEZONE });
    rateService = createMonthlyRateService({ repository: rateRepo, now: () => TEST_NOW });
    reportService = createReportService({
      meals: monthMealService,
      rates: rateService,
      now: () => TEST_NOW,
      timezone: TIMEZONE,
    });
    paymentSummaryService = createPaymentSummaryService({
      reports: reportService,
      repository: paymentRepo,
    });
  });

  test('Constants: DEFAULT_MEAL_STATUS is not_set and WRITABLE_MEAL_STATUSES only allows taking/skip', () => {
    assert.equal(DEFAULT_MEAL_STATUS, 'not_set');
    assert.deepEqual(MEAL_STATUSES, ['not_set', 'taking', 'skip']);
    assert.deepEqual(WRITABLE_MEAL_STATUSES, ['taking', 'skip']);
    assert.ok(!WRITABLE_MEAL_STATUSES.includes('not_set'), 'not_set must not be directly writable via standard status mutation');
  });

  test('createDefaultMealDay produces not_set for all 6 member slots', () => {
    const day = createDefaultMealDay('2026-10-25');
    assert.equal(day.date, '2026-10-25');
    for (const mealType of ['morning', 'night']) {
      for (const id of MEMBER_IDS) {
        assert.equal(day.meals[mealType][id], 'not_set');
      }
    }
  });

  test('Requirement 79 & 82: Unsaved date serializes with saved=false, 0 taking, 0 plates, and ₹0 member costs', async () => {
    const month = await monthMealService.getMonth('2026-10');
    const day = month.days.find((d) => d.date === '2026-10-20');
    assert.equal(day.saved, false);
    assert.equal(day.counts.morningTaking, 0);
    assert.equal(day.counts.nightTaking, 0);
    assert.equal(day.counts.morningNotSet, 3);
    assert.equal(day.counts.nightNotSet, 3);
    assert.equal(day.counts.morningPhysicalPlates, 0);
    assert.equal(day.counts.nightPhysicalPlates, 0);
    assert.equal(day.counts.totalPhysicalPlates, 0);
    assert.equal(day.hasMealActivity, false);
    assert.equal(day.hasCustomAllocation, false);

    // Verify member costs in allocations are ₹0
    for (const id of MEMBER_IDS) {
      assert.equal(day.allocations.morning.cost.members[id].amountPaise, 0);
      assert.equal(day.allocations.night.cost.members[id].amountPaise, 0);
    }
  });

  test('Requirement 87: First Taking mutation creates new day with only that member taking, other 5 not_set', async () => {
    const result = await mealService.changeStatus({
      date: '2026-10-25',
      mealType: 'morning',
      memberId: 'gaurav',
      status: 'taking',
      actorRole: 'member',
      actorMemberId: 'gaurav',
    });

    assert.equal(result.changed, true);
    assert.equal(result.data.saved, true);
    assert.equal(result.data.meals.morning.gaurav, 'taking');
    assert.equal(result.data.meals.morning.nikhil, 'not_set');
    assert.equal(result.data.meals.morning.devansh, 'not_set');
    assert.equal(result.data.meals.night.gaurav, 'not_set');
    assert.equal(result.data.meals.night.nikhil, 'not_set');
    assert.equal(result.data.meals.night.devansh, 'not_set');

    // Plate counts: 1 morning physical plate, 0 night, 1 total
    assert.equal(result.data.plateCounts.morning, 1);
    assert.equal(result.data.plateCounts.night, 0);
    assert.equal(result.data.plateCounts.total, 1);

    // Costs: Gaurav = ₹50, Nikhil = ₹0, Devansh = ₹0
    assert.equal(result.data.allocations.morning.cost.members.gaurav.amountPaise, 5000);
    assert.equal(result.data.allocations.morning.cost.members.nikhil.amountPaise, 0);
    assert.equal(result.data.allocations.morning.cost.members.devansh.amountPaise, 0);
  });

  test('Requirement 88: First Skip mutation creates day with only that member skip, other 5 not_set, 0 plates', async () => {
    const result = await mealService.changeStatus({
      date: '2026-10-25',
      mealType: 'night',
      memberId: 'nikhil',
      status: 'skip',
      actorRole: 'member',
      actorMemberId: 'nikhil',
    });

    assert.equal(result.changed, true);
    assert.equal(result.data.meals.night.nikhil, 'skip');
    assert.equal(result.data.meals.night.gaurav, 'not_set');
    assert.equal(result.data.meals.night.devansh, 'not_set');
    assert.equal(result.data.plateCounts.night, 0);
    assert.equal(result.data.plateCounts.total, 0);
  });

  test('Requirement 80, 130: 30-day untouched month (September 2026) reports exactly 0 meals and ₹0 bill', async () => {
    const report = await reportService.getMonthlyReport('2026-09');
    assert.equal(report.periodType, 'past');
    assert.equal(report.recordedDayCount, 0);
    assert.equal(report.hasRecordedMeals, false);
    assert.equal(report.hasFinancialActivity, false);

    for (const id of MEMBER_IDS) {
      assert.equal(report.toDate.members[id].morningCount, 0);
      assert.equal(report.toDate.members[id].nightCount, 0);
      assert.equal(report.toDate.members[id].totalMeals, 0);
      assert.equal(report.toDate.members[id].amountPaise, 0);
    }

    assert.equal(report.toDate.room.totalMeals, 0);
    assert.equal(report.toDate.room.totalPhysicalPlates, 0);
    assert.equal(report.toDate.room.amountPaise, 0);
  });

  test('Requirement 131: 31-day untouched month (August 2026) reports exactly 0 meals and ₹0 bill', async () => {
    const report = await reportService.getMonthlyReport('2026-08');
    assert.equal(report.toDate.room.totalMeals, 0);
    assert.equal(report.toDate.room.totalPhysicalPlates, 0);
    assert.equal(report.toDate.room.amountPaise, 0);
  });

  test('Requirement 132: Untouched February reports exactly 0 meals and ₹0 bill', async () => {
    const report = await reportService.getMonthlyReport('2026-02');
    assert.equal(report.toDate.room.totalMeals, 0);
    assert.equal(report.toDate.room.totalPhysicalPlates, 0);
    assert.equal(report.toDate.room.amountPaise, 0);
  });

  test('Requirement 133: Partial month counts only explicitly entered meals', async () => {
    // Oct 1: Gaurav morning taking (5000 paise)
    await mealRepo.create({
      date: '2026-10-01',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'not_set', devansh: 'not_set' },
        night: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
      },
      changes: [],
    });

    // Oct 3: Nikhil night taking (7000 paise)
    await mealRepo.create({
      date: '2026-10-03',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
        night: { gaurav: 'not_set', nikhil: 'taking', devansh: 'not_set' },
      },
      changes: [],
    });

    const report = await reportService.getMonthlyReport('2026-10');
    assert.equal(report.recordedDayCount, 2);
    assert.equal(report.hasRecordedMeals, true);

    // Gaurav: 1 morning = 5000 paise
    assert.equal(report.toDate.members.gaurav.morningCount, 1);
    assert.equal(report.toDate.members.gaurav.nightCount, 0);
    assert.equal(report.toDate.members.gaurav.amountPaise, 5000);

    // Nikhil: 1 night = 7000 paise
    assert.equal(report.toDate.members.nikhil.morningCount, 0);
    assert.equal(report.toDate.members.nikhil.nightCount, 1);
    assert.equal(report.toDate.members.nikhil.amountPaise, 7000);

    // Devansh: 0
    assert.equal(report.toDate.members.devansh.amountPaise, 0);

    // Room total: 12000 paise (₹120)
    assert.equal(report.toDate.room.amountPaise, 12000);
    assert.equal(report.toDate.room.totalPhysicalPlates, 2);
  });

  test('Requirement 81: Payment summary on untouched September 2026 returns ₹0 bill and no_due status', async () => {
    const summary = await paymentSummaryService.getSummary('2026-09');
    assert.equal(summary.room.billAmountPaise, 0);
    assert.equal(summary.room.paidAmountPaise, 0);
    assert.equal(summary.room.remainingAmountPaise, 0);
    assert.equal(summary.room.status, 'no_due');

    for (const id of MEMBER_IDS) {
      assert.equal(summary.members[id].billAmountPaise, 0);
      assert.equal(summary.members[id].paidAmountPaise, 0);
      assert.equal(summary.members[id].remainingAmountPaise, 0);
      assert.equal(summary.members[id].status, 'no_due');
    }
  });

  test('Requirement 72, 73: not_set does NOT trigger push reminders; only explicit taking does', async () => {
    const sentNotifications = [];
    const mockWebPush = {
      async sendNotification(sub, payload) {
        sentNotifications.push({ sub, payload });
      },
    };
    const mockSubscriptions = {
      async findActiveByMemberId(memberId) {
        return [{ subscriptionId: `sub-${memberId}`, memberId, endpoint: `https://push.example.com/${memberId}` }];
      },
      async recordSuccess() {},
      async recordFailure() {},
    };
    const mockDeliveries = {
      async claimDispatch() { return true; },
      async markSent() {},
      async markFailed() {},
    };
    const mockSettingsService = {
      async getSettings() {
        return {
          reminders: {
            morning: { enabled: true, time: '08:00' },
            night: { enabled: true, time: '20:00' },
          },
        };
      },
    };

    const dispatchService = createReminderDispatchService({
      settingsService: mockSettingsService,
      meals: mealService,
      subscriptions: mockSubscriptions,
      deliveries: mockDeliveries,
      push: mockWebPush,
      timezone: TIMEZONE,
    });

    // Case 1: Untouched day (all not_set)
    const resultUntouched = await dispatchService.dispatchReminders({
      now: new Date('2026-10-25T02:30:00.000Z'), // 08:00 AM IST
      forceMealType: 'morning',
    });
    assert.equal(resultUntouched.sentCount, 0, 'No reminders should be sent when all members are not_set');
    assert.equal(sentNotifications.length, 0);

    // Case 2: Explicit Taking for Gaurav only
    await mealRepo.create({
      date: '2026-10-25',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'not_set', devansh: 'skip' },
        night: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
      },
      changes: [],
    });

    const resultExplicit = await dispatchService.dispatchReminders({
      now: new Date('2026-10-25T02:30:00.000Z'),
      forceMealType: 'morning',
    });
    assert.equal(resultExplicit.sentCount, 1, 'Only Gaurav (taking) should receive a reminder');
    assert.equal(sentNotifications.length, 1);
    assert.equal(sentNotifications[0].sub.memberId, 'gaurav');
  });

  test('Requirement 84, 85, 86, 135, 136: Exact member costs for full plate, half plate, and 3-way split', async () => {
    // Shared morning plate: 1 plate split half-half by Gaurav and Nikhil (3 units each)
    // Shared night plate: 1 plate split 3 ways equally by all 3 (2 units each)
    await mealRepo.create({
      date: '2026-10-04',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'taking', devansh: 'skip' },
        night: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
      },
      allocations: {
        morning: {
          mode: 'custom',
          plates: [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }],
        },
        night: {
          mode: 'custom',
          plates: [{ shares: { gaurav: 2, nikhil: 2, devansh: 2 } }],
        },
      },
      changes: [],
    });

    const day = await mealService.getDay('2026-10-04');
    assert.equal(day.saved, true);

    // Morning: 1 physical plate split two ways = ₹25.00 each
    const morningCost = day.allocations.morning.cost.members;
    assert.equal(morningCost.gaurav.amountPaise, 2500);
    assert.equal(morningCost.nikhil.amountPaise, 2500);
    assert.equal(morningCost.devansh.amountPaise, 0);

    // Night: 1 physical plate (₹70.00 = 7000 paise) split 3 ways:
    // 7000 / 3 = 2333 with remainder 1 allocated deterministically
    const nightCost = day.allocations.night.cost.members;
    const sumNightPaise = nightCost.gaurav.amountPaise + nightCost.nikhil.amountPaise + nightCost.devansh.amountPaise;
    assert.equal(sumNightPaise, 7000, 'Sum of member costs must strictly equal 7000 paise');
    assert.equal(nightCost.nikhil.amountPaise, 2334);
    assert.equal(nightCost.gaurav.amountPaise, 2333);
    assert.equal(nightCost.devansh.amountPaise, 2333);
  });
});
