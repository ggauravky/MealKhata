/**
 * MealKhata 2.0 - Hostel Stay, Deposit & Clearance Repository
 */

import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  HostelClearance,
  HostelDepositAccount,
  HostelDepositTransaction,
  HostelStay,
} from './stay.model.js';
import { CLEARANCE_VALIDITY_STATUSES, STAY_STATUSES } from './stay.constants.js';
import { guardFinancialMutation } from '../finance/financialMutationGuard.js';
import { runFinancialTransaction } from '../finance/financialTransaction.js';
import { CreditAllocation, PaymentReclassification, UnallocatedCredit } from './paymentReclassification.model.js';
import { RoomPayment } from '../roomFees/roomPayment.model.js';
import { Payment } from '../payments/payment.model.js';
import { ExpenseReimbursement } from '../expenses/expenseReimbursement.model.js';
import {
  claimExternalPaymentReference,
  normalizeExternalPaymentReference,
} from '../finance/paymentReference.service.js';

export const stayRepository = {
  requiresTransactions: true,

  // ----------------------------------------------------
  // Hostel Stay Operations
  // ----------------------------------------------------
  async createStay(data, { session } = {}) {
    if (session) {
      const res = await HostelStay.create([data], { session });
      return res[0].toObject();
    }
    const stay = await HostelStay.create(data);
    return stay.toObject();
  },

  async findStayById(stayId, { session } = {}) {
    const q = HostelStay.findOne({ stayId });
    if (session) q.session(session);
    return q.lean();
  },

  async findActiveStayForMember(memberId, { session } = {}) {
    const q = HostelStay.findOne({
      memberId,
      status: {
        $in: [
          STAY_STATUSES.ACTIVE,
          STAY_STATUSES.CHECKOUT_REQUESTED,
          STAY_STATUSES.CHECKOUT_PENDING,
        ],
      },
    });
    if (session) q.session(session);
    return q.lean();
  },

  async findStaysByMember(memberId, { session } = {}) {
    const q = HostelStay.find({ memberId }).sort({ joinedOn: -1 });
    if (session) q.session(session);
    return q.lean();
  },

  async listAllStays({ status = null, memberId = null } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (memberId) filter.memberId = memberId;
    return HostelStay.find(filter).sort({ joinedOn: -1 }).lean();
  },

  async updateStay(stayId, updates, expectedRevision = null, { session } = {}) {
    const query = { stayId };
    if (typeof expectedRevision === 'number') {
      query.revision = expectedRevision;
    }

    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;

    const doc = await HostelStay.findOneAndUpdate(
      query,
      {
        $set: updates,
        $inc: { revision: 1 },
      },
      options,
    ).lean();

    return doc;
  },

  async addStayHistory(stayId, entry, { session } = {}) {
    const options = { returnDocument: 'after' };
    if (session) options.session = session;
    return HostelStay.findOneAndUpdate(
      { stayId },
      { $push: { history: entry } },
      options,
    ).lean();
  },

  async openClearanceReview(stayId, { reason, actorRole, openedAt }, { session } = {}) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return HostelStay.findOneAndUpdate(
      {
        stayId,
        status: STAY_STATUSES.CHECKED_OUT,
        clearanceReviewOpenedAt: null,
      },
      {
        $set: {
          clearanceReviewOpenedAt: openedAt,
          clearanceReviewOpenedByRole: actorRole,
          clearanceReviewReason: reason,
        },
        $inc: { revision: 1, financialRevision: 1 },
        $push: {
          history: {
            event: 'CLEARANCE_REVIEW_OPENED',
            timestamp: openedAt,
            actorRole,
            note: reason,
            details: { reason },
          },
        },
      },
      options,
    ).lean();
  },

  async closeClearanceReview(
    stayId,
    { clearanceId, sequence, actorRole, reason, closedAt },
    { session } = {},
  ) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return HostelStay.findOneAndUpdate(
      { stayId, status: STAY_STATUSES.CHECKED_OUT },
      {
        $set: {
          clearanceReviewOpenedAt: null,
          clearanceReviewOpenedByRole: null,
          clearanceReviewReason: null,
        },
        $inc: { revision: 1 },
        $push: {
          history: {
            event: 'CLEARANCE_REVIEW_CLOSED',
            timestamp: closedAt,
            actorRole,
            note: reason,
            details: { clearanceId, sequence },
          },
        },
      },
      options,
    ).lean();
  },

  async cancelStay(stayId, { reason, actorRole, expectedRevision, cancelledAt }, { session } = {}) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return HostelStay.findOneAndUpdate(
      { stayId, revision: expectedRevision },
      {
        $set: {
          status: STAY_STATUSES.CANCELLED,
          currentRoomId: null,
          cancelledAt,
          cancelledByRole: actorRole,
          cancelReason: reason,
        },
        $push: {
          history: {
            event: 'STAY_CANCELLED',
            timestamp: cancelledAt,
            actorRole,
            note: reason,
            details: { expectedRevision },
          },
        },
        $inc: { revision: 1 },
      },
      options,
    ).lean();
  },

  async reconcileHistoricalStay(
    stayId,
    {
      supersededByStayId,
      reconciliationId,
      reason,
      actorRole,
      expectedRevision,
      reconciledAt,
      revokedClearanceIds,
      confirmationProvided,
      affectedMonths,
      attributionWarnings,
      affectedFinancialDomains,
      beforeState,
      afterState,
      obligationMappings,
    },
    { session } = {},
  ) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return HostelStay.findOneAndUpdate(
      { stayId, status: STAY_STATUSES.CHECKED_OUT, revision: expectedRevision },
      {
        $set: {
          status: STAY_STATUSES.SUPERSEDED,
          supersededByStayId,
          reconciliationId,
          reconciledAt,
          reconciledByRole: actorRole,
          reconciliationReason: reason,
        },
        $push: {
          history: {
            event: 'HISTORICAL_STAY_RECONCILED',
            timestamp: reconciledAt,
            actorRole,
            note: reason,
            details: {
              previousStatus: STAY_STATUSES.CHECKED_OUT,
              supersededByStayId,
              reconciliationId,
              revokedClearanceIds,
              historicalStayId: stayId,
              replacementStayId: supersededByStayId,
              confirmationProvided,
              affectedMonths,
              attributionWarnings,
              affectedFinancialDomains,
              beforeState,
              afterState,
              obligationMappings,
            },
          },
        },
        $inc: { revision: 1 },
      },
      options,
    ).lean();
  },

  async lockHistoricalReplacementStay(
    stayId,
    {
      memberId,
      expectedRevision,
      historicalStayId,
      reconciliationId,
      reason,
      actorRole,
      reconciledAt,
    },
    { session } = {},
  ) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return HostelStay.findOneAndUpdate(
      {
        stayId,
        memberId,
        status: STAY_STATUSES.ACTIVE,
        revision: expectedRevision,
      },
      {
        $inc: { revision: 1 },
        $push: {
          history: {
            event: 'HISTORICAL_STAY_LINKED',
            timestamp: reconciledAt,
            actorRole,
            note: reason,
            details: { historicalStayId, reconciliationId },
          },
        },
      },
      options,
    ).lean();
  },

  async restoreStay(
    stayId,
    {
      joinedOn,
      roomId,
      assignmentId,
      reason,
      actorRole,
      expectedRevision,
      restoredAt,
      restorationId,
      previousActualLeftOn,
      previousCheckoutFinalizedAt,
      revokedClearanceIds,
    },
    { session } = {},
  ) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return HostelStay.findOneAndUpdate(
      {
        stayId,
        status: STAY_STATUSES.CHECKED_OUT,
        revision: expectedRevision,
      },
      {
        $set: {
          status: STAY_STATUSES.ACTIVE,
          joinedOn,
          currentRoomId: roomId,
          currentAssignmentId: assignmentId,
          actualLeftOn: null,
          checkoutRequestedAt: null,
          checkoutRequestedFor: null,
          checkoutRequestNote: null,
          checkoutFinalizedAt: null,
          checkoutFinalizedByRole: null,
        },
        $inc: { revision: 1, financialRevision: 1 },
        $push: {
          history: {
            event: 'RESIDENT_RESTORED',
            timestamp: restoredAt,
            actorRole,
            note: reason,
            details: {
              restorationId,
              previousStatus: STAY_STATUSES.CHECKED_OUT,
              previousActualLeftOn,
              previousCheckoutFinalizedAt,
              joinedOn,
              roomId,
              revokedClearanceIds,
            },
          },
        },
      },
      options,
    ).lean();
  },

  async deleteStay(stayId) {
    return HostelStay.findOneAndDelete({ stayId }).lean();
  },

  // ----------------------------------------------------
  // Security Deposit Account Operations
  // ----------------------------------------------------
  async createDepositAccount(data, { session } = {}) {
    if (session) {
      const res = await HostelDepositAccount.create([data], { session });
      return res[0].toObject();
    }
    const account = await HostelDepositAccount.create(data);
    return account.toObject();
  },

  async deleteDepositAccount(depositAccountId) {
    return HostelDepositAccount.findOneAndDelete({ depositAccountId }).lean();
  },

  async findDepositAccountByStayId(stayId, { session } = {}) {
    const q = HostelDepositAccount.findOne({ stayId });
    if (session) q.session(session);
    return q.lean();
  },

  async findDepositAccountById(depositAccountId, { session } = {}) {
    const q = HostelDepositAccount.findOne({ depositAccountId });
    if (session) q.session(session);
    return q.lean();
  },

  async updateDepositAccount(depositAccountId, updates, expectedRevision = null, { session } = {}) {
    const query = { depositAccountId };
    if (typeof expectedRevision === 'number') {
      query.revision = expectedRevision;
    }

    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;

    return HostelDepositAccount.findOneAndUpdate(
      query,
      {
        $set: updates,
        $inc: { revision: 1 },
      },
      options,
    ).lean();
  },

  async executeAtomicDepositConfiguration({
    stayId,
    required,
    expectedDepositPaise,
    expectedRevision,
    reason,
    actorRole,
  }) {
    return runFinancialTransaction(async (session) => {
      const account = await HostelDepositAccount.findOne({ stayId }).session(session);
      if (!account) {
        const error = new Error('Deposit account not found for this stay.');
        error.statusCode = 404;
        throw error;
      }
      if (account.revision !== expectedRevision) {
        const error = new Error('Deposit account changed while the requirement was being updated. Refresh and retry.');
        error.statusCode = 409;
        error.details = { code: 'DEPOSIT_REVISION_CONFLICT' };
        throw error;
      }

      await guardFinancialMutation({ stayId, actorRole, session });

      const transactions = await HostelDepositTransaction.find({
        stayId,
        status: 'recorded',
      }).session(session);
      if (!required && transactions.length > 0) {
        const error = new Error('Recorded deposit transactions must be reconciled before marking the deposit not required.');
        error.statusCode = 409;
        error.details = {
          code: 'DEPOSIT_HISTORY_REQUIRES_RECONCILIATION',
          transactionCount: transactions.length,
        };
        throw error;
      }

      const previousExpectedDepositPaise = account.expectedDepositPaise;
      account.expectedDepositPaise = required ? expectedDepositPaise : 0;
      account.status = required ? 'OPEN' : 'NOT_REQUIRED';
      account.revision += 1;
      account.history.push({
        event: required ? 'DEPOSIT_REQUIREMENT_CONFIGURED' : 'DEPOSIT_MARKED_NOT_REQUIRED',
        timestamp: new Date(),
        actorRole,
        note: reason,
        details: {
          required,
          previousExpectedDepositPaise,
          expectedDepositPaise: required ? expectedDepositPaise : 0,
        },
      });
      await account.save({ session });
      return account.toObject();
    });
  },

  async addDepositAccountHistory(depositAccountId, entry, { session } = {}) {
    const options = { returnDocument: 'after' };
    if (session) options.session = session;
    return HostelDepositAccount.findOneAndUpdate(
      { depositAccountId },
      { $push: { history: entry } },
      options,
    ).lean();
  },

  // ----------------------------------------------------
  // Security Deposit Transaction Operations
  // ----------------------------------------------------
  async createDepositTransaction(data, { session } = {}) {
    if (session) {
      const res = await HostelDepositTransaction.create([data], { session });
      return res[0].toObject();
    }
    const tx = await HostelDepositTransaction.create(data);
    return tx.toObject();
  },

  async findDepositTransactionById(depositTransactionId, { session } = {}) {
    const q = HostelDepositTransaction.findOne({ depositTransactionId });
    if (session) q.session(session);
    return q.lean();
  },

  async findDepositTransactionByIdempotencyKey(idempotencyKey, { session } = {}) {
    const q = HostelDepositTransaction.findOne({ idempotencyKey });
    if (session) q.session(session);
    return q.lean();
  },

  async listDepositTransactionsByStayId(stayId, { includeVoided = false, session = null } = {}) {
    const filter = { stayId };
    if (!includeVoided) filter.status = 'recorded';
    const q = HostelDepositTransaction.find(filter).sort({ recordedAt: -1 });
    if (session) q.session(session);
    return q.lean();
  },

  async findPaymentReclassificationByIdempotencyKey(idempotencyKey, { session } = {}) {
    const q = PaymentReclassification.findOne({ idempotencyKey });
    if (session) q.session(session);
    return q.lean();
  },

  async findPaymentReclassificationBySource(sourceDepositTransactionId, { session } = {}) {
    const q = PaymentReclassification.findOne({ sourceDepositTransactionId });
    if (session) q.session(session);
    return q.lean();
  },

  async listPaymentReclassificationsByStayId(stayId, { session = null } = {}) {
    const q = PaymentReclassification.find({ sourceStayId: stayId }).sort({ completedAt: -1 });
    if (session) q.session(session);
    return q.lean();
  },

  async listUnallocatedCreditsByStayId(stayId, { session = null } = {}) {
    const journalsQuery = PaymentReclassification.find({ sourceStayId: stayId }).select({ reclassificationId: 1 });
    if (session) journalsQuery.session(session);
    const journals = await journalsQuery.lean();
    if (journals.length === 0) return [];
    const q = UnallocatedCredit.find({
      reclassificationId: { $in: journals.map((journal) => journal.reclassificationId) },
    }).sort({ createdAt: -1 });
    if (session) q.session(session);
    return q.lean();
  },

  async listUnallocatedCreditsByReclassificationId(reclassificationId, { session = null } = {}) {
    const q = UnallocatedCredit.find({ reclassificationId }).sort({ creditId: 1 });
    if (session) q.session(session);
    return q.lean();
  },

  async listCreditAllocationsByCreditIds(creditIds, { session = null } = {}) {
    if (!Array.isArray(creditIds) || creditIds.length === 0) return [];
    const q = CreditAllocation.find({ creditId: { $in: creditIds } }).sort({ completedAt: 1 });
    if (session) q.session(session);
    return q.lean();
  },

  async findDuplicatePaymentReference({ reference, sourceDepositTransactionId }, { session } = {}) {
    const normalizedReference = normalizeExternalPaymentReference(reference);
    if (!normalizedReference) return null;
    const exactReference = new RegExp(
      `^${normalizedReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}$`,
      'i',
    );
    const queryOptions = session ? { session } : {};
    const deposit = await HostelDepositTransaction.findOne({
      depositTransactionId: { $ne: sourceDepositTransactionId },
      reference: exactReference,
      status: { $in: ['recorded', 'reclassified'] },
    }, null, queryOptions).lean();
    if (deposit) return { collection: 'hostel_deposit_transactions', documentId: deposit.depositTransactionId };
    const room = await RoomPayment.findOne({ reference: exactReference, status: 'verified' }, null, queryOptions).lean();
    if (room) return { collection: 'room_payments', documentId: room.roomPaymentId };
    const mess = await Payment.findOne({ upiReference: exactReference, status: 'recorded' }, null, queryOptions).lean();
    if (mess) return { collection: 'payments', documentId: mess.paymentId };
    const reimbursement = await ExpenseReimbursement.findOne({
      reference: exactReference,
      status: 'recorded',
    }, null, queryOptions).lean();
    if (reimbursement) {
      return { collection: 'expense_reimbursements', documentId: reimbursement.reimbursementId };
    }
    const credit = await UnallocatedCredit.findOne({ reference: exactReference }, null, queryOptions).lean();
    if (credit) return { collection: 'unallocated_credits', documentId: credit.creditId };
    return null;
  },

  async executeAtomicPaymentReclassification({
    stayId,
    sourceDepositTransactionId,
    expectedAccountRevision,
    allocations,
    reason,
    idempotencyKey,
    requestFingerprint,
    actorRole,
  }) {
    try {
      return await runFinancialTransaction(async (session) => {
        const existing = await PaymentReclassification.findOne({ idempotencyKey }).session(session);
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) {
            const error = new Error('Reclassification idempotency key was reused with a different payload.');
            error.statusCode = 409;
            throw error;
          }
          const credits = await UnallocatedCredit.find({
            reclassificationId: existing.reclassificationId,
          }).session(session).lean();
          return { reclassificationId: existing.reclassificationId, journal: existing.toObject(), credits };
        }

        const source = await HostelDepositTransaction.findOne({ depositTransactionId: sourceDepositTransactionId }).session(session);
        if (!source || source.stayId !== stayId) {
          const error = new Error('Source deposit receipt was not found for this Stay.');
          error.statusCode = 404;
          throw error;
        }
        if (source.status !== 'recorded' || source.type !== 'RECEIVED') {
          const error = new Error('Source receipt is not an active deposit receipt or was already reconciled.');
          error.statusCode = 409;
          error.details = { code: 'SOURCE_RECEIPT_NOT_ACTIVE' };
          throw error;
        }

        const account = await HostelDepositAccount.findOne({ depositAccountId: source.depositAccountId }).session(session);
        if (!account || account.stayId !== stayId || account.revision !== expectedAccountRevision) {
          const error = new Error('Deposit account changed after preview. Refresh and retry.');
          error.statusCode = 409;
          error.details = { code: 'DEPOSIT_REVISION_CONFLICT' };
          throw error;
        }
        await guardFinancialMutation({ stayId, actorRole, session });

        if (!Array.isArray(allocations) || allocations.length === 0) {
          const error = new Error('At least one exact allocation is required.');
          error.statusCode = 400;
          error.details = { code: 'INVALID_ALLOCATIONS' };
          throw error;
        }
        let allocatedAmountPaise = 0;
        for (const allocation of allocations) {
          if (allocation?.category !== 'UNALLOCATED_CREDIT') {
            const error = new Error('The requested destination category is not supported.');
            error.statusCode = 409;
            error.details = { code: 'UNSUPPORTED_DESTINATION', category: allocation?.category || null };
            throw error;
          }
          if (allocation.memberId !== source.memberId) {
            const error = new Error('Allocation member must match the transactionally loaded source receipt.');
            error.statusCode = 409;
            error.details = { code: 'MEMBER_MISMATCH' };
            throw error;
          }
          if (typeof allocation.targetAccount !== 'string' || !allocation.targetAccount.trim() || allocation.targetAccount.trim().length > 120) {
            const error = new Error('A recognized target account label is required.');
            error.statusCode = 400;
            error.details = { code: 'TARGET_ACCOUNT_REQUIRED' };
            throw error;
          }
          if (!Number.isSafeInteger(allocation.amountPaise) || allocation.amountPaise <= 0) {
            const error = new Error('Every allocation must be positive integer paise.');
            error.statusCode = 400;
            error.details = { code: 'INVALID_ALLOCATION_AMOUNT' };
            throw error;
          }
          allocatedAmountPaise += allocation.amountPaise;
          if (!Number.isSafeInteger(allocatedAmountPaise)) {
            const error = new Error('Allocation total exceeds the supported money range.');
            error.statusCode = 400;
            error.details = { code: 'INVALID_ALLOCATION_AMOUNT' };
            throw error;
          }
        }
        if (allocatedAmountPaise !== source.amountPaise) {
          const error = new Error('Allocations must equal the transactionally loaded source receipt exactly.');
          error.statusCode = 409;
          error.details = {
            code: 'MONEY_CONSERVATION_FAILED',
            sourceAmountPaise: source.amountPaise,
            allocatedAmountPaise,
          };
          throw error;
        }

        const activeTransactions = await HostelDepositTransaction.find({ stayId, status: 'recorded' }).session(session);
        const totals = activeTransactions.reduce((sum, transaction) => {
          if (transaction.type === 'RECEIVED') sum.received += transaction.amountPaise;
          if (transaction.type === 'REFUNDED') sum.refunded += transaction.amountPaise;
          if (transaction.type === 'DEDUCTED') sum.deducted += transaction.amountPaise;
          return sum;
        }, { received: 0, refunded: 0, deducted: 0 });
        const heldPaise = totals.received - totals.refunded - totals.deducted;
        if (totals.refunded > 0 || totals.deducted > 0 || heldPaise < source.amountPaise) {
          const error = new Error('The deposit ledger contains a refund or deduction, so this receipt cannot be safely isolated for reclassification.');
          error.statusCode = 409;
          error.details = { code: 'SOURCE_FUNDS_ALREADY_DISPOSED', heldPaise, sourceAmountPaise: source.amountPaise };
          throw error;
        }

        await claimExternalPaymentReference({
          reference: source.reference,
          ledger: 'HOSTEL_DEPOSIT',
          documentId: source.depositTransactionId,
          memberId: source.memberId,
          session,
        });
        const duplicate = await this.findDuplicatePaymentReference({
          reference: source.reference,
          memberId: source.memberId,
          sourceDepositTransactionId,
        }, { session });
        if (duplicate) {
          const error = new Error('The source payment reference already exists in another active ledger.');
          error.statusCode = 409;
          error.details = { code: 'DUPLICATE_PAYMENT_REFERENCE', duplicate };
          throw error;
        }

        const reclassificationId = randomUUID();
        const completedAt = new Date();
        const destinationAllocations = allocations.map((allocation) => {
          const allocationId = randomUUID();
          return {
            ...allocation,
            allocationId,
            destinationRecordId: randomUUID(),
          };
        });
        const [journal] = await PaymentReclassification.create([{
          reclassificationId,
          sourceDepositTransactionId,
          sourceDepositAccountId: source.depositAccountId,
          sourceStayId: stayId,
          memberId: source.memberId,
          amountPaise: source.amountPaise,
          paymentDate: source.recordedAt,
          paymentMethod: source.method,
          reference: source.reference || null,
          allocations: destinationAllocations,
          reason,
          idempotencyKey,
          requestFingerprint,
          completedAt,
          completedByRole: actorRole,
        }], { session });

        const creditDocuments = destinationAllocations.map((allocation) => ({
          creditId: allocation.destinationRecordId,
          reclassificationId,
          allocationId: allocation.allocationId,
          sourceDepositTransactionId,
          memberId: allocation.memberId,
          targetAccount: allocation.targetAccount,
          amountPaise: allocation.amountPaise,
          remainingAmountPaise: allocation.amountPaise,
          paymentDate: source.recordedAt,
          paymentMethod: source.method,
          reference: source.reference || null,
          status: 'OPEN',
          history: [{
            event: 'CREDIT_CREATED_FROM_RECLASSIFICATION',
            timestamp: completedAt,
            actorRole,
            note: reason,
          }],
        }));
        const credits = await UnallocatedCredit.insertMany(creditDocuments, { session });

        source.status = 'reclassified';
        source.reclassificationId = reclassificationId;
        source.reclassifiedAt = completedAt;
        source.reclassifiedByRole = actorRole;
        source.reclassificationReason = reason;
        await source.save({ session });

        const otherActiveTransactions = activeTransactions.filter(
          (transaction) => transaction.depositTransactionId !== sourceDepositTransactionId,
        );
        const previousStatus = account.status;
        if (account.expectedDepositPaise === 0 && otherActiveTransactions.length === 0) {
          account.status = 'NOT_REQUIRED';
        }
        account.revision += 1;
        account.history.push({
          event: 'PAYMENT_RECLASSIFIED_FROM_DEPOSIT',
          timestamp: completedAt,
          actorRole,
          note: reason,
          details: {
            reclassificationId,
            sourceDepositTransactionId,
            amountPaise: source.amountPaise,
            previousStatus,
            status: account.status,
          },
        });
        await account.save({ session });

        await HostelClearance.updateMany(
          { stayId, validityStatus: { $in: [null, CLEARANCE_VALIDITY_STATUSES.ACTIVE] } },
          {
            $set: {
              validityStatus: CLEARANCE_VALIDITY_STATUSES.REVOKED,
              revokedAt: completedAt,
              revokedByRole: actorRole,
              revocationReason: reason,
              reconciliationId: reclassificationId,
            },
          },
          { session },
        );

        return {
          reclassificationId,
          journal: journal.toObject(),
          credits: credits.map((credit) => credit.toObject()),
          depositAccount: account.toObject(),
        };
      }, { retryOnDuplicateKey: true });
    } catch (error) {
      if (error.code === 11000) {
        const isReferenceConflict = Boolean(error.keyPattern?.normalizedReference || error.keyValue?.normalizedReference);
        const conflict = new Error(isReferenceConflict
          ? 'This external payment reference is already claimed by another ledger record.'
          : 'This source receipt has already been reclassified.');
        conflict.statusCode = 409;
        conflict.details = { code: isReferenceConflict ? 'DUPLICATE_PAYMENT_REFERENCE' : 'SOURCE_ALREADY_RECLASSIFIED' };
        throw conflict;
      }
      throw error;
    }
  },

  async voidDepositTransaction(depositTransactionId, { voidReason, voidedByRole, voidedAt = new Date() }, { session } = {}) {
    const options = { returnDocument: 'after' };
    if (session) options.session = session;
    return HostelDepositTransaction.findOneAndUpdate(
      { depositTransactionId, status: 'recorded' },
      {
        $set: {
          status: 'voided',
          voidReason,
          voidedByRole,
          voidedAt,
        },
      },
      options,
    ).lean();
  },

  async executeAtomicDepositTransaction({
    stayId,
    type,
    amountPaise,
    transactionData,
    actorRole,
  }) {
    return runFinancialTransaction(async (session) => {
      // 1. Idempotency check with payload verification inside transaction
      if (transactionData.idempotencyKey) {
        const existing = await HostelDepositTransaction.findOne({
          idempotencyKey: transactionData.idempotencyKey,
        }).session(session);

        if (existing) {
          const isMatch =
            existing.stayId === stayId &&
            existing.type === type &&
            existing.amountPaise === amountPaise &&
            existing.method === transactionData.method;

          if (!isMatch) {
            const err = new Error('Deposit transaction idempotency key reused with different payload.');
            err.statusCode = 409;
            throw err;
          }
          return existing.toObject();
        }
      }

      const account = await HostelDepositAccount.findOne({ stayId }).session(session);
      if (!account) {
        const err = new Error('Deposit account not found for this stay.');
        err.statusCode = 404;
        throw err;
      }

      if (account.status === 'NOT_REQUIRED') {
        const err = new Error('This stay has no deposit requirement. Configure a deposit requirement before recording a receipt.');
        err.statusCode = 409;
        err.details = { code: 'DEPOSIT_NOT_REQUIRED' };
        throw err;
      }

      await guardFinancialMutation({
        stayId,
        actorRole: transactionData.recordedByRole,
        session,
      });

      const transactions = await HostelDepositTransaction.find({
        stayId,
        status: 'recorded',
      }).session(session);

      let received = 0;
      let refunded = 0;
      let deducted = 0;
      for (const tx of transactions) {
        if (tx.type === 'RECEIVED') received += tx.amountPaise;
        else if (tx.type === 'REFUNDED') refunded += tx.amountPaise;
        else if (tx.type === 'DEDUCTED') deducted += tx.amountPaise;
      }
      const heldPaise = received - refunded - deducted;

      if ((type === 'REFUNDED' || type === 'DEDUCTED') && heldPaise < amountPaise) {
        const action = type === 'REFUNDED' ? 'refund' : 'deduct';
        const err = new Error(`Cannot ${action} ₹${(amountPaise / 100).toFixed(2)}: only ₹${(heldPaise / 100).toFixed(2)} currently held.`);
        err.statusCode = 400;
        err.details = { heldPaise, requestedPaise: amountPaise };
        throw err;
      }

      await claimExternalPaymentReference({
        reference: transactionData.reference,
        ledger: 'HOSTEL_DEPOSIT',
        documentId: transactionData.depositTransactionId,
        memberId: transactionData.memberId,
        session,
      });

      account.revision += 1;
      account.history.push({
        event: `DEPOSIT_${type}`,
        timestamp: new Date(),
        actorRole,
        note: `Recorded ${type} transaction of ${amountPaise} paise`,
        details: { depositTransactionId: transactionData.depositTransactionId, amountPaise, method: transactionData.method },
      });

      const nextHeld = heldPaise + (type === 'RECEIVED' ? amountPaise : -amountPaise);
      const nextReceived = received + (type === 'RECEIVED' ? amountPaise : 0);
      if (nextHeld === 0 && nextReceived > 0) {
        account.status = 'SETTLED';
      }
      await account.save({ session });

      const created = await HostelDepositTransaction.create([transactionData], { session });
      return created[0].toObject();
    }, { retryOnDuplicateKey: true });
  },

  async executeAtomicDepositVoid({
    stayId,
    depositTransactionId,
    reason,
    actorRole,
  }) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      let session = null;
      try {
        session = await mongoose.startSession();
        session.startTransaction();

        const tx = await HostelDepositTransaction.findOne({ depositTransactionId }).session(session);
        if (!tx || (stayId && tx.stayId !== stayId)) {
          const err = new Error('Deposit transaction not found or does not belong to this stay.');
          err.statusCode = 404;
          throw err;
        }

        if (tx.status !== 'recorded') {
          const err = new Error('Only an active recorded deposit transaction can be voided.');
          err.statusCode = 409;
          err.details = { code: 'DEPOSIT_TRANSACTION_NOT_ACTIVE', status: tx.status };
          throw err;
        }

        const targetStayId = tx.stayId || stayId;

        await guardFinancialMutation({ stayId: targetStayId, actorRole, session });

        // If voiding a RECEIVED transaction, verify that reducing received funds does not make heldPaise negative
        if (tx.type === 'RECEIVED') {
          const allActive = await HostelDepositTransaction.find({
            stayId: targetStayId,
            status: 'recorded',
          }).session(session);

          let received = 0;
          let refunded = 0;
          let deducted = 0;
          for (const item of allActive) {
            if (item.type === 'RECEIVED') received += item.amountPaise;
            else if (item.type === 'REFUNDED') refunded += item.amountPaise;
            else if (item.type === 'DEDUCTED') deducted += item.amountPaise;
          }
          const currentHeld = received - refunded - deducted;
          if (currentHeld < tx.amountPaise) {
            const err = new Error(`Cannot void receipt: ₹${((tx.amountPaise - currentHeld) / 100).toFixed(2)} has already been refunded or deducted.`);
            err.statusCode = 400;
            throw err;
          }
        }

        tx.status = 'voided';
        tx.voidReason = reason.trim();
        tx.voidedByRole = actorRole;
        tx.voidedAt = new Date();
        await tx.save({ session });

        const account = await HostelDepositAccount.findOne({ stayId: targetStayId }).session(session);
        if (account) {
          account.revision += 1;
          account.history.push({
            event: 'DEPOSIT_TRANSACTION_VOIDED',
            timestamp: new Date(),
            actorRole,
            note: `Voided transaction ${depositTransactionId}: ${reason}`,
            details: { depositTransactionId, originalType: tx.type, amountPaise: tx.amountPaise },
          });
          await account.save({ session });
        }

        await session.commitTransaction();
        return tx.toObject();
      } catch (err) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
          const error = new Error('Financial transaction unavailable. Database transaction support is required.');
          error.statusCode = 503;
          throw error;
        }
        throw err;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    }

    const err = new Error('Financial transaction unavailable. Database connection required.');
    err.statusCode = 503;
    throw err;
  },

  // ----------------------------------------------------
  // Hostel Clearance Operations
  // ----------------------------------------------------
  async createClearance(data, { session } = {}) {
    if (session) {
      const res = await HostelClearance.create([data], { session });
      return res[0].toObject();
    }
    const clearance = await HostelClearance.create(data);
    return clearance.toObject();
  },

  async findClearancesByStayId(stayId, { session } = {}) {
    const q = HostelClearance.find({ stayId }).sort({ sequence: -1 });
    if (session) q.session(session);
    return q.lean();
  },

  async findClearanceById(clearanceId, { session } = {}) {
    const q = HostelClearance.findOne({ clearanceId });
    if (session) q.session(session);
    return q.lean();
  },

  async revokeActiveClearances(
    stayId,
    { reason, actorRole, revokedAt, restorationId = null, reconciliationId = null },
    { session } = {},
  ) {
    const filter = {
      stayId,
      validityStatus: { $in: [null, CLEARANCE_VALIDITY_STATUSES.ACTIVE] },
    };
    const query = HostelClearance.find(filter).sort({ sequence: 1 });
    if (session) query.session(session);
    const clearances = await query.lean();
    if (clearances.length === 0) return [];

    await HostelClearance.updateMany(
      { clearanceId: { $in: clearances.map((clearance) => clearance.clearanceId) } },
      {
        $set: {
          validityStatus: CLEARANCE_VALIDITY_STATUSES.REVOKED,
          revokedAt,
          revokedByRole: actorRole,
          revocationReason: reason,
          restorationId,
          reconciliationId,
        },
      },
      session ? { session } : {},
    );
    return clearances.map((clearance) => clearance.clearanceId);
  },

  async supersedeActiveClearances(
    stayId,
    { supersededByClearanceId, reason, actorRole, supersededAt },
    { session } = {},
  ) {
    const filter = {
      stayId,
      clearanceId: { $ne: supersededByClearanceId },
      validityStatus: { $in: [null, CLEARANCE_VALIDITY_STATUSES.ACTIVE] },
    };
    const query = HostelClearance.find(filter).sort({ sequence: 1 });
    if (session) query.session(session);
    const clearances = await query.lean();
    if (clearances.length === 0) return [];

    await HostelClearance.updateMany(
      { clearanceId: { $in: clearances.map((clearance) => clearance.clearanceId) } },
      {
        $set: {
          validityStatus: CLEARANCE_VALIDITY_STATUSES.SUPERSEDED,
          supersededAt,
          supersededByRole: actorRole,
          supersessionReason: reason,
          supersededByClearanceId,
        },
      },
      session ? { session } : {},
    );
    return clearances.map((clearance) => clearance.clearanceId);
  },

  async getNextClearanceSequence(stayId, { session } = {}) {
    if (mongoose.connection && mongoose.connection.readyState === 1 && session) {
      const latest = await HostelClearance.findOne({ stayId }).sort({ sequence: -1 }).session(session).lean();
      const nextSeq = latest ? latest.sequence + 1 : 1;

      await HostelStay.updateOne(
        { stayId },
        { $set: { clearanceSequence: nextSeq } },
        { session },
      );
      return nextSeq;
    }
    const q = HostelClearance.findOne({ stayId }).sort({ sequence: -1 });
    if (session) q.session(session);
    const latest = await q.lean();
    return latest ? latest.sequence + 1 : 1;
  },
};
