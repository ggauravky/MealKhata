import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { createDashboardService } from '../src/dashboard/dashboard.service.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createPaymentSummaryService } from '../src/payments/paymentSummary.service.js';
import { createReportService } from '../src/reports/report.service.js';
import { createDashboardRouter } from '../src/routes/dashboard.routes.js';
import { createReminderSettingsService } from '../src/settings/reminderSettings.service.js';
import { createSettlementService } from '../src/settlement/settlement.service.js';
import { getIndiaGreeting, getLogicalHourInTimeZone } from '../src/utils/date.js';
import { getPreviousLogicalMonth } from '../src/utils/month.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { InMemoryMonthlyRateRepository } from './helpers/inMemoryMonthlyRateRepository.js';
import { InMemoryMonthlySettlementRepository } from './helpers/inMemoryMonthlySettlementRepository.js';
import { InMemoryPaymentRepository } from './helpers/inMemoryPaymentRepository.js';
import { InMemoryReminderSettingsRepository } from './helpers/inMemoryReminderSettingsRepository.js';

const ORIGIN = 'http://localhost:5173';
// Fixed India time: 2026-10-01 10:00:00 AM IST (UTC: 2026-10-01T04:30:00.000Z)
const TEST_NOW = new Date('2026-10-01T04:30:00.000Z');

const mealRepo = new InMemoryMealRepository();
const rateRepo = new InMemoryMonthlyRateRepository();
const paymentRepo = new InMemoryPaymentRepository();
const reminderSettingsRepo = new InMemoryReminderSettingsRepository();
const settlementRepo = new InMemoryMonthlySettlementRepository();

const mealService = createMealService({ repository: mealRepo, timezone: 'Asia/Kolkata' });
const monthMeals = createMonthMealService({ repository: mealRepo, timezone: 'Asia/Kolkata' });
const rateService = createMonthlyRateService({ repository: rateRepo, now: () => TEST_NOW });
const reportService = createReportService({ meals: monthMeals, rates: rateService, now: () => TEST_NOW });
const paymentSummaryService = createPaymentSummaryService({
  reports: reportService,
  repository: paymentRepo,
});
const reminderSettingsService = createReminderSettingsService({ repository: reminderSettingsRepo });
const settlementService = createSettlementService({
  reports: reportService,
  summaries: paymentSummaryService,
  repository: settlementRepo,
  now: () => TEST_NOW,
});

const dashboardService = createDashboardService({
  mealService,
  reportService,
  paymentSummaryService,
  settlementService,
  reminderSettingsService,
  pushConfigured: true,
  now: () => TEST_NOW,
  timezone: 'Asia/Kolkata',
});

const dashboardRouter = createDashboardRouter({ service: dashboardService });
const testApp = createApp({ dashboard: dashboardRouter });

