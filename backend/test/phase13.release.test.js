import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/auth/auth.service.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { APP_VERSION } from '../src/config/version.js';
import { createDashboardService } from '../src/dashboard/dashboard.service.js';
import { createMealService } from '../src/meals/meal.service.js';
import { isValidPaymentAmount } from '../src/payments/payment.constants.js';
import { createPaymentService } from '../src/payments/payment.service.js';
import { createPaymentSettingsService } from '../src/payments/paymentSettings.service.js';
import { createPaymentSummaryService } from '../src/payments/paymentSummary.service.js';
import { createReportService } from '../src/reports/report.service.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { createBillingRouter } from '../src/routes/billing.routes.js';
import { createCalendarRouter } from '../src/routes/calendar.routes.js';
import { createDashboardRouter } from '../src/routes/dashboard.routes.js';
import { createHealthRouter } from '../src/routes/health.routes.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { createPaymentRouter } from '../src/routes/payment.routes.js';
import { createPaymentSettingsRouter } from '../src/routes/paymentSettings.routes.js';
import { createReminderSettingsRouter } from '../src/routes/reminderSettings.routes.js';
import { createReportRouter } from '../src/routes/report.routes.js';
import { createSettlementRouter } from '../src/routes/settlement.routes.js';
import { createReminderSettingsService } from '../src/settings/reminderSettings.service.js';
import { createSettlementService } from '../src/settlement/settlement.service.js';
import { getIndiaGreeting } from '../src/utils/date.js';
import { getNextLogicalMonth, getPreviousLogicalMonth, listDatesInMonth } from '../src/utils/month.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { InMemoryMemberAccountRepository } from './helpers/inMemoryMemberAccountRepository.js';
import { InMemoryMonthlyRateRepository } from './helpers/inMemoryMonthlyRateRepository.js';
import { InMemoryMonthlySettlementRepository } from './helpers/inMemoryMonthlySettlementRepository.js';
import { InMemoryPaymentRepository } from './helpers/inMemoryPaymentRepository.js';
import { InMemoryPaymentSettingsRepository } from './helpers/inMemoryPaymentSettingsRepository.js';
import { InMemoryReminderSettingsRepository } from './helpers/inMemoryReminderSettingsRepository.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '../..');

function buildTestFixtureApp() {
  const mealRepo = new InMemoryMealRepository();
  const memberRepo = new InMemoryMemberAccountRepository();
  const rateRepo = new InMemoryMonthlyRateRepository();
  const paymentRepo = new InMemoryPaymentRepository();
  const paymentSettingsRepo = new InMemoryPaymentSettingsRepository();
  const settlementRepo = new InMemoryMonthlySettlementRepository();
  const reminderRepo = new InMemoryReminderSettingsRepository();

  const now = () => new Date('2026-10-15T12:00:00+05:30');
  const timezone = 'Asia/Kolkata';

  const mealService = createMealService({ repository: mealRepo, timezone });
  const monthMealService = createMonthMealService({ repository: mealRepo, timezone });
  const rateService = createMonthlyRateService({ repository: rateRepo });
  const reportService = createReportService({ meals: monthMealService, rates: rateService, now, timezone });
  const paymentSummaryService = createPaymentSummaryService({ reports: reportService, repository: paymentRepo });
  const paymentSettingsService = createPaymentSettingsService({ repository: paymentSettingsRepo });
  const settlementService = createSettlementService({ reports: reportService, summaries: paymentSummaryService, repository: settlementRepo, now });
  const paymentService = createPaymentService({ repository: paymentRepo, reports: reportService, summaries: paymentSummaryService, settings: paymentSettingsService, settlements: settlementService, now });
  const reminderService = createReminderSettingsService({ repository: reminderRepo });
  const dashboardService = createDashboardService({
    mealService,
    reportService,
    paymentSummaryService,
    settlementService,
    reminderSettingsService: reminderService,
    pushConfigured: false,
    now,
    timezone,
  });
  const authService = createAuthService({ memberAccounts: memberRepo });

  const app = createApp({
    auth: createAuthRouter({ service: authService }),
    meals: createMealRouter({ service: mealService }),
    billing: createBillingRouter({ service: rateService }),
    calendar: createCalendarRouter({ service: monthMealService }),
    reports: createReportRouter({ service: reportService }),
    payments: createPaymentRouter({ service: paymentService, summaries: paymentSummaryService }),
    paymentSettings: createPaymentSettingsRouter({ service: paymentSettingsService }),
    reminderSettings: createReminderSettingsRouter({ service: reminderService }),
    settlements: createSettlementRouter({ service: settlementService }),
    dashboard: createDashboardRouter({ service: dashboardService }),
    health: createHealthRouter({ readiness: async () => true, drainingCheck: () => false }),
  });

  return { app, mealRepo, rateRepo, paymentRepo, settlementRepo };
}

