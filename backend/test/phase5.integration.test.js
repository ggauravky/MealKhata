import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { Payment } from '../src/payments/payment.model.js';
import { createPaymentService, paiseToUpiAmount } from '../src/payments/payment.service.js';
import { PaymentSettings } from '../src/payments/paymentSettings.model.js';
import { createPaymentSettingsService } from '../src/payments/paymentSettings.service.js';
import { createPaymentSummaryService, derivePaymentAmounts } from '../src/payments/paymentSummary.service.js';
import { createPaymentRouter } from '../src/routes/payment.routes.js';
import { createPaymentSettingsRouter } from '../src/routes/paymentSettings.routes.js';
import { InMemoryPaymentRepository } from './helpers/inMemoryPaymentRepository.js';
import { InMemoryPaymentSettingsRepository } from './helpers/inMemoryPaymentSettingsRepository.js';

const ORIGIN = 'http://localhost:5173';
const MONTH = '2026-09';
const NOW = new Date('2026-09-10T14:12:00.000Z');
const RECEIVER = Object.freeze({
  receiverName: 'Gaurav Kumar Yadav',
  upiId: 'gaurav+meals@upi',
  receiverMobile: '9876543210',
});

class MutableReportService {
  constructor() {
    this.reset();
  }

  reset() {
    this.ratesConfigured = true;
    this.bills = { gaurav: 200_000, nikhil: 200_000, devansh: 200_000 };
  }

  setBill(memberId, amountPaise) {
    this.bills[memberId] = amountPaise;
  }

  async getMonthlyReport(month) {
    const periodType = month < MONTH ? 'past' : month > MONTH ? 'future' : 'current';
    const amount = (memberId) => this.ratesConfigured ? this.bills[memberId] : null;
    const members = Object.fromEntries(Object.keys(this.bills).map((memberId) => [memberId, { amountPaise: amount(memberId) }]));
    const roomAmount = this.ratesConfigured ? Object.values(this.bills).reduce((total, value) => total + value, 0) : null;
    const summary = { members, room: { amountPaise: roomAmount } };
    return {
      month,
      periodType,
      today: '2026-09-10',
      rates: { configured: this.ratesConfigured },
      toDate: periodType === 'future' ? null : summary,
      projection: summary,
    };
  }
}

const settingsRepository = new InMemoryPaymentSettingsRepository();
const paymentRepository = new InMemoryPaymentRepository();
const reports = new MutableReportService();
const settingsService = createPaymentSettingsService({ repository: settingsRepository });
const summaryService = createPaymentSummaryService({ reports, repository: paymentRepository });
const paymentService = createPaymentService({
  repository: paymentRepository,
  reports,
  summaries: summaryService,
  settings: settingsService,
  now: () => NOW,
});
const settingsEvents = [];
const paymentEvents = [];
const paymentSettings = createPaymentSettingsRouter({
  service: settingsService,
  broadcast: (payload) => settingsEvents.push(payload),
});
const payments = createPaymentRouter({
  service: paymentService,
  summaries: summaryService,
  broadcast: (payload) => paymentEvents.push(payload),
});
const testApp = createApp({ paymentSettings, payments });

