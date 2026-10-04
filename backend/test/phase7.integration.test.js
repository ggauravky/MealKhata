import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/auth/auth.service.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createBillingRouter } from '../src/routes/billing.routes.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { createPaymentRouter } from '../src/routes/payment.routes.js';
import { createPaymentService } from '../src/payments/payment.service.js';
import { createPaymentSettingsRouter } from '../src/routes/paymentSettings.routes.js';
import { createPaymentSettingsService } from '../src/payments/paymentSettings.service.js';
import { createPaymentSummaryService } from '../src/payments/paymentSummary.service.js';
import { createReminderSettingsRouter } from '../src/routes/reminderSettings.routes.js';
import { createReminderSettingsService } from '../src/settings/reminderSettings.service.js';
import { seedMemberAccounts, validateMemberSeedConfigs } from '../scripts/seedMemberAccounts.js';
import { InMemoryMemberAccountRepository } from './helpers/inMemoryMemberAccountRepository.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { InMemoryMonthlyRateRepository } from './helpers/inMemoryMonthlyRateRepository.js';
import { InMemoryPaymentRepository } from './helpers/inMemoryPaymentRepository.js';
import { InMemoryPaymentSettingsRepository } from './helpers/inMemoryPaymentSettingsRepository.js';
import { InMemoryReminderSettingsRepository } from './helpers/inMemoryReminderSettingsRepository.js';
import { TEST_CREDENTIALS } from './setup-env.js';

const ORIGIN = 'http://localhost:5173';
const NOW = new Date('2026-09-10T12:00:00.000Z');
const DATES = Object.freeze({
  yesterday: '2026-09-09',
  today: '2026-09-10',
  tomorrow: '2026-09-11',
});

const MEMBER_PASSWORDS = Object.freeze({
  gaurav: 'GauravPassword#123',
  nikhil: 'NikhilPassword#456',
  devansh: 'DevanshPassword#789',
});

const MEMBER_HASHES = Object.freeze({
  gaurav: await bcrypt.hash(MEMBER_PASSWORDS.gaurav, 12),
  nikhil: await bcrypt.hash(MEMBER_PASSWORDS.nikhil, 12),
  devansh: await bcrypt.hash(MEMBER_PASSWORDS.devansh, 12),
});

const MEMBER_EMAILS = Object.freeze({
  gaurav: 'gaurav.phase7@mealkhata.local',
  nikhil: 'nikhil.phase7@mealkhata.local',
  devansh: 'devansh.phase7@mealkhata.local',
});

class MutableReportService {
  constructor() {
    this.ratesConfigured = true;
    this.bills = { gaurav: 200_000, nikhil: 200_000, devansh: 200_000 };
  }

  async getMonthlyReport(month) {
    const periodType = 'current';
    const amount = (memberId) => (this.ratesConfigured ? this.bills[memberId] : null);
    const members = Object.fromEntries(
      Object.keys(this.bills).map((memberId) => [memberId, { amountPaise: amount(memberId) }]),
    );
    const roomAmount = this.ratesConfigured
      ? Object.values(this.bills).reduce((total, value) => total + value, 0)
      : null;
    const summary = { members, room: { amountPaise: roomAmount } };
    return {
      month,
      periodType,
      today: '2026-09-10',
      rates: { configured: this.ratesConfigured },
      toDate: summary,
      projection: summary,
    };
  }
}