describe('Phase 13: Final QA, Versioning & Release Contracts', () => {
  test('APP_VERSION is a valid semantic version string', () => {
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  });

  test('GET /api/health exposes semantic version and safe operational metadata without secrets', async () => {
    const { app } = buildTestFixtureApp();
    const res = await request(app).get('/api/health').expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.service, 'MealKhata');
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.version, APP_VERSION);
    assert.ok(typeof res.body.uptimeSeconds === 'number');

    const json = JSON.stringify(res.body);
    assert.ok(!json.includes('mongodb'));
    assert.ok(!json.includes('secret'));
    assert.ok(!json.includes('password'));
  });

  test('API Contract: GET /api/auth/session returns expected schema for unauthenticated viewer', async () => {
    const { app } = buildTestFixtureApp();
    const res = await request(app).get('/api/auth/session').expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.session.role, 'viewer');
    assert.equal(res.body.session.authenticated, false);
  });

  test('API Contract: GET /api/dashboard returns expected top-level sections', async () => {
    const { app } = buildTestFixtureApp();
    const res = await request(app).get('/api/dashboard').expect(200);

    assert.equal(res.body.success, true);
    const d = res.body.data;
    assert.ok(d.identity);
    assert.equal(d.identity.role, 'viewer');
    assert.ok(d.greeting);
    assert.ok(d.householdToday);
    assert.ok(typeof d.householdToday.morningPlates === 'number');
    assert.ok(typeof d.householdToday.nightPlates === 'number');
    assert.ok(Array.isArray(d.householdToday.members));
    assert.equal(d.householdToday.members.length, 3);
    assert.ok(d.currentMonth);
    assert.ok(Array.isArray(d.quickActions));
  });

  test('API Contract: GET /api/meals/today returns taking defaults for untouched date', async () => {
    const { app } = buildTestFixtureApp();
    const res = await request(app).get('/api/meals/today').expect(200);

    assert.equal(res.body.success, true);
    assert.ok(res.body.data.date);
    assert.equal(res.body.data.saved, false);
    assert.equal(res.body.data.meals.morning.gaurav, 'taking');
    assert.equal(res.body.data.meals.night.gaurav, 'taking');
  });

  test('API Contract: GET /api/reports/monthly/:month returns structured report model', async () => {
    const { app } = buildTestFixtureApp();
    const res = await request(app).get('/api/reports/monthly/2026-10').expect(200);

    assert.equal(res.body.success, true);
    const report = res.body.data;
    assert.equal(report.month, '2026-10');
    assert.ok(report.rates);
    assert.equal(report.rates.configured, true);
    assert.equal(report.rates.morningPricePaise, 5000);
    assert.equal(report.rates.nightPricePaise, 7000);
    assert.ok(report.projection);
    assert.ok(typeof report.projection.room.totalMeals === 'number');
  });

  test('API Contract: GET /api/payments/summary/:month returns member payment records with integer paise', async () => {
    const { app } = buildTestFixtureApp();
    const res = await request(app).get('/api/payments/summary/2026-10').expect(200);

    assert.equal(res.body.success, true);
    const summary = res.body.data;
    assert.equal(summary.month, '2026-10');
    assert.ok(summary.members.gaurav);
    assert.ok(summary.members.nikhil);
    assert.ok(summary.members.devansh);
    for (const memberId of ['gaurav', 'nikhil', 'devansh']) {
      assert.ok(Number.isSafeInteger(summary.members[memberId].paidAmountPaise));
      assert.ok(Number.isSafeInteger(summary.members[memberId].remainingAmountPaise));
    }
  });

  test('API Contract: GET /api/settlements/:month returns settlement status schema', async () => {
    const { app } = buildTestFixtureApp();
    const res = await request(app).get('/api/settlements/2026-09').expect(200);

    assert.equal(res.body.success, true);
    const settlement = res.body.data;
    assert.equal(settlement.month, '2026-09');
    assert.equal(settlement.state, 'not_ready');
    assert.ok(typeof settlement.canClose === 'boolean');
  });

  test('Timezone logic: getIndiaGreeting provides correct greeting across 24h cycle', () => {
    assert.equal(getIndiaGreeting(new Date('2026-10-01T08:00:00+05:30'), 'Asia/Kolkata'), 'Good morning');
    assert.equal(getIndiaGreeting(new Date('2026-10-01T13:00:00+05:30'), 'Asia/Kolkata'), 'Good afternoon');
    assert.equal(getIndiaGreeting(new Date('2026-10-01T18:00:00+05:30'), 'Asia/Kolkata'), 'Good evening');
    assert.equal(getIndiaGreeting(new Date('2026-10-01T23:30:00+05:30'), 'Asia/Kolkata'), 'Good evening');
    assert.equal(getIndiaGreeting(new Date('2026-10-01T02:00:00+05:30'), 'Asia/Kolkata'), 'Good evening');
  });

  test('Date boundaries: leap year calculation correctly returns 29 days for Feb 2028', () => {
    const feb2028 = listDatesInMonth('2028-02');
    assert.equal(feb2028.length, 29);
    assert.equal(feb2028[0], '2028-02-01');
    assert.equal(feb2028[28], '2028-02-29');

    const feb2026 = listDatesInMonth('2026-02');
    assert.equal(feb2026.length, 28);
    assert.equal(feb2026[27], '2026-02-28');
  });

  test('Month boundaries: rollover December to January functions without shortcuts', () => {
    assert.equal(getNextLogicalMonth('2026-12'), '2027-01');
    assert.equal(getPreviousLogicalMonth('2027-01'), '2026-12');
  });

  test('Integer paise validation: accepts positive whole paise and rejects decimals/strings/negatives', () => {
    assert.equal(isValidPaymentAmount(1), true);
    assert.equal(isValidPaymentAmount(5000), true);
    assert.equal(isValidPaymentAmount(1000000), true);

    assert.equal(isValidPaymentAmount(0), false);
    assert.equal(isValidPaymentAmount(-500), false);
    assert.equal(isValidPaymentAmount(49.99), false);
    assert.equal(isValidPaymentAmount('5000'), false);
    assert.equal(isValidPaymentAmount(null), false);
    assert.equal(isValidPaymentAmount(undefined), false);
    assert.equal(isValidPaymentAmount(NaN), false);
  });

  test('Security Invariant: Object injection in route params/body is rejected', async () => {
    const { app } = buildTestFixtureApp();

    // Query injection on settlement
    const res = await request(app).get('/api/settlements/%7B%22%24ne%22%3Anull%7D');
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('Documentation Audit: README.md does not contain obsolete statements', () => {
    const readmeContent = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
    assert.ok(
      !readmeContent.includes('there is no push service or background delivery'),
      'README must not contain obsolete claim that there is no push service',
    );
  });
});
