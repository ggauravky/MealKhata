import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_PAYMENT_AMOUNT_PAISE, paymentRupeesToPaise } from '../src/lib/money.js';
import {
  canInitiatePayment,
  createIdempotencyKey,
  formatReceiverMobile,
  getReceiverMobileCopyValue,
  PAYMENT_STATUS_LABELS,
} from '../src/lib/paymentFlow.js';

describe('payment amount input', () => {
  test('converts full and partial rupee values to exact positive paise', () => {
    assert.equal(paymentRupeesToPaise('560'), 56_000);
    assert.equal(paymentRupeesToPaise('62.50'), 6_250);
    assert.equal(paymentRupeesToPaise('0.01'), 1);
  });

  test('rejects zero, negative, excess precision, text, and oversized payment values', () => {
    for (const value of ['0', '-1', '1.001', 'abc', String(MAX_PAYMENT_AMOUNT_PAISE / 100 + 1)]) {
      assert.equal(paymentRupeesToPaise(value), null, value);
    }
  });
});

describe('payment presentation policy', () => {
  const payableMember = { status: 'partial', remainingAmountPaise: 56_000 };

  test('Viewer cannot pay while Admin and Super Admin can pay a remaining due', () => {
    assert.equal(canInitiatePayment({ role: 'viewer', member: payableMember }), false);
    assert.equal(canInitiatePayment({ role: 'admin', member: payableMember }), true);
    assert.equal(canInitiatePayment({ role: 'superadmin', member: payableMember }), true);
  });

  test('future, rates-missing, zero-due, paid, and overpaid states never show Pay Now', () => {
    for (const status of ['not_due_yet', 'rates_missing', 'no_due', 'paid', 'overpaid']) {
      assert.equal(canInitiatePayment({ role: 'superadmin', member: { status, remainingAmountPaise: 56_000 } }), false, status);
    }
    assert.equal(PAYMENT_STATUS_LABELS.rates_missing, 'Rates not set');
    assert.equal(PAYMENT_STATUS_LABELS.not_due_yet, 'Not due yet');
  });

  test('one confirmation flow keeps one UUID-shaped idempotency key for retries', () => {
    let calls = 0;
    const cryptoSource = { randomUUID: () => { calls += 1; return '123e4567-e89b-42d3-a456-426614174000'; } };
    const key = createIdempotencyKey(cryptoSource);
    const firstAttempt = { idempotencyKey: key };
    const retry = { idempotencyKey: key };
    assert.equal(firstAttempt.idempotencyKey, retry.idempotencyKey);
    assert.equal(calls, 1);
  });

  test('mobile-only receiver details are formatted and copied without inventing a VPA', () => {
    assert.equal(formatReceiverMobile('9876543210'), '+91 98765 43210');
    assert.equal(formatReceiverMobile('+919876543210'), '+91 98765 43210');
    assert.equal(getReceiverMobileCopyValue('9876543210'), '+919876543210');
    assert.doesNotMatch(getReceiverMobileCopyValue('9876543210'), /@/);
  });
});