function setupTestEnvironment() {
  const memberAccountRepo = new InMemoryMemberAccountRepository([
    {
      memberId: 'gaurav',
      email: MEMBER_EMAILS.gaurav,
      passwordHash: MEMBER_HASHES.gaurav,
      active: true,
    },
    {
      memberId: 'nikhil',
      email: MEMBER_EMAILS.nikhil,
      passwordHash: MEMBER_HASHES.nikhil,
      active: true,
    },
    {
      memberId: 'devansh',
      email: MEMBER_EMAILS.devansh,
      passwordHash: MEMBER_HASHES.devansh,
      active: true,
    },
  ]);

  const mealRepo = new InMemoryMealRepository();
  const billingRepo = new InMemoryMonthlyRateRepository();
  const paymentRepo = new InMemoryPaymentRepository();
  const paymentSettingsRepo = new InMemoryPaymentSettingsRepository();
  const reminderSettingsRepo = new InMemoryReminderSettingsRepository();

  const authService = createAuthService({ accounts: memberAccountRepo });
  const auth = createAuthRouter({ service: authService });

  const mealService = createMealService({ repository: mealRepo, timezone: 'Asia/Kolkata' });
  const meals = createMealRouter({
    service: mealService,
    broadcast: () => {},
    now: () => NOW,
    timezone: 'Asia/Kolkata',
  });

  const billingService = createMonthlyRateService({ repository: billingRepo });
  const billing = createBillingRouter({
    service: billingService,
    broadcast: () => {},
  });

  const paymentSettingsService = createPaymentSettingsService({ repository: paymentSettingsRepo });
  const paymentSettings = createPaymentSettingsRouter({
    service: paymentSettingsService,
    broadcast: () => {},
  });

  const reports = new MutableReportService();
  const summaryService = createPaymentSummaryService({ reports, repository: paymentRepo });
  const paymentService = createPaymentService({
    repository: paymentRepo,
    reports,
    summaries: summaryService,
    settings: paymentSettingsService,
    now: () => NOW,
  });
  const payments = createPaymentRouter({
    service: paymentService,
    broadcast: () => {},
    now: () => NOW,
  });

  const reminderSettingsService = createReminderSettingsService({ repository: reminderSettingsRepo });
  const reminderSettings = createReminderSettingsRouter({
    service: reminderSettingsService,
    broadcast: () => {},
  });

  const app = createApp({
    auth,
    meals,
    billing,
    payments,
    paymentSettings,
    reminderSettings,
  });

  return {
    app,
    memberAccountRepo,
    mealRepo,
    billingRepo,
    paymentRepo,
    paymentSettingsRepo,
    mealService,
    paymentService,
  };
}

let env;

beforeEach(() => {
  env = setupTestEnvironment();
});

