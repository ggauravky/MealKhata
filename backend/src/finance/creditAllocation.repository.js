import { randomUUID } from 'node:crypto';
import { runFinancialTransaction } from './financialTransaction.js';
import { CreditAllocation, UnallocatedCredit } from '../stays/paymentReclassification.model.js';
import { CreditObligationState } from './creditObligationState.model.js';
import { RoomCharge } from '../roomFees/roomCharge.model.js';
import { RoomPayment } from '../roomFees/roomPayment.model.js';
import { RoomPaymentSettings } from '../roomFees/roomPaymentSettings.model.js';
import { Expense } from '../expenses/expense.model.js';
import { ExpenseReimbursement } from '../expenses/expenseReimbursement.model.js';
import { Payment } from '../payments/payment.model.js';
import { PaymentSettings } from '../payments/paymentSettings.model.js';

function domainError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = { code, ...details };
  return error;
}

function plain(document) {
  return document?.toObject ? document.toObject() : document;
}

function finalRoomChargeAmount(charge) {
  return Math.max(0, charge.baseAmountPaise + (charge.adjustments || [])
    .reduce((sum, adjustment) => sum + adjustment.amountPaise, 0));
}

async function readTargetSnapshot({ destinationType, targetRecordId, memberId, session = null, messSnapshot = null }) {
  if (destinationType === 'ROOM_FEE') {
    const charge = await RoomCharge.findOne({ chargeId: targetRecordId }).session(session).lean();
    if (!charge || charge.status === 'cancelled') {
      throw domainError(404, 'Target Room Fee obligation was not found or is cancelled.', 'TARGET_OBLIGATION_NOT_FOUND');
    }
    if (charge.memberId !== memberId) {
      throw domainError(409, 'Target Room Fee obligation belongs to a different member.', 'TARGET_MEMBER_MISMATCH');
    }
    const payments = await RoomPayment.find({ chargeId: charge.chargeId, status: 'verified' }).session(session).lean();
    const paidAmountPaise = payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
    const billAmountPaise = finalRoomChargeAmount(charge);
    return {
      destinationType,
      targetRecordId,
      memberId,
      billAmountPaise,
      paidAmountPaise,
      outstandingAmountPaise: Math.max(0, billAmountPaise - paidAmountPaise),
      targetRevision: charge.__v || 0,
      month: charge.month,
      charge,
    };
  }

  if (destinationType === 'EXPENSE_REIMBURSEMENT') {
    const expense = await Expense.findOne({ expenseId: targetRecordId }).session(session).lean();
    if (!expense || expense.status === 'voided') {
      throw domainError(404, 'Target shared Expense obligation was not found or is voided.', 'TARGET_OBLIGATION_NOT_FOUND');
    }
    const allocation = (expense.allocations || []).find((item) => item.memberId === memberId);
    if (!allocation || expense.paidByMemberId === memberId) {
      throw domainError(409, 'Target shared Expense is not payable by this member.', 'TARGET_MEMBER_MISMATCH');
    }
    const payments = await ExpenseReimbursement.find({
      expenseId: expense.expenseId,
      fromMemberId: memberId,
      status: 'recorded',
    }).session(session).lean();
    const paidAmountPaise = payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
    return {
      destinationType,
      targetRecordId,
      memberId,
      billAmountPaise: allocation.amountPaise,
      paidAmountPaise,
      outstandingAmountPaise: Math.max(0, allocation.amountPaise - paidAmountPaise),
      targetRevision: expense.revision,
      month: expense.month,
      expense,
    };
  }

  if (destinationType === 'MESS') {
    if (!messSnapshot || messSnapshot.memberId !== memberId || messSnapshot.month !== targetRecordId) {
      throw domainError(409, 'A current verified Mess obligation snapshot is required.', 'TARGET_SNAPSHOT_REQUIRED');
    }
    const payments = await Payment.find({ month: targetRecordId, memberId, status: 'recorded' }).session(session).lean();
    const paidAmountPaise = payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
    if (paidAmountPaise !== messSnapshot.paidAmountPaise) {
      throw domainError(409, 'The Mess obligation changed after preview. Refresh and retry.', 'TARGET_OBLIGATION_STALE');
    }
    return {
      ...messSnapshot,
      destinationType,
      targetRecordId,
      memberId,
      outstandingAmountPaise: Math.max(0, messSnapshot.billAmountPaise - paidAmountPaise),
    };
  }

  if (destinationType === 'EXTERNAL_SETTLEMENT') {
    return {
      destinationType,
      targetRecordId,
      memberId,
      billAmountPaise: null,
      paidAmountPaise: null,
      outstandingAmountPaise: null,
      targetRevision: null,
    };
  }

  throw domainError(400, 'Unsupported credit allocation destination.', 'UNSUPPORTED_DESTINATION');
}

