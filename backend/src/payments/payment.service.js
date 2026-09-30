import { randomUUID } from 'node:crypto';
import { MEMBER_IDS } from '../config/members.js';
import { reportService } from '../reports/report.service.js';
import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalMonth } from '../utils/month.js';
import {
  isValidPaymentAmount,
  MAX_UPI_REFERENCE_LENGTH,
  MAX_VOID_REASON_LENGTH,
} from './payment.constants.js';
import { paymentRepository } from './payment.repository.js';
import { serializePayment } from './payment.serializer.js';
import { paymentSettingsService } from './paymentSettings.service.js';
import { paymentSummaryService } from './paymentSummary.service.js';

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });
}

export function paiseToUpiAmount(amountPaise) {
  if (!isValidPaymentAmount(amountPaise)) throw new TypeError('amountPaise must be positive integer paise');
  return `${Math.floor(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, '0')}`;
}

function monthLabel(month) {
  const [year, monthNumber] = month.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(monthNumber) - 1]} ${year}`;
}

function memberLabel(memberId) {
  return memberId[0].toUpperCase() + memberId.slice(1);
}

export function buildUpiIntent({ month, memberId, amountPaise, settings }) {
  const note = `MealKhata ${monthLabel(month)} - ${memberLabel(memberId)}`;
  if (!settings.upiId) {
    return { note, upiUri: null };
  }

  const query = new URLSearchParams({
    pa: settings.upiId,
    pn: settings.receiverName,
    am: paiseToUpiAmount(amountPaise),
    cu: 'INR',
    tn: note,
  });

  return { note, upiUri: `upi://pay?${query.toString()}` };
}

export function normalizeUpiReference(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length <= MAX_UPI_REFERENCE_LENGTH && !containsControlCharacter(normalized)
    ? normalized
    : undefined;
}

export function normalizeVoidReason(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized && normalized.length <= MAX_VOID_REASON_LENGTH && !containsControlCharacter(normalized)
    ? normalized
    : null;
}

function assertMember(memberId) {
  if (!MEMBER_IDS.includes(memberId)) throw new HttpError(400, 'Invalid member.');
}

function assertMonth(month) {
  if (!isValidLogicalMonth(month)) throw new HttpError(400, 'Month must be a valid calendar month in YYYY-MM format.');
}

function assertAmount(amountPaise) {
  if (!isValidPaymentAmount(amountPaise)) {
    throw new HttpError(400, 'Payment amount must be positive whole paise within the allowed limit.');
  }
}

function assertSettings(settings) {
  if (!settings.configured) {
    throw new HttpError(409, 'Payment receiver settings are not configured.');
  }
}

function assertReportPayable(report, memberId) {
  if (report.periodType === 'future') throw new HttpError(409, 'Future months are not payable yet.');
  if (!report.rates.configured) throw new HttpError(409, 'Meal rates are not set for this month.');
  const billAmountPaise = report.toDate.members[memberId].amountPaise;
  if (billAmountPaise === 0) throw new HttpError(409, 'There is no payment due for this member.');
  return billAmountPaise;
}

function sameIdempotentRequest(payment, input) {
  return payment.month === input.month && payment.memberId === input.memberId && payment.amountPaise === input.amountPaise;
}