async function cookieFor(role, memberId = null) {
  const token = await createSessionToken(role, { memberId });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe('Phase 7: Member Account Seeding', () => {
  test('validates seed configuration requirements and constraints', () => {
    assert.throws(
      () => validateMemberSeedConfigs([
        { memberId: 'gaurav', email: 'not-an-email', passwordHash: MEMBER_HASHES.gaurav },
      ]),
      /Invalid email address/,
    );

    assert.throws(
      () => validateMemberSeedConfigs([
        { memberId: 'gaurav', email: 'valid@example.com', passwordHash: 'not-bcrypt-cost-12' },
      ]),
      /cost 12/,
    );

    assert.throws(
      () => validateMemberSeedConfigs(
        [
          { memberId: 'gaurav', email: 'admin@mealkhata.local', passwordHash: MEMBER_HASHES.gaurav },
          { memberId: 'nikhil', email: 'nikhil@example.com', passwordHash: MEMBER_HASHES.nikhil },
          { memberId: 'devansh', email: 'devansh@example.com', passwordHash: MEMBER_HASHES.devansh },
        ],
        { env: { ADMIN_EMAIL: 'admin@mealkhata.local' } },
      ),
      /Member email cannot match admin/,
    );

    assert.throws(
      () => validateMemberSeedConfigs([
        { memberId: 'gaurav', email: 'same@example.com', passwordHash: MEMBER_HASHES.gaurav },
        { memberId: 'nikhil', email: 'same@example.com', passwordHash: MEMBER_HASHES.nikhil },
        { memberId: 'devansh', email: 'devansh@example.com', passwordHash: MEMBER_HASHES.devansh },
      ]),
      /Duplicate member email/,
    );
  });

  test('seedMemberAccounts is idempotent and creates exactly three accounts', async () => {
    const repo = new InMemoryMemberAccountRepository();
    const members = [
      { memberId: 'gaurav', email: MEMBER_EMAILS.gaurav, passwordHash: MEMBER_HASHES.gaurav },
      { memberId: 'nikhil', email: MEMBER_EMAILS.nikhil, passwordHash: MEMBER_HASHES.nikhil },
      { memberId: 'devansh', email: MEMBER_EMAILS.devansh, passwordHash: MEMBER_HASHES.devansh },
    ];

    const firstRun = await seedMemberAccounts({ members, repository: repo, env: process.env });
    assert.equal(firstRun.length, 3);

    const secondRun = await seedMemberAccounts({ members, repository: repo, env: process.env });
    assert.equal(secondRun.length, 3);

    const all = await repo.findAll();
    assert.equal(all.length, 3);
  });
});

describe('Phase 7: Authentication & Session Identity', () => {
  test('all three member accounts can log in with their separate credentials', async () => {
    for (const [memberId, password] of Object.entries(MEMBER_PASSWORDS)) {
      const response = await request(env.app)
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: MEMBER_EMAILS[memberId], password });

      assert.equal(response.status, 200, `Login for ${memberId} should succeed`);
      assert.equal(response.body.session.authenticated, true);
      assert.equal(response.body.session.role, ROLES.MEMBER);
      assert.equal(response.body.session.memberId, memberId);
      assert.equal(
        response.body.session.displayName,
        memberId[0].toUpperCase() + memberId.slice(1),
      );
      assert.equal(response.body.session.capabilities.canEditToday, true);
      assert.equal(response.body.session.capabilities.canEditPast, false);
      assert.equal(response.body.session.capabilities.canEditFuture, false);

      const cookie = response.headers['set-cookie']?.[0] ?? '';
      assert.match(cookie, /^mk_session=/);
      assert.match(cookie, /HttpOnly/i);
    }
  });

  test('incorrect member password and unknown email fail with identical 401 response', async () => {
    const wrongPassword = await request(env.app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: MEMBER_EMAILS.gaurav, password: 'WrongPassword#999' });

    const unknownEmail = await request(env.app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'nonexistent@mealkhata.local', password: 'AnyPassword#999' });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.deepEqual(wrongPassword.body, unknownEmail.body);
    assert.equal(wrongPassword.body.message, 'Invalid email or password.');
  });

  test('existing Admin and Super Admin logins continue to function unchanged', async () => {
    const adminRes = await request(env.app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send(TEST_CREDENTIALS.admin);

    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.body.session.role, ROLES.ADMIN);
    assert.equal(adminRes.body.session.memberId, undefined);

    const superAdminRes = await request(env.app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send(TEST_CREDENTIALS.superadmin);

    assert.equal(superAdminRes.status, 200);
    assert.equal(superAdminRes.body.session.role, ROLES.SUPERADMIN);
    assert.equal(superAdminRes.body.session.memberId, undefined);
  });

  test('GET /api/auth/session returns member identity when authenticated', async () => {
    const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const response = await request(env.app)
      .get('/api/auth/session')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie);

    assert.equal(response.status, 200);
    assert.equal(response.body.session.authenticated, true);
    assert.equal(response.body.session.role, ROLES.MEMBER);
    assert.equal(response.body.session.memberId, 'gaurav');
    assert.equal(response.body.session.displayName, 'Gaurav');
  });

  test('Viewer session remains valid when unauthenticated', async () => {
    const response = await request(env.app)
      .get('/api/auth/session')
      .set('Origin', ORIGIN);

    assert.equal(response.status, 200);
    assert.equal(response.body.session.authenticated, false);
    assert.equal(response.body.session.role, ROLES.VIEWER);
    assert.equal(response.body.session.memberId, undefined);
  });
});