export const creditAllocationRepository = Object.freeze({
  requiresTransactions: true,

  async listCredits({ memberId = null, status = null } = {}) {
    const query = {};
    if (memberId) query.memberId = memberId;
    if (status) query.status = status;
    return UnallocatedCredit.find(query).sort({ paymentDate: -1, creditId: 1 }).lean();
  },

  async findCreditById(creditId, { session = null } = {}) {
    return UnallocatedCredit.findOne({ creditId }).session(session).lean();
  },

  async findAllocationByIdempotencyKey(idempotencyKey, { session = null } = {}) {
    return CreditAllocation.findOne({ idempotencyKey }).session(session).lean();
  },

  async listAllocationsByCreditId(creditId, { session = null } = {}) {
    return CreditAllocation.find({ creditId }).session(session).sort({ completedAt: 1 }).lean();
  },

  async getTargetSnapshot(params) {
    return readTargetSnapshot(params);
  },

  async executeAtomicAllocation({
    creditId,
    expectedRevision,
    destinationType,
    targetRecordId,
    amountPaise,
    reason,
    settlementReference,
    settledAt,
    idempotencyKey,
    requestFingerprint,
    actorRole,
    messSnapshot,
  }) {
    return runFinancialTransaction(async (session) => {
      const existing = await CreditAllocation.findOne({ idempotencyKey }).session(session).lean();
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw domainError(409, 'Idempotency key was reused with a different allocation payload.', 'IDEMPOTENCY_CONFLICT');
        }
        const credit = await UnallocatedCredit.findOne({ creditId: existing.creditId }).session(session).lean();
        return { allocation: existing, credit };
      }

      const credit = await UnallocatedCredit.findOne({ creditId }).session(session).lean();
      if (!credit) throw domainError(404, 'Unallocated credit not found.', 'CREDIT_NOT_FOUND');
      const currentRevision = credit.revision || 0;
      if (currentRevision !== expectedRevision) {
        throw domainError(409, 'Unallocated credit changed after preview. Refresh and retry.', 'CREDIT_REVISION_CONFLICT');
      }
      if (credit.status !== 'OPEN' || credit.remainingAmountPaise < amountPaise) {
        throw domainError(409, 'Allocation exceeds the remaining open credit.', 'CREDIT_BALANCE_EXCEEDED', {
          remainingAmountPaise: credit.remainingAmountPaise,
        });
      }

      const obligationKey = `${destinationType}:${credit.memberId}:${targetRecordId}`;
      if (destinationType !== 'EXTERNAL_SETTLEMENT') {
        await CreditObligationState.findOneAndUpdate(
          { obligationKey },
          { $inc: { revision: 1 }, $setOnInsert: { obligationKey } },
          { upsert: true, session, returnDocument: 'after' },
        );
      }

      const target = await readTargetSnapshot({
        destinationType,
        targetRecordId,
        memberId: credit.memberId,
        session,
        messSnapshot,
      });
      if (destinationType !== 'EXTERNAL_SETTLEMENT' && amountPaise > target.outstandingAmountPaise) {
        throw domainError(409, 'Allocation exceeds the verified target obligation.', 'TARGET_AMOUNT_EXCEEDED', {
          targetOutstandingPaise: target.outstandingAmountPaise,
        });
      }

      const creditAllocationId = randomUUID();
      let targetLedgerRecordId = null;
      if (destinationType === 'ROOM_FEE') {
        await RoomCharge.updateOne({ chargeId: targetRecordId }, { $inc: { __v: 1 } }, { session });
        const settings = await RoomPaymentSettings.findOneAndUpdate(
          { settingsId: 'singleton' },
          { $setOnInsert: { settingsId: 'singleton' } },
          { upsert: true, setDefaultsOnInsert: true, returnDocument: 'after', session },
        ).lean();
        targetLedgerRecordId = randomUUID();
        await RoomPayment.create([{
          roomPaymentId: targetLedgerRecordId,
          chargeId: targetRecordId,
          memberId: credit.memberId,
          month: target.month,
          amountPaise,
          method: 'other',
          reference: null,
          recipientSnapshot: {
            recipientMode: settings.recipientMode,
            recipientName: settings.recipientName,
            upiId: settings.upiId,
          },
          idempotencyKey: creditAllocationId,
          fundingSource: 'UNALLOCATED_CREDIT',
          sourceCreditAllocationId: creditAllocationId,
          status: 'verified',
          recordedAt: new Date(),
          recordedByRole: actorRole,
        }], { session });
      } else if (destinationType === 'EXPENSE_REIMBURSEMENT') {
        await Expense.updateOne(
          { expenseId: targetRecordId },
          { $set: { revision: randomUUID() } },
          { session },
        );
        targetLedgerRecordId = randomUUID();
        await ExpenseReimbursement.create([{
          reimbursementId: targetLedgerRecordId,
          expenseId: targetRecordId,
          expenseMonth: target.month,
          fromMemberId: credit.memberId,
          toMemberId: target.expense.paidByMemberId,
          amountPaise,
          method: 'other',
          reference: null,
          idempotencyKey: creditAllocationId,
          fundingSource: 'UNALLOCATED_CREDIT',
          sourceCreditAllocationId: creditAllocationId,
          status: 'recorded',
          recordedAt: new Date(),
          recordedByRole: actorRole,
        }], { session });
      } else if (destinationType === 'MESS') {
        const settings = await PaymentSettings.findOne({}).session(session).lean();
        if (!settings) throw domainError(409, 'Mess payment settings are not configured.', 'TARGET_SETTINGS_MISSING');
        targetLedgerRecordId = randomUUID();
        await Payment.create([{
          paymentId: targetLedgerRecordId,
          month: targetRecordId,
          memberId: credit.memberId,
          amountPaise,
          method: 'upi',
          upiReference: null,
          billAmountAtPaymentPaise: target.billAmountPaise,
          periodTypeAtPayment: messSnapshot.periodType || 'current',
          payeeSnapshot: {
            receiverName: settings.receiverName,
            upiId: settings.upiId,
            receiverMobile: settings.receiverMobile,
          },
          recordedAt: new Date(),
          recordedByRole: actorRole,
          recordedByMemberId: null,
          idempotencyKey: creditAllocationId,
          fundingSource: 'UNALLOCATED_CREDIT',
          sourceCreditAllocationId: creditAllocationId,
          status: 'recorded',
        }], { session });
      }

      const isSettlement = destinationType === 'EXTERNAL_SETTLEMENT';
      const updatedCredit = await UnallocatedCredit.findOneAndUpdate(
        {
          creditId,
          status: 'OPEN',
          revision: currentRevision,
          remainingAmountPaise: { $gte: amountPaise },
        },
        {
          $inc: {
            revision: 1,
            remainingAmountPaise: -amountPaise,
            ...(isSettlement ? { settledAmountPaise: amountPaise } : { allocatedAmountPaise: amountPaise }),
          },
          $set: {
            ...(credit.remainingAmountPaise === amountPaise ? { status: 'ALLOCATED' } : {}),
          },
          $push: {
            history: {
              event: isSettlement ? 'EXTERNAL_SETTLEMENT_RECORDED' : 'CREDIT_ALLOCATED',
              timestamp: new Date(),
              actorRole,
              note: reason,
              creditAllocationId,
              destinationType,
              targetRecordId,
              amountPaise,
            },
          },
        },
        { session, returnDocument: 'after', runValidators: true },
      ).lean();
      if (!updatedCredit) {
        throw domainError(409, 'Unallocated credit changed concurrently. Refresh and retry.', 'CREDIT_REVISION_CONFLICT');
      }

      const [allocation] = await CreditAllocation.create([{
        creditAllocationId,
        creditId,
        reclassificationId: credit.reclassificationId,
        sourceDepositTransactionId: credit.sourceDepositTransactionId,
        memberId: credit.memberId,
        destinationType,
        targetRecordId,
        targetLedgerRecordId,
        amountPaise,
        reason,
        settlementReference: settlementReference || null,
        settledAt: settledAt || null,
        idempotencyKey,
        requestFingerprint,
        status: 'COMPLETED',
        completedAt: new Date(),
        completedByRole: actorRole,
      }], { session });

      return { allocation: plain(allocation), credit: updatedCredit };
    }, { retryOnDuplicateKey: true });
  },
});