export function createPaymentService({
  repository = paymentRepository,
  reports = reportService,
  summaries = paymentSummaryService,
  settings = paymentSettingsService,
  settlements = null,
  now = () => new Date(),
  uuid = randomUUID,
} = {}) {
  return Object.freeze({
    async getHistory(month, { includeReference = false } = {}) {
      assertMonth(month);
      try {
        const items = await repository.findHistoryByMonth(month);
        return { month, items: items.map((item) => serializePayment(item, { includeReference })) };
      } catch (error) {
        throw new HttpError(503, 'Payment history is temporarily unavailable.', { cause: error });
      }
    },

    async getPayment(paymentId) {
      return repository.findByPaymentId(paymentId);
    },

    async preparePayment({ month, memberId }) {
      assertMonth(month);
      assertMember(memberId);

      if (settlements && (await settlements.isMonthClosed(month))) {
        throw new HttpError(409, 'This month is closed. Reopen the month before making financial changes.');
      }

      const [summary, receiver] = await Promise.all([summaries.getSummary(month), settings.getSettings()]);
      assertSettings(receiver);
      const member = summary.members[memberId];
      if (summary.periodType === 'future') throw new HttpError(409, 'Future months are not payable yet.');
      if (!summary.ratesConfigured) throw new HttpError(409, 'Meal rates are not set for this month.');
      if (member.status === 'no_due' || member.remainingAmountPaise === 0) {
        throw new HttpError(409, 'There is no remaining payment due for this member.');
      }
      const amountPaise = member.remainingAmountPaise;

      const intent = buildUpiIntent({ month, memberId, amountPaise, settings: receiver });
      return {
        month,
        memberId,
        amountPaise,
        payee: {
          name: receiver.receiverName,
          upiId: receiver.upiId ?? null,
          mobile: receiver.receiverMobile,
        },
        ...intent,
      };
    },

    async recordPayment({ month, memberId, amountPaise, idempotencyKey, upiReference, actorRole, actorMemberId = null }) {
      assertMonth(month);
      assertMember(memberId);
      assertAmount(amountPaise);

      if (settlements && (await settlements.isMonthClosed(month))) {
        throw new HttpError(409, 'This month is closed. Reopen the month before recording payments.');
      }

      try {
        const existing = await repository.findByIdempotencyKey(idempotencyKey);
        if (existing) {
          if (!sameIdempotentRequest(existing, { month, memberId, amountPaise })) {
            throw new HttpError(409, 'This idempotency key was already used for a different payment.');
          }
          return { created: false, data: serializePayment(existing, { includeReference: true }) };
        }

        const [report, receiver] = await Promise.all([
          reports.getMonthlyReport(month),
          settings.getSettings(),
        ]);
        assertSettings(receiver);
        const billAmountAtPaymentPaise = assertReportPayable(report, memberId);
        const recordedAt = now();
        const payment = {
          paymentId: uuid(),
          month,
          memberId,
          amountPaise,
          method: 'upi',
          upiReference,
          billAmountAtPaymentPaise,
          periodTypeAtPayment: report.periodType,
          payeeSnapshot: {
            receiverName: receiver.receiverName,
            upiId: receiver.upiId ?? null,
            receiverMobile: receiver.receiverMobile,
          },
          recordedAt,
          recordedByRole: actorRole,
          recordedByMemberId: actorMemberId ?? null,
          idempotencyKey,
          status: 'recorded',
          voidedAt: null,
          voidedByRole: null,
          voidReason: null,
        };

        try {
          const created = await repository.create(payment);
          return { created: true, data: serializePayment(created, { includeReference: true }) };
        } catch (error) {
          if (error?.code !== 11000) throw error;
          const raced = await repository.findByIdempotencyKey(idempotencyKey);
          if (!raced || !sameIdempotentRequest(raced, { month, memberId, amountPaise })) {
            throw new HttpError(409, 'This idempotency key cannot be used for this payment.');
          }
          return { created: false, data: serializePayment(raced, { includeReference: true }) };
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'Unable to record the payment. Please try again.', { cause: error });
      }
    },

    async voidPayment({ paymentId, reason, actorRole }) {
      try {
        const current = await repository.findByPaymentId(paymentId);
        if (!current) throw new HttpError(404, 'Payment not found.');

        if (settlements && (await settlements.isMonthClosed(current.month))) {
          throw new HttpError(409, 'This month is closed. Reopen the month before voiding payments.');
        }

        if (current.status === 'voided') {
          return { changed: false, data: serializePayment(current, { includeReference: true }) };
        }

        const updated = await repository.voidIfRecorded({
          paymentId,
          voidedAt: now(),
          voidedByRole: actorRole,
          voidReason: reason,
        });
        if (updated) return { changed: true, data: serializePayment(updated, { includeReference: true }) };

        const raced = await repository.findByPaymentId(paymentId);
        if (!raced) throw new HttpError(404, 'Payment not found.');
        return { changed: false, data: serializePayment(raced, { includeReference: true }) };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'Unable to void the payment. Please try again.', { cause: error });
      }
    },
  });
}

export const paymentService = createPaymentService();