async function cookieFor(role) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role)}`;
}

async function configureSettings(receiver = RECEIVER) {
  return settingsService.updateSettings({ ...receiver, actorRole: ROLES.SUPERADMIN, changedAt: NOW });
}

async function authenticatedMutation(method, path, role, body) {
  let call = request(testApp)[method](path).set('Origin', ORIGIN).send(body);
  if (role) call = call.set('Cookie', await cookieFor(role));
  return call;
}

function paymentBody(overrides = {}) {
  return {
    month: MONTH,
    memberId: 'nikhil',
    amountPaise: 50_000,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function record(role = ROLES.ADMIN, overrides = {}) {
  return authenticatedMutation('post', '/api/payments', role, paymentBody(overrides));
}

beforeEach(() => {
  settingsRepository.reset();
  paymentRepository.reset();
  reports.reset();
  settingsEvents.length = 0;
  paymentEvents.length = 0;
});

describe('payment receiver settings', () => {
  test('GET requires Admin or Super Admin and does not create missing settings', async () => {
    await request(testApp).get('/api/payment-settings').expect(401);
    const admin = await request(testApp).get('/api/payment-settings').set('Cookie', await cookieFor(ROLES.ADMIN)).expect(200);
    await request(testApp).get('/api/payment-settings').set('Cookie', await cookieFor(ROLES.SUPERADMIN)).expect(200);
    assert.equal(admin.body.data.configured, false);
    assert.equal(settingsRepository.count(), 0);
  });

  test('only Super Admin can update receiver settings', async () => {
    assert.equal((await authenticatedMutation('put', '/api/payment-settings', null, RECEIVER)).status, 401);
    assert.equal((await authenticatedMutation('put', '/api/payment-settings', ROLES.ADMIN, RECEIVER)).status, 403);
    assert.equal((await authenticatedMutation('put', '/api/payment-settings', ROLES.SUPERADMIN, RECEIVER)).status, 200);
  });

  test('first save normalizes mobile, ignores browser actorRole, and emits a private-safe event', async () => {
    const response = await authenticatedMutation('put', '/api/payment-settings', ROLES.SUPERADMIN, {
      ...RECEIVER,
      receiverMobile: '+91 98765 43210',
      actorRole: ROLES.ADMIN,
    });
    const stored = await settingsRepository.findPrimary();
    assert.equal(response.status, 200);
    assert.equal(response.body.changed, true);
    assert.equal(response.body.data.receiverMobile, '9876543210');
    assert.equal(stored.changes[0].actorRole, ROLES.SUPERADMIN);
    assert.equal(settingsEvents.length, 1);
    assert.deepEqual(Object.keys(settingsEvents[0]).sort(), ['revision', 'updatedAt']);
    assert.doesNotMatch(JSON.stringify(settingsEvents[0]), /upi|mobile|gaurav/i);
  });

  test('invalid UPI IDs, malformed mobile numbers, and arbitrary extra fields are rejected', async () => {
    for (const body of [
      { ...RECEIVER, upiId: 'not-a-vpa' },
      { ...RECEIVER, upiId: 'two@@banks' },
      { ...RECEIVER, receiverMobile: '12345' },
      { ...RECEIVER, receiverName: 'Gaurav\nYadav' },
      { receiverName: 'Gaurav', upiId: '', receiverMobile: '' },
      { ...RECEIVER, paid: true },
    ]) {
      assert.equal((await authenticatedMutation('put', '/api/payment-settings', ROLES.SUPERADMIN, body)).status, 400);
    }
  });

  test('mobile-only receiver configuration is valid and never fabricates a UPI ID', async () => {
    const response = await authenticatedMutation('put', '/api/payment-settings', ROLES.SUPERADMIN, {
      receiverName: 'Gaurav',
      upiId: '',
      receiverMobile: '+91 98765 43210',
    });
    const stored = await settingsRepository.findPrimary();
    assert.equal(response.status, 200);
    assert.equal(response.body.data.upiId, null);
    assert.equal(response.body.data.receiverMobile, '9876543210');
    assert.equal(stored.upiId, null);
    assert.doesNotMatch(JSON.stringify(stored), /9876543210@|919876543210@/);
  });

  test('no-op does not increment revision/history/event and real update does', async () => {
    await configureSettings();
    const noOp = await authenticatedMutation('put', '/api/payment-settings', ROLES.SUPERADMIN, RECEIVER);
    assert.equal(noOp.body.changed, false);
    assert.equal(noOp.body.data.revision, 1);
    assert.equal(settingsEvents.length, 0);
    const changed = await authenticatedMutation('put', '/api/payment-settings', ROLES.SUPERADMIN, { ...RECEIVER, receiverName: 'Gaurav K Yadav' });
    const stored = await settingsRepository.findPrimary();
    assert.equal(changed.body.data.revision, 2);
    assert.equal(stored.changes.length, 2);
    assert.equal(settingsEvents.length, 1);
  });

  test('settings schema has a singleton unique immutable key and audit history', () => {
    assert.equal(PaymentSettings.schema.path('key').options.immutable, true);
    assert.ok(PaymentSettings.schema.indexes().some(([fields, options]) => fields.key === 1 && options.unique));
    assert.ok(PaymentSettings.schema.path('changes'));
    assert.equal(PaymentSettings.schema.path('upiId').options.required, false);
  });
});

describe('derived payment summary', () => {
  test('derives pending, partial, paid, and overpaid with integer paise', () => {
    assert.equal(derivePaymentAmounts({ billAmountPaise: 200_000, paidAmountPaise: 0, periodType: 'past', ratesConfigured: true }).status, 'pending');
    assert.deepEqual(derivePaymentAmounts({ billAmountPaise: 200_000, paidAmountPaise: 50_000, periodType: 'past', ratesConfigured: true }), { remainingAmountPaise: 150_000, overpaidAmountPaise: 0, status: 'partial' });
    assert.equal(derivePaymentAmounts({ billAmountPaise: 200_000, paidAmountPaise: 200_000, periodType: 'past', ratesConfigured: true }).status, 'paid');
    assert.deepEqual(derivePaymentAmounts({ billAmountPaise: 190_000, paidAmountPaise: 200_000, periodType: 'past', ratesConfigured: true }), { remainingAmountPaise: 0, overpaidAmountPaise: 10_000, status: 'overpaid' });
  });

  test('public summary has exactly three members and no receiver details', async () => {
    const response = await request(testApp).get(`/api/payments/summary/${MONTH}`).expect(200);
    assert.deepEqual(Object.keys(response.body.data.members), ['gaurav', 'nikhil', 'devansh']);
    assert.equal(response.body.data.members.nikhil.status, 'pending');
    assert.equal(response.body.data.room.billAmountPaise, 600_000);
    assert.doesNotMatch(JSON.stringify(response.body), /upiId|receiverMobile|payeeSnapshot|idempotency/i);
  });

  test('missing rates, future month, and explicit zero bill stay distinct', async () => {
    reports.ratesConfigured = false;
    let summary = await summaryService.getSummary(MONTH);
    assert.equal(summary.payable, false);
    assert.equal(summary.members.nikhil.status, 'rates_missing');
    reports.ratesConfigured = true;
    summary = await summaryService.getSummary('2026-10');
    assert.equal(summary.payable, false);
    assert.equal(summary.members.nikhil.status, 'not_due_yet');
    reports.setBill('nikhil', 0);
    summary = await summaryService.getSummary(MONTH);
    assert.equal(summary.members.nikhil.status, 'no_due');
  });

  test('voided payments do not contribute but remain available to history', async () => {
    await configureSettings();
    const response = await record();
    await paymentService.voidPayment({ paymentId: response.body.data.paymentId, reason: 'Mistaken entry', actorRole: ROLES.SUPERADMIN });
    const summary = await summaryService.getSummary(MONTH);
    const history = await paymentService.getHistory(MONTH);
    assert.equal(summary.members.nikhil.paidAmountPaise, 0);
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].status, 'voided');
  });
});

describe('UPI payment preparation', () => {
  test('Viewer is rejected while Admin and Super Admin receive the exact server-derived remaining amount', async () => {
    await configureSettings();
    const body = { month: MONTH, memberId: 'nikhil' };
    assert.equal((await authenticatedMutation('post', '/api/payments/prepare', null, body)).status, 401);
    const admin = await authenticatedMutation('post', '/api/payments/prepare', ROLES.ADMIN, body);
    const superAdmin = await authenticatedMutation('post', '/api/payments/prepare', ROLES.SUPERADMIN, body);
    assert.equal(admin.status, 200);
    assert.equal(superAdmin.status, 200);
    assert.equal(admin.body.data.amountPaise, 200_000);
    assert.equal(superAdmin.body.data.amountPaise, 200_000);
  });

  test('validates member, month, exact input shape, future period, rates, receiver, and remaining due', async () => {
    let response = await authenticatedMutation('post', '/api/payments/prepare', ROLES.ADMIN, { month: MONTH, memberId: 'nikhil' });
    assert.equal(response.status, 409, 'missing receiver');
    await configureSettings();
    const invalidBodies = [
      { month: '2026-13', memberId: 'nikhil' },
      { month: MONTH, memberId: 'other' },
      { month: MONTH, memberId: 'nikhil', amountPaise: 1 },
    ];
    for (const body of invalidBodies) {
      response = await authenticatedMutation('post', '/api/payments/prepare', ROLES.ADMIN, body);
      assert.equal(response.status, 400);
    }
    assert.equal((await authenticatedMutation('post', '/api/payments/prepare', ROLES.ADMIN, { month: '2026-10', memberId: 'nikhil' })).status, 409);
    reports.ratesConfigured = false;
    assert.equal((await authenticatedMutation('post', '/api/payments/prepare', ROLES.ADMIN, { month: MONTH, memberId: 'nikhil' })).status, 409);
    reports.ratesConfigured = true;
    reports.setBill('nikhil', 0);
    assert.equal((await authenticatedMutation('post', '/api/payments/prepare', ROLES.ADMIN, { month: MONTH, memberId: 'nikhil' })).status, 409);
  });

  test('generates an exact, encoded, secret-free UPI URI from server settings', async () => {
    await configureSettings();
    reports.setBill('nikhil', 6_250);
    const response = await authenticatedMutation('post', '/api/payments/prepare', ROLES.ADMIN, { month: MONTH, memberId: 'nikhil' });
    const uri = new URL(response.body.data.upiUri);
    assert.equal(uri.protocol, 'upi:');
    assert.equal(uri.hostname, 'pay');
    assert.equal(uri.searchParams.get('pa'), RECEIVER.upiId);
    assert.equal(uri.searchParams.get('pn'), RECEIVER.receiverName);
    assert.equal(uri.searchParams.get('am'), '62.50');
    assert.equal(uri.searchParams.get('cu'), 'INR');
    assert.equal(uri.searchParams.get('tn'), 'MealKhata Sep 2026 - Nikhil');
    assert.doesNotMatch(response.body.data.upiUri, /jwt|token|secret/i);
    assert.equal(paiseToUpiAmount(206_000), '2060.00');
  });

  test('mobile-only settings return copy-and-pay data without a fake UPI URI', async () => {
    await configureSettings({ receiverName: 'Gaurav', upiId: null, receiverMobile: '9876543210' });
    const response = await authenticatedMutation('post', '/api/payments/prepare', ROLES.ADMIN, { month: MONTH, memberId: 'nikhil' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.amountPaise, 200_000);
    assert.equal(response.body.data.payee.upiId, null);
    assert.equal(response.body.data.payee.mobile, '9876543210');
    assert.equal(response.body.data.upiUri, null);
    assert.doesNotMatch(JSON.stringify(response.body), /9876543210@|919876543210@/);
  });
});

describe('payment recording and idempotency', () => {
  beforeEach(async () => configureSettings());

  test('Viewer cannot record while Admin and Super Admin can', async () => {
    assert.equal((await record(null)).status, 401);
    assert.equal((await record(ROLES.ADMIN)).status, 201);
    assert.equal((await record(ROLES.SUPERADMIN)).status, 201);
  });

  test('rejects future, invalid member, invalid amount, and missing rates', async () => {
    assert.equal((await record(ROLES.ADMIN, { month: '2026-10' })).status, 409);
    assert.equal((await record(ROLES.ADMIN, { memberId: 'other' })).status, 400);
    assert.equal((await record(ROLES.ADMIN, { amountPaise: 0 })).status, 400);
    reports.ratesConfigured = false;
    assert.equal((await record()).status, 409);
  });

  test('server captures role, payee snapshot, authoritative bill, IDs, time, and optional reference', async () => {
    const response = await record(ROLES.ADMIN, { actorRole: ROLES.SUPERADMIN, billAmount: 1, upiReference: ' REF-123 ' });
    const stored = await paymentRepository.findByPaymentId(response.body.data.paymentId);
    assert.equal(stored.recordedByRole, ROLES.ADMIN);
    assert.equal(stored.billAmountAtPaymentPaise, 200_000);
    assert.deepEqual(stored.payeeSnapshot, RECEIVER);
    assert.equal(stored.upiReference, 'REF-123');
    assert.equal(stored.recordedAt.toISOString(), NOW.toISOString());
    assert.match(stored.paymentId, /^[0-9a-f-]{36}$/i);
  });

  test('same idempotency request returns the original and emits only once', async () => {
    const body = paymentBody();
    const first = await authenticatedMutation('post', '/api/payments', ROLES.ADMIN, body);
    const replay = await authenticatedMutation('post', '/api/payments', ROLES.ADMIN, body);
    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.created, false);
    assert.equal(replay.body.data.paymentId, first.body.data.paymentId);
    assert.equal(paymentRepository.count(), 1);
    assert.equal(paymentEvents.length, 1);
  });

  test('reusing a key for different data conflicts while a different key creates another partial payment', async () => {
    const body = paymentBody();
    await authenticatedMutation('post', '/api/payments', ROLES.ADMIN, body);
    assert.equal((await authenticatedMutation('post', '/api/payments', ROLES.ADMIN, { ...body, amountPaise: 40_000 })).status, 409);
    assert.equal((await record(ROLES.ADMIN, { amountPaise: 40_000 })).status, 201);
    assert.equal(paymentRepository.count(), 2);
  });

  test('records the declared prepared amount even when the bill drops before confirmation', async () => {
    reports.setBill('nikhil', 45_000);
    const response = await record(ROLES.ADMIN, { amountPaise: 50_000 });
    assert.equal(response.status, 201);
    const summary = await summaryService.getSummary(MONTH);
    assert.equal(summary.members.nikhil.status, 'overpaid');
    assert.equal(summary.members.nikhil.overpaidAmountPaise, 5_000);
  });

  test('failed writes are sanitized and emit nothing', async () => {
    paymentRepository.failWrites = true;
    const response = await record();
    assert.equal(response.status, 503);
    assert.equal(paymentEvents.length, 0);
    assert.doesNotMatch(JSON.stringify(response.body), /simulated|stack|database/i);
  });

  test('Payment schema has public UUID uniqueness, idempotency uniqueness, member/month index, and immutable money', () => {
    const indexes = Payment.schema.indexes();
    assert.ok(indexes.some(([fields, options]) => fields.paymentId === 1 && options.unique));
    assert.ok(indexes.some(([fields, options]) => fields.idempotencyKey === 1 && options.unique));
    assert.ok(indexes.some(([fields]) => fields.month === 1 && fields.memberId === 1));
    assert.equal(Payment.schema.path('amountPaise').options.immutable, true);
  });
});

describe('payment history, bill changes, and void correction', () => {
  beforeEach(async () => configureSettings());

  test('public history omits private/internal fields while authenticated history may include reference', async () => {
    await record(ROLES.ADMIN, { amountPaise: 20_000, upiReference: 'SAFE-REF' });
    const viewer = await request(testApp).get(`/api/payments/history/${MONTH}`).expect(200);
    const admin = await request(testApp).get(`/api/payments/history/${MONTH}`).set('Cookie', await cookieFor(ROLES.ADMIN)).expect(200);
    assert.doesNotMatch(JSON.stringify(viewer.body), /SAFE-REF|upiReference|idempotency|payeeSnapshot|receiverMobile|recordedByRole|_id/);
    assert.equal(admin.body.data.items[0].upiReference, 'SAFE-REF');
  });

  test('bill increases derive partial and bill decreases derive overpaid without rewriting payment', async () => {
    const recorded = await record(ROLES.ADMIN, { amountPaise: 200_000 });
    assert.equal((await summaryService.getSummary(MONTH)).members.nikhil.status, 'paid');
    reports.setBill('nikhil', 206_000);
    let summary = await summaryService.getSummary(MONTH);
    assert.equal(summary.members.nikhil.status, 'partial');
    assert.equal(summary.members.nikhil.remainingAmountPaise, 6_000);
    reports.setBill('nikhil', 194_000);
    summary = await summaryService.getSummary(MONTH);
    assert.equal(summary.members.nikhil.status, 'overpaid');
    assert.equal(summary.members.nikhil.overpaidAmountPaise, 6_000);
    const stored = await paymentRepository.findByPaymentId(recorded.body.data.paymentId);
    assert.equal(stored.amountPaise, 200_000);
    assert.equal(stored.billAmountAtPaymentPaise, 200_000);
  });

  test('Viewer and Admin cannot void; Super Admin must provide a reason', async () => {
    const recorded = await record();
    const path = `/api/payments/${recorded.body.data.paymentId}/void`;
    assert.equal((await authenticatedMutation('post', path, null, { reason: 'Mistake' })).status, 401);
    assert.equal((await authenticatedMutation('post', path, ROLES.ADMIN, { reason: 'Mistake' })).status, 403);
    assert.equal((await authenticatedMutation('post', path, ROLES.SUPERADMIN, { reason: '' })).status, 400);
  });

  test('real void emits once, replay is a no-op, history remains, and total paid falls', async () => {
    const recorded = await record(ROLES.ADMIN, { amountPaise: 50_000 });
    paymentEvents.length = 0;
    const path = `/api/payments/${recorded.body.data.paymentId}/void`;
    const first = await authenticatedMutation('post', path, ROLES.SUPERADMIN, { reason: 'Marked paid by mistake' });
    const replay = await authenticatedMutation('post', path, ROLES.SUPERADMIN, { reason: 'Again' });
    assert.equal(first.body.changed, true);
    assert.equal(replay.body.changed, false);
    assert.equal(paymentEvents.length, 1);
    assert.deepEqual(Object.keys(paymentEvents[0]).sort(), ['action', 'memberId', 'month', 'paymentId', 'updatedAt'].sort());
    assert.equal((await summaryService.getSummary(MONTH)).members.nikhil.paidAmountPaise, 0);
    assert.equal((await paymentService.getHistory(MONTH)).items[0].voidReason, 'Marked paid by mistake');
  });

  test('unknown payment returns a clean 404', async () => {
    const response = await authenticatedMutation('post', `/api/payments/${randomUUID()}/void`, ROLES.SUPERADMIN, { reason: 'No such payment' });
    assert.equal(response.status, 404);
    assert.equal(response.body.message, 'Payment not found.');
  });
});
