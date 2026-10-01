import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { validateVapidConfiguration } from '../src/config/env.js';
import { MEMBERS, MEMBER_IDS } from '../src/config/members.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createPaymentService } from '../src/payments/payment.service.js';
import { createPaymentSettingsService } from '../src/payments/paymentSettings.service.js';
import { createPaymentSummaryService } from '../src/payments/paymentSummary.service.js';
import { createReportService } from '../src/reports/report.service.js';
import { createBillingRouter } from '../src/routes/billing.routes.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { createPaymentRouter } from '../src/routes/payment.routes.js';
import { createPushRouter } from '../src/routes/push.routes.js';
import { createSettlementRouter } from '../src/routes/settlement.routes.js';
import { createSettlementService } from '../src/settlement/settlement.service.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { InMemoryMonthlyRateRepository } from './helpers/inMemoryMonthlyRateRepository.js';
import { InMemoryMonthlySettlementRepository } from './helpers/inMemoryMonthlySettlementRepository.js';
import { InMemoryPaymentRepository } from './helpers/inMemoryPaymentRepository.js';
import { InMemoryPaymentSettingsRepository } from './helpers/inMemoryPaymentSettingsRepository.js';

const ORIGIN = 'http://localhost:5173';
const NOW = new Date('2026-10-15T12:00:00.000Z');
const CURRENT_MONTH = '2026-10';
const PAST_MONTH = '2026-09';
const FUTURE_MONTH = '2026-11';

// Repositories
const mealRepository = new InMemoryMealRepository();
const rateRepository = new InMemoryMonthlyRateRepository();
const paymentRepository = new InMemoryPaymentRepository();
const paymentSettingsRepository = new InMemoryPaymentSettingsRepository();
const settlementRepository = new InMemoryMonthlySettlementRepository();

// Services
const mealService = createMealService({ repository: mealRepository, timezone: 'Asia/Kolkata' });
const monthMealService = createMonthMealService({ repository: mealRepository, timezone: 'Asia/Kolkata' });
const rateService = createMonthlyRateService({ repository: rateRepository });
const reportService = createReportService({
  meals: monthMealService,
  rates: rateService,
  now: () => NOW,
  timezone: 'Asia/Kolkata',
});
const paymentSummaryService = createPaymentSummaryService({
  reports: reportService,
  repository: paymentRepository,
});
const paymentSettingsService = createPaymentSettingsService({
  repository: paymentSettingsRepository,
});

let settlementBroadcasts = [];
const settlementService = createSettlementService({
  reports: reportService,
  summaries: paymentSummaryService,
  repository: settlementRepository,
  now: () => NOW,
});

const paymentService = createPaymentService({
  repository: paymentRepository,
  reports: reportService,
  summaries: paymentSummaryService,
  settings: paymentSettingsService,
  settlements: settlementService,
  now: () => NOW,
});

// Routers
const billingRouter = createBillingRouter({ service: rateService, settlements: settlementService });
const mealRouter = createMealRouter({
  service: mealService,
  settlements: settlementService,
  now: () => NOW,
  timezone: 'Asia/Kolkata',
});
const paymentRouter = createPaymentRouter({
  service: paymentService,
  summaries: paymentSummaryService,
  settlements: settlementService,
  now: () => NOW,
  timezone: 'Asia/Kolkata',
});
const settlementRouter = createSettlementRouter({
  service: settlementService,
  broadcast: (payload) => settlementBroadcasts.push(payload),
});

const app = createApp({
  billing: billingRouter,
  meals: mealRouter,
  payments: paymentRouter,
  settlements: settlementRouter,
});