describe('Phase 7: Meal Mutation Authorization & Ownership', () => {
  test('Gaurav can edit his own meal today', async () => {
    const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const response = await request(env.app)
      .patch(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ mealType: 'night', memberId: 'gaurav', status: 'skip' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.meals.night.gaurav, 'skip');
  });

  test('Gaurav CANNOT edit Nikhil or Devansh meal today (returns 403)', async () => {
    const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');

    const editNikhil = await request(env.app)
      .patch(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ mealType: 'morning', memberId: 'nikhil', status: 'skip' });

    assert.equal(editNikhil.status, 403);

    const editDevansh = await request(env.app)
      .patch(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ mealType: 'night', memberId: 'devansh', status: 'skip' });

    assert.equal(editDevansh.status, 403);
  });

  test('Gaurav CANNOT edit yesterday or tomorrow (returns 403)', async () => {
    const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');

    const editYesterday = await request(env.app)
      .patch(`/api/meals/${DATES.yesterday}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ mealType: 'morning', memberId: 'gaurav', status: 'skip' });

    assert.equal(editYesterday.status, 403);

    const editTomorrow = await request(env.app)
      .patch(`/api/meals/${DATES.tomorrow}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ mealType: 'morning', memberId: 'gaurav', status: 'skip' });

    assert.equal(editTomorrow.status, 403);
  });

  test('Admin can edit all members today, but not past/future dates', async () => {
    const cookie = await cookieFor(ROLES.ADMIN);

    const editNikhilToday = await request(env.app)
      .patch(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ mealType: 'morning', memberId: 'nikhil', status: 'skip' });

    assert.equal(editNikhilToday.status, 200);

    const editYesterday = await request(env.app)
      .patch(`/api/meals/${DATES.yesterday}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ mealType: 'morning', memberId: 'gaurav', status: 'skip' });

    assert.equal(editYesterday.status, 403);
  });

  test('Super Admin can edit any member across dates', async () => {
    const cookie = await cookieFor(ROLES.SUPERADMIN);

    const editYesterday = await request(env.app)
      .patch(`/api/meals/${DATES.yesterday}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ mealType: 'night', memberId: 'devansh', status: 'skip' });

    assert.equal(editYesterday.status, 200);
  });

  test('Viewer cannot edit any meal (returns 401)', async () => {
    const response = await request(env.app)
      .patch(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .send({ mealType: 'night', memberId: 'gaurav', status: 'skip' });

    assert.equal(response.status, 401);
  });

  test('GET /api/meals/today returns permissions and editableMemberIds correctly', async () => {
    const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const memberRes = await request(env.app)
      .get(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .set('Cookie', memberCookie);

    assert.equal(memberRes.body.data.permissions.canEdit, true);
    assert.deepEqual(memberRes.body.data.permissions.editableMemberIds, ['gaurav']);

    const adminCookie = await cookieFor(ROLES.ADMIN);
    const adminRes = await request(env.app)
      .get(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie);

    assert.equal(adminRes.body.data.permissions.canEdit, true);
    assert.deepEqual(adminRes.body.data.permissions.editableMemberIds, ['gaurav', 'nikhil', 'devansh']);

    const viewerRes = await request(env.app)
      .get(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN);

    assert.equal(viewerRes.body.data.permissions.canEdit, false);
    assert.deepEqual(viewerRes.body.data.permissions.editableMemberIds, []);
  });
});