async function cookieFor(role, memberId = null) {
  const token = await createSessionToken(role, { memberId });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

beforeEach(() => {
  mealRepo.reset();
  rateRepo.reset();
  paymentRepo.reset();
  reminderSettingsRepo.reset();
  settlementRepo.reset();
});

describe('Phase 11: Utilities & Rollover', () => {
  test('getPreviousLogicalMonth correctly rolls over months and years', () => {
    assert.equal(getPreviousLogicalMonth('2026-10'), '2026-09');
    assert.equal(getPreviousLogicalMonth('2026-02'), '2026-01');
    assert.equal(getPreviousLogicalMonth('2027-01'), '2026-12');
    assert.equal(getPreviousLogicalMonth('2026-01'), '2025-12');
    assert.throws(() => getPreviousLogicalMonth('invalid'), TypeError);
  });

  test('getIndiaGreeting and getLogicalHourInTimeZone use Asia/Kolkata', () => {
    // 02:30 UTC = 08:00 IST -> Morning
    const morning = new Date('2026-10-01T02:30:00.000Z');
    assert.equal(getLogicalHourInTimeZone(morning, 'Asia/Kolkata'), 8);
    assert.equal(getIndiaGreeting(morning, 'Asia/Kolkata'), 'Good morning');

    // 08:30 UTC = 14:00 IST -> Afternoon
    const afternoon = new Date('2026-10-01T08:30:00.000Z');
    assert.equal(getLogicalHourInTimeZone(afternoon, 'Asia/Kolkata'), 14);
    assert.equal(getIndiaGreeting(afternoon, 'Asia/Kolkata'), 'Good afternoon');

    // 14:30 UTC = 20:00 IST -> Evening
    const evening = new Date('2026-10-01T14:30:00.000Z');
    assert.equal(getLogicalHourInTimeZone(evening, 'Asia/Kolkata'), 20);
    assert.equal(getIndiaGreeting(evening, 'Asia/Kolkata'), 'Good evening');
  });
});

describe('Phase 11: Dashboard API - Viewer Experience', () => {
  test('GET /api/dashboard returns safe public overview without session', async () => {
    const res = await request(testApp)
      .get('/api/dashboard')
      .set('Origin', ORIGIN)
      .expect(200);

    assert.equal(res.body.success, true);
    const data = res.body.data;
    assert.equal(data.today, '2026-10-01');
    assert.equal(data.identity.role, 'viewer');
    assert.equal(data.identity.memberId, null);
    assert.equal(data.personalHero, null);
    assert.equal(data.currentMonth.personal, null);

    // Household today plate counts
    assert.equal(data.householdToday.morningPlates, 3);
    assert.equal(data.householdToday.nightPlates, 3);
    assert.equal(data.householdToday.totalPlates, 6);
    assert.equal(data.householdToday.members.length, 3);

    // Quick actions for viewer
    assert.ok(data.quickActions.some((a) => a.id === 'calendar'));
    assert.ok(data.quickActions.some((a) => a.id === 'reports'));
    assert.ok(data.quickActions.some((a) => a.id === 'payments'));

    // Check no sensitive fields
    assert.equal(data._id, undefined);
    assert.equal(data.password, undefined);
    assert.equal(data.email, undefined);
  });
});

describe('Phase 11: Dashboard API - Member Personalization', () => {
  test('Member Gaurav receives personal hero, personal month, and payment status', async () => {
    const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const res = await request(testApp)
      .get('/api/dashboard')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .expect(200);

    assert.equal(res.body.success, true);
    const data = res.body.data;
    assert.equal(data.identity.role, 'member');
    assert.equal(data.identity.memberId, 'gaurav');
    assert.equal(data.identity.displayName, 'Gaurav');
    assert.match(data.greeting, /Gaurav/);

    // Personal hero meals
    assert.ok(data.personalHero);
    assert.equal(data.personalHero.memberId, 'gaurav');
    assert.equal(data.personalHero.morning, 'taking');
    assert.equal(data.personalHero.night, 'taking');
    assert.equal(data.personalHero.canEdit, true);

    // Personal monthly financial stats
    assert.ok(data.currentMonth.personal);
    assert.equal(data.currentMonth.personal.memberId, 'gaurav');
    // On Oct 1st, 1 morning (50) + 1 night (70) = 12000 paise (Rs 120)
    assert.equal(data.currentMonth.personal.morningCount, 1);
    assert.equal(data.currentMonth.personal.nightCount, 1);
    assert.equal(data.currentMonth.personal.totalPlates, 2);
    assert.equal(data.currentMonth.personal.billAmountPaise, 12000);
    assert.equal(data.currentMonth.personal.paidAmountPaise, 0);
    assert.equal(data.currentMonth.personal.remainingAmountPaise, 12000);

    // Attention item for outstanding balance
    assert.ok(data.attention.some((att) => att.id === 'payment_due'));
    const dueAtt = data.attention.find((att) => att.id === 'payment_due');
    assert.match(dueAtt.message, /120/);
    assert.equal(dueAtt.link, '/payments?month=2026-10');
  });

  test('Member Nikhil receives Nikhil personalization independently', async () => {
    const cookie = await cookieFor(ROLES.MEMBER, 'nikhil');
    const res = await request(testApp)
      .get('/api/dashboard')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .expect(200);

    assert.equal(res.body.data.identity.memberId, 'nikhil');
    assert.equal(res.body.data.personalHero.memberId, 'nikhil');
  });

  test('Member cannot spoof identity via query param', async () => {
    const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const res = await request(testApp)
      .get('/api/dashboard?memberId=nikhil')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .expect(200);

    // Must remain Gaurav, query param strictly ignored
    assert.equal(res.body.data.identity.memberId, 'gaurav');
  });

  test('Fixed rates mean dashboard always has accurate pricing and never reports rates_missing', async () => {
    const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const res = await request(testApp)
      .get('/api/dashboard')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .expect(200);

    const personal = res.body.data.currentMonth.personal;
    assert.equal(personal.billAmountPaise, 12000);
    assert.notEqual(personal.status, 'rates_missing');
    assert.ok(!res.body.data.attention.some((att) => att.id === 'rates_missing'));
  });
});

describe('Phase 11: Dashboard API - Admin & Super Admin Experience', () => {
  test('Admin receives household management summary and manage-today quick action', async () => {
    const cookie = await cookieFor(ROLES.ADMIN);
    const res = await request(testApp)
      .get('/api/dashboard')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .expect(200);

    const data = res.body.data;
    assert.equal(data.identity.role, 'admin');
    assert.equal(data.personalHero, null);
    assert.equal(data.currentMonth.personal, null);
    assert.ok(data.currentMonth.household);

    // Quick action includes manage-today
    assert.ok(data.quickActions.some((a) => a.id === 'manage-today' && a.to.includes('2026-10-01')));
  });

  test('Super Admin receives operational quick actions and settlement reminders', async () => {
    const cookie = await cookieFor(ROLES.SUPERADMIN);
    const res = await request(testApp)
      .get('/api/dashboard')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .expect(200);

    const data = res.body.data;
    assert.equal(data.identity.role, 'superadmin');
    assert.match(data.greeting, /Super Admin/);

    // Quick actions include settlement and reminders
    assert.ok(data.quickActions.some((a) => a.id === 'settlement'));
    assert.ok(data.quickActions.some((a) => a.id === 'reminders'));
  });

  test('Super Admin sees settlement ready attention when previous month is fully settled', async () => {
    // Mark previous month 2026-09 ready to close by mocking settlement status
    const customSettlementService = {
      async getSettlementStatus() {
        return {
          month: '2026-09',
          state: 'ready_to_close',
          canClose: true,
          blockers: [],
        };
      },
    };

    const customDashboardService = createDashboardService({
      mealService,
      reportService,
      paymentSummaryService,
      settlementService: customSettlementService,
      reminderSettingsService,
      now: () => TEST_NOW,
    });

    const customApp = createApp({
      dashboard: createDashboardRouter({ service: customDashboardService }),
    });

    const cookie = await cookieFor(ROLES.SUPERADMIN);
    const res = await request(customApp)
      .get('/api/dashboard')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .expect(200);

    const settlementAtt = res.body.data.attention.find((att) => att.id === 'settlement_ready');
    assert.ok(settlementAtt);
    assert.equal(settlementAtt.actionLabel, 'Close Month');
    assert.equal(settlementAtt.link, '/reports?month=2026-09');
  });
});

describe('Phase 11: Dashboard API - Error Resilience', () => {
  test('Dashboard remains functional even if paymentSummaryService rejects', async () => {
    const failingPaymentSummary = {
      async getSummary() {
        throw new Error('Database temporarily unavailable');
      },
    };

    const resilientDashboardService = createDashboardService({
      mealService,
      reportService,
      paymentSummaryService: failingPaymentSummary,
      settlementService,
      reminderSettingsService,
      now: () => TEST_NOW,
    });

    const customApp = createApp({
      dashboard: createDashboardRouter({ service: resilientDashboardService }),
    });

    const res = await request(customApp)
      .get('/api/dashboard')
      .set('Origin', ORIGIN)
      .expect(200);

    // Core today meals and household data still present
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.today, '2026-10-01');
    assert.equal(res.body.data.householdToday.totalPlates, 6);
    // Error recorded safely
    assert.ok(res.body.data.errors?.paymentSummary);
  });
});