async function cookieFor(role, memberId = null) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, { memberId })}`;
}

beforeEach(async () => {
  mealRepository.reset();
  rateRepository.reset();
  paymentRepository.reset();
  paymentSettingsRepository.reset();
  settlementRepository.reset();
  settlementBroadcasts.length = 0;

  // Configure payment settings so payments can be prepared
  await paymentSettingsRepository.create({
    upiId: 'receiver@upi',
    payeeName: 'Hostel Mess',
    revision: 1,
    changes: [],
  });
});

describe('Phase 10: Optional Push Configuration & Hardening', () => {
  test('validates when all VAPID variables are absent and marks push disabled', () => {
    const isConfigured = validateVapidConfiguration(
      { vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '' },
      { required: false },
    );
    assert.equal(isConfigured, false);
  });

  test('throws configuration error when VAPID variables are only partially provided', () => {
    assert.throws(
      () =>
        validateVapidConfiguration(
          { vapidPublicKey: 'test-public-key', vapidPrivateKey: '', vapidSubject: '' },
          { required: false },
        ),
      /Partial VAPID configuration detected/,
    );

    assert.throws(
      () =>
        validateVapidConfiguration(
          {
            vapidPublicKey: 'test-public-key',
            vapidPrivateKey: '',
            vapidSubject: 'mailto:admin@example.com',
          },
          { required: false },
        ),
      /Partial VAPID configuration detected/,
    );
  });

  test('validates and enables push when all 3 VAPID variables are valid', () => {
    const isConfigured = validateVapidConfiguration(
      {
        vapidPublicKey: 'BKgXq1-example-key-16-bytes',
        vapidPrivateKey: 'abcdefghijklmnop',
        vapidSubject: 'mailto:admin@example.com',
      },
      { required: false },
    );
    assert.equal(isConfigured, true);
  });

  test('GET /api/push/public-key returns enabled: false when VAPID is unconfigured', async () => {
    const unconfiguredPushRouter = createPushRouter({
      isConfigured: false,
      publicKey: null,
    });
    const pushApp = createApp({ push: unconfiguredPushRouter });
    const res = await request(pushApp).get('/api/push/public-key').expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.enabled, false);
    assert.equal(res.body.publicKey, null);
    assert.equal('privateKey' in res.body, false);
  });
});

describe('Phase 10: Settlement Status & Pre-Close Validation', () => {
  test('rejects malformed month format with 400', async () => {
    const res = await request(app).get('/api/settlements/2026-9').expect(400);
    assert.equal(res.body.success, false);
  });

  test('future month returns not_ready and cannot be closed', async () => {
    const res = await request(app).get(`/api/settlements/${FUTURE_MONTH}`).expect(200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.state, 'not_ready');
    assert.equal(res.body.data.canClose, false);
    assert.ok(res.body.data.blockers.some((b) => b.type === 'future_month'));
  });

  test('current month returns not_ready and cannot be closed', async () => {
    const res = await request(app).get(`/api/settlements/${CURRENT_MONTH}`).expect(200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.state, 'not_ready');
    assert.equal(res.body.data.canClose, false);
    assert.ok(res.body.data.blockers.some((b) => b.type === 'current_month'));
  });

  test('past month rates are permanently fixed at ₹50/₹70 and never missing', async () => {
    const res = await request(app).get(`/api/settlements/${PAST_MONTH}`).expect(200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.state, 'not_ready');
    assert.equal(res.body.data.canClose, false);
    assert.ok(!res.body.data.blockers.some((b) => b.type === 'rates_missing'));
  });

  test('past month with remaining balances cannot be closed', async () => {
    const res = await request(app).get(`/api/settlements/${PAST_MONTH}`).expect(200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.state, 'not_ready');
    assert.equal(res.body.data.canClose, false);
    assert.ok(res.body.data.blockers.some((b) => b.type === 'remaining_balance'));
  });

  test('past month with overpayment cannot be closed', async () => {
    // Record an overpayment for Gaurav: 10,000,000 paise (much more than 30 days of meals)
    await paymentRepository.create({
      paymentId: 'pay-overpaid-1',
      month: PAST_MONTH,
      memberId: 'gaurav',
      amountPaise: 10_000_000,
      status: 'recorded',
      idempotencyKey: 'idem-overpay',
      recordedAt: new Date('2026-09-30T10:00:00.000Z'),
      recordedByRole: 'superadmin',
    });

    const res = await request(app).get(`/api/settlements/${PAST_MONTH}`).expect(200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.canClose, false);
    assert.ok(res.body.data.blockers.some((b) => b.type === 'overpayment'));
  });

  test('past month with exact settlement returns ready_to_close', async () => {
    // 30 days in September (2026-09-01 to 2026-09-30). Default meal day is taking both meals.
    // 30 morning * 50 = 1500; 30 night * 70 = 2100. Total per member = 3600 = 360000 paise.
    // Pay exact bill for all three members
    for (const memberId of MEMBER_IDS) {
      await paymentRepository.create({
        paymentId: `pay-settle-${memberId}`,
        month: PAST_MONTH,
        memberId,
        amountPaise: 360000,
        status: 'recorded',
        idempotencyKey: `idem-settle-${memberId}`,
        recordedAt: new Date('2026-09-30T10:00:00.000Z'),
        recordedByRole: 'superadmin',
      });
    }

    const res = await request(app).get(`/api/settlements/${PAST_MONTH}`).expect(200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.state, 'ready_to_close');
    assert.equal(res.body.data.canClose, true);
    assert.equal(res.body.data.blockers.length, 0);
  });
});

describe('Phase 10: Month Closing, Authorization & Snapshot Immutability', () => {
  beforeEach(async () => {
    // Set up exact settlement for PAST_MONTH
    await rateRepository.create({
      month: PAST_MONTH,
      morningPricePaise: 5000,
      nightPricePaise: 6000,
      revision: 1,
      changes: [],
    });

    for (const memberId of MEMBER_IDS) {
      await paymentRepository.create({
        paymentId: `pay-settle-${memberId}`,
        month: PAST_MONTH,
        memberId,
        amountPaise: 360000,
        status: 'recorded',
        idempotencyKey: `idem-settle-${memberId}`,
        recordedAt: new Date('2026-09-30T10:00:00.000Z'),
        recordedByRole: 'superadmin',
      });
    }
  });

  test('Viewer, Member, and Admin are rejected from closing a month', async () => {
    // Viewer
    await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .expect(401);

    // Member
    const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .set('Cookie', memberCookie)
      .expect(403);

    // Admin
    const adminCookie = await cookieFor(ROLES.ADMIN);
    await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie)
      .expect(403);
  });

  test('Super Admin can close an exact-settled past month, creating immutable snapshot', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const closeRes = await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ month: PAST_MONTH, forgedField: 999999 }) // forged field should be ignored
      .expect(201);

    assert.equal(closeRes.body.success, true);
    const settlement = closeRes.body.data;
    assert.equal(settlement.month, PAST_MONTH);
    assert.equal(settlement.sequence, 1);
    assert.equal(settlement.status, 'closed');
    assert.equal(settlement.snapshotVersion, 2);
    assert.equal(settlement.closedByRole, 'superadmin');
    assert.ok(settlement.settlementId);

    // Snapshot integrity
    assert.equal(settlement.snapshot.rates.morningPricePaise, 5000);
    assert.equal(settlement.snapshot.rates.nightPricePaise, 7000);

    for (const memberId of MEMBER_IDS) {
      const member = settlement.snapshot.members[memberId];
      assert.equal(member.morningCount, 30);
      assert.equal(member.nightCount, 30);
      assert.equal(member.totalPlates, 60);
      assert.equal(member.billAmountPaise, 360000);
      assert.equal(member.paidAmountPaise, 360000);
      assert.equal(member.remainingAmountPaise, 0);
    }

    assert.equal(settlement.snapshot.room.totalPlates, 180);
    assert.equal(settlement.snapshot.room.billAmountPaise, 1080000);
    assert.equal(settlement.snapshot.room.paidAmountPaise, 1080000);

    // Verify Socket.IO broadcast
    assert.equal(settlementBroadcasts.length, 1);
    assert.equal(settlementBroadcasts[0].month, PAST_MONTH);
    assert.equal(settlementBroadcasts[0].state, 'closed');
    assert.equal(settlementBroadcasts[0].sequence, 1);

    // Verify GET settlement status now reflects closed
    const statusRes = await request(app).get(`/api/settlements/${PAST_MONTH}`).expect(200);
    assert.equal(statusRes.body.data.state, 'closed');
    assert.equal(statusRes.body.data.canClose, false);
    assert.equal(statusRes.body.data.canReopen, true);
  });

  test('Attempting to close an already-closed month returns 409 Conflict', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .expect(201);

    const secondClose = await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .expect(409);

    assert.equal(secondClose.body.success, false);
    assert.match(secondClose.body.message, /already closed/i);
  });
});

describe('Phase 10: Closed-Month Mutation Locks', () => {
  beforeEach(async () => {
    await rateRepository.create({
      month: PAST_MONTH,
      morningPricePaise: 5000,
      nightPricePaise: 6000,
      revision: 1,
      changes: [],
    });

    for (const memberId of MEMBER_IDS) {
      await paymentRepository.create({
        paymentId: `pay-settle-${memberId}`,
        month: PAST_MONTH,
        memberId,
        amountPaise: 360000,
        status: 'recorded',
        idempotencyKey: `idem-settle-${memberId}`,
        recordedAt: new Date('2026-09-30T10:00:00.000Z'),
        recordedByRole: 'superadmin',
      });
    }

    // Close the month
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .expect(201);
  });

  test('meal edits are rejected for closed month with 409 Conflict', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const res = await request(app)
      .patch('/api/meals/2026-09-15')
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ mealType: 'morning', memberId: 'gaurav', status: 'skip' })
      .expect(409);

    assert.equal(res.body.success, false);
    assert.match(res.body.message, /month is closed.*reopen/i);
  });

  test('plate allocation changes are rejected for closed month with 409 Conflict', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const res = await request(app)
      .put('/api/meals/2026-09-15/morning/allocation')
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ plates: [{ shares: { gaurav: 6, nikhil: 0, devansh: 0 } }] })
      .expect(409);

    assert.equal(res.body.success, false);
    assert.match(res.body.message, /month is closed.*reopen/i);
  });

  test('payment prepare is rejected for closed month with 409 Conflict', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const res = await request(app)
      .post('/api/payments/prepare')
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ month: PAST_MONTH, memberId: 'gaurav' })
      .expect(409);

    assert.equal(res.body.success, false);
    assert.match(res.body.message, /month is closed.*reopen/i);
  });

  test('payment record is rejected for closed month with 409 Conflict', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const res = await request(app)
      .post('/api/payments')
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({
        month: PAST_MONTH,
        memberId: 'gaurav',
        amountPaise: 1000,
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
      })
      .expect(409);

    assert.equal(res.body.success, false);
    assert.match(res.body.message, /month is closed.*reopen/i);
  });

  test('payment void is rejected for closed month with 409 Conflict', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const res = await request(app)
      .post('/api/payments/pay-settle-gaurav/void')
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ reason: 'Mistake' })
      .expect(409);

    assert.equal(res.body.success, false);
    assert.match(res.body.message, /month is closed.*reopen/i);
  });

  test('current open month operations continue normally', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const mealRes = await request(app)
      .patch('/api/meals/2026-10-05')
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ mealType: 'morning', memberId: 'gaurav', status: 'skip' })
      .expect(200);

    assert.equal(mealRes.body.success, true);
  });
});

describe('Phase 10: Reopening, Corrections & Historical Versioning', () => {
  beforeEach(async () => {
    for (const memberId of MEMBER_IDS) {
      await paymentRepository.create({
        paymentId: `pay-settle-${memberId}`,
        month: PAST_MONTH,
        memberId,
        amountPaise: 360000,
        status: 'recorded',
        idempotencyKey: `idem-settle-${memberId}`,
        recordedAt: new Date('2026-09-30T10:00:00.000Z'),
        recordedByRole: 'superadmin',
      });
    }

    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .expect(201);
  });

  test('reopen requires Super Admin and a non-empty reason', async () => {
    const adminCookie = await cookieFor(ROLES.ADMIN);
    await request(app)
      .post(`/api/settlements/${PAST_MONTH}/reopen`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie)
      .send({ reason: 'Found error' })
      .expect(403);

    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    // Missing reason
    const emptyRes = await request(app)
      .post(`/api/settlements/${PAST_MONTH}/reopen`)
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ reason: '' })
      .expect(400);

    assert.match(emptyRes.body.message, /reason/i);
  });

  test('Super Admin reopens month: old settlement preserved, mutations re-enabled, re-close creates sequence 2', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const reopenRes = await request(app)
      .post(`/api/settlements/${PAST_MONTH}/reopen`)
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ reason: 'Found an incorrect meal entry on 18 Sep' })
      .expect(200);

    assert.equal(reopenRes.body.success, true);
    assert.equal(reopenRes.body.data.status, 'reopened');
    assert.equal(reopenRes.body.data.reopenReason, 'Found an incorrect meal entry on 18 Sep');

    // Mutations are now allowed!
    const mealRes = await request(app)
      .patch('/api/meals/2026-09-18')
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ mealType: 'night', memberId: 'gaurav', status: 'skip' })
      .expect(200);

    assert.equal(mealRes.body.success, true);

    // Gaurav skipped 1 night meal (7000 paise).
    // Now Gaurav has overpaid by 7000 paise!
    const statusRes = await request(app).get(`/api/settlements/${PAST_MONTH}`).expect(200);
    assert.equal(statusRes.body.data.canClose, false);
    assert.ok(statusRes.body.data.blockers.some((b) => b.type === 'overpayment'));

    // Void the old payment and re-record correct amount
    await paymentRepository.voidIfRecorded({
      paymentId: 'pay-settle-gaurav',
      voidedAt: new Date(),
      voidedByRole: 'superadmin',
      voidReason: 'Correcting for skipped meal',
    });

    // Re-record exact payment (360000 - 7000 = 353000)
    await paymentRepository.create({
      paymentId: 'pay-settle-gaurav-2',
      month: PAST_MONTH,
      memberId: 'gaurav',
      amountPaise: 353000,
      status: 'recorded',
      idempotencyKey: 'idem-settle-gaurav-2',
      recordedAt: new Date(),
      recordedByRole: 'superadmin',
    });

    // Check status is ready_to_close again
    const readyRes = await request(app).get(`/api/settlements/${PAST_MONTH}`).expect(200);
    assert.equal(readyRes.body.data.canClose, true);

    // Re-close the month
    const recloseRes = await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .expect(201);

    assert.equal(recloseRes.body.data.sequence, 2);
    assert.equal(recloseRes.body.data.status, 'closed');
    assert.equal(recloseRes.body.data.snapshot.members.gaurav.nightCount, 29);
    assert.equal(recloseRes.body.data.snapshot.members.gaurav.billAmountPaise, 353000);

    // Verify history returns sequence 2 and sequence 1
    const historyRes = await request(app)
      .get(`/api/settlements/${PAST_MONTH}/history`)
      .set('Cookie', superAdminCookie)
      .expect(200);

    assert.equal(historyRes.body.data.length, 2);
    assert.equal(historyRes.body.data[0].sequence, 2);
    assert.equal(historyRes.body.data[0].status, 'closed');
    assert.equal(historyRes.body.data[1].sequence, 1);
    assert.equal(historyRes.body.data[1].status, 'reopened');
  });
});

describe('Phase 10: PDF & CSV Final Statement Exports', () => {
  beforeEach(async () => {
    for (const memberId of MEMBER_IDS) {
      await paymentRepository.create({
        paymentId: `pay-settle-${memberId}`,
        month: PAST_MONTH,
        memberId,
        amountPaise: 360000,
        status: 'recorded',
        idempotencyKey: `idem-settle-${memberId}`,
        recordedAt: new Date('2026-09-30T10:00:00.000Z'),
        recordedByRole: 'superadmin',
      });
    }

    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    await request(app)
      .post(`/api/settlements/${PAST_MONTH}/close`)
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .expect(201);
  });

  test('PDF download requires authenticated session (Viewer rejected)', async () => {
    await request(app).get(`/api/settlements/${PAST_MONTH}/statement.pdf`).expect(401);
  });

  test('PDF download generates valid application/pdf with headers and frozen snapshot data', async () => {
    const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const res = await request(app)
      .get(`/api/settlements/${PAST_MONTH}/statement.pdf`)
      .set('Cookie', memberCookie)
      .expect(200);

    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.headers['content-disposition'], /attachment; filename="MealKhata-Settlement-2026-09\.pdf"/);

    // Verify PDF header magic bytes %PDF
    const buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text);
    assert.ok(buffer.length > 500);
    assert.equal(buffer.subarray(0, 4).toString('ascii'), '%PDF');
  });

  test('CSV download generates text/csv with complete headers and all member rows', async () => {
    const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const res = await request(app)
      .get(`/api/settlements/${PAST_MONTH}/statement.csv`)
      .set('Cookie', memberCookie)
      .expect(200);

    assert.match(res.headers['content-type'], /text\/csv/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.headers['content-disposition'], /attachment; filename="MealKhata-Settlement-2026-09\.csv"/);

    const csvContent = res.text;
    const lines = csvContent.trim().split('\n');
    assert.ok(lines.length >= 4); // header + 3 members

    // Check header columns
    assert.match(lines[0], /month,settlement_id,settlement_sequence,member_id,member_name/);
    assert.match(lines[0], /morning_participations,night_participations/);
    assert.match(lines[0], /bill_amount_paise,paid_amount_paise,remaining_amount_paise,status,closed_at/);

    // Check member rows
    for (const member of MEMBERS) {
      const memberLine = lines.find((l) => l.includes(member.id));
      assert.ok(memberLine, `Missing CSV row for member ${member.id}`);
      assert.ok(memberLine.includes(member.name));
      assert.ok(memberLine.includes('360000')); // bill and paid in paise
    }
  });

  test('PDF & CSV exports for an unclosed month return 404', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const pdfRes = await request(app)
      .get(`/api/settlements/${CURRENT_MONTH}/statement.pdf`)
      .set('Cookie', superAdminCookie)
      .expect(404);

    assert.match(pdfRes.body.message, /only available for closed months/i);

    const csvRes = await request(app)
      .get(`/api/settlements/${CURRENT_MONTH}/statement.csv`)
      .set('Cookie', superAdminCookie)
      .expect(404);

    assert.match(csvRes.body.message, /only available for closed months/i);
  });
});