describe('Phase 7: Meal Audit History', () => {
  test('records actorRole=member and actorMemberId for member meal mutation', async () => {
    const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const adminCookie = await cookieFor(ROLES.ADMIN);

    await request(env.app)
      .patch(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .set('Cookie', memberCookie)
      .send({ mealType: 'night', memberId: 'gaurav', status: 'skip' });

    const historyRes = await request(env.app)
      .get(`/api/meals/${DATES.today}/history`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie);

    assert.equal(historyRes.status, 200);
    assert.equal(historyRes.body.data.items.length, 1);
    const entry = historyRes.body.data.items[0];
    assert.equal(entry.actorRole, ROLES.MEMBER);
    assert.equal(entry.actorMemberId, 'gaurav');
    assert.equal(entry.memberId, 'gaurav');
    assert.equal(entry.mealType, 'night');
    assert.equal(entry.from, 'not_set');
    assert.equal(entry.to, 'skip');
  });

  test('admin mutation records actorRole=admin and null actorMemberId', async () => {
    const adminCookie = await cookieFor(ROLES.ADMIN);
    await request(env.app)
      .patch(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie)
      .send({ mealType: 'morning', memberId: 'nikhil', status: 'skip' });

    const historyRes = await request(env.app)
      .get(`/api/meals/${DATES.today}/history`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie);

    assert.equal(historyRes.status, 200);
    const entry = historyRes.body.data.items[0];
    assert.equal(entry.actorRole, ROLES.ADMIN);
    assert.equal(entry.actorMemberId, null);
  });
});

describe('Phase 7: Payment Ownership & Privileges', () => {
  beforeEach(async () => {
    // Configure rates and payment receiver settings
    const superCookie = await cookieFor(ROLES.SUPERADMIN);
    await request(env.app)
      .put('/api/billing/rates/2026-09')
      .set('Origin', ORIGIN)
      .set('Cookie', superCookie)
      .send({
        morningPricePaise: 4000,
        nightPricePaise: 5000,
      });

    await request(env.app)
      .put('/api/payment-settings')
      .set('Origin', ORIGIN)
      .set('Cookie', superCookie)
      .send({
        receiverName: 'Household Manager',
        upiId: 'manager@upi',
        receiverMobile: '9876543210',
      });
  });

  test('Gaurav can prepare and record his own payment, but not Nikhil or Devansh', async () => {
    const gauravCookie = await cookieFor(ROLES.MEMBER, 'gaurav');

    // Gaurav prepares Gaurav -> 200
    const prepareGaurav = await request(env.app)
      .post('/api/payments/prepare')
      .set('Origin', ORIGIN)
      .set('Cookie', gauravCookie)
      .send({
        memberId: 'gaurav',
        month: '2026-09',
      });

    assert.equal(prepareGaurav.status, 200);
    assert.equal(prepareGaurav.body.data.memberId, 'gaurav');
    assert.equal(Number.isInteger(prepareGaurav.body.data.amountPaise), true);

    // Gaurav prepares Nikhil -> 403
    const prepareNikhil = await request(env.app)
      .post('/api/payments/prepare')
      .set('Origin', ORIGIN)
      .set('Cookie', gauravCookie)
      .send({
        memberId: 'nikhil',
        month: '2026-09',
      });

    assert.equal(prepareNikhil.status, 403);

    // Gaurav records his own payment -> 200
    const idempotencyKey = '11111111-2222-4333-8444-555555555555';
    const recordGaurav = await request(env.app)
      .post('/api/payments')
      .set('Origin', ORIGIN)
      .set('Cookie', gauravCookie)
      .send({
        idempotencyKey,
        memberId: 'gaurav',
        month: '2026-09',
        amountPaise: prepareGaurav.body.data.amountPaise,
        upiReference: 'UPI-REF-GAURAV-1',
      });

    assert.equal(recordGaurav.status, 201);
    assert.equal(recordGaurav.body.data.recordedByRole, ROLES.MEMBER);
    assert.equal(recordGaurav.body.data.recordedByMemberId, 'gaurav');

    // Gaurav attempts to record payment for Nikhil -> 403
    const recordNikhil = await request(env.app)
      .post('/api/payments')
      .set('Origin', ORIGIN)
      .set('Cookie', gauravCookie)
      .send({
        idempotencyKey: '22222222-3333-4444-8555-666666666666',
        memberId: 'nikhil',
        month: '2026-09',
        amountPaise: 10000,
      });

    assert.equal(recordNikhil.status, 403);
  });

  test('Member CANNOT void payments (returns 403)', async () => {
    // Record payment first
    const gauravCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const prepare = await request(env.app)
      .post('/api/payments/prepare')
      .set('Origin', ORIGIN)
      .set('Cookie', gauravCookie)
      .send({ memberId: 'gaurav', month: '2026-09' });

    const record = await request(env.app)
      .post('/api/payments')
      .set('Origin', ORIGIN)
      .set('Cookie', gauravCookie)
      .send({
        idempotencyKey: '33333333-4444-4555-8666-777777777777',
        memberId: 'gaurav',
        month: '2026-09',
        amountPaise: prepare.body.data.amountPaise,
      });

    const paymentId = record.body.data.paymentId;

    // Gaurav tries to void his own payment -> 403
    const voidRes = await request(env.app)
      .post(`/api/payments/${paymentId}/void`)
      .set('Origin', ORIGIN)
      .set('Cookie', gauravCookie)
      .send({ reason: 'Accidental payment' });

    assert.equal(voidRes.status, 403);

    // Super Admin can void -> 200
    const superCookie = await cookieFor(ROLES.SUPERADMIN);
    const superVoidRes = await request(env.app)
      .post(`/api/payments/${paymentId}/void`)
      .set('Origin', ORIGIN)
      .set('Cookie', superCookie)
      .send({ reason: 'Approved correction' });

    assert.equal(superVoidRes.status, 200);
    assert.equal(superVoidRes.body.data.status, 'voided');
    assert.equal(superVoidRes.body.data.voidedByRole, ROLES.SUPERADMIN);
  });

  test('Member cannot access administrative mutation endpoints (returns 403)', async () => {
    const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');

    // Meal rates PUT
    const ratesRes = await request(env.app)
      .put('/api/billing/rates/2026-09')
      .set('Origin', ORIGIN)
      .set('Cookie', memberCookie)
      .send({ morningPricePaise: 4000, nightPricePaise: 5000 });
    assert.equal(ratesRes.status, 403);

    // Payment settings PUT
    const settingsRes = await request(env.app)
      .put('/api/payment-settings')
      .set('Origin', ORIGIN)
      .set('Cookie', memberCookie)
      .send({ receiverName: 'Hacker', receiverMobile: '9999999999' });
    assert.equal(settingsRes.status, 403);

    // Reminder settings PUT
    const reminderRes = await request(env.app)
      .put('/api/settings/reminders')
      .set('Origin', ORIGIN)
      .set('Cookie', memberCookie)
      .send({ morningTime: '08:00', nightTime: '20:00' });
    assert.equal(reminderRes.status, 403);
  });
});
