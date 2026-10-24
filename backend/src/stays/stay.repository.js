/**
 * MealKhata 2.0 - Hostel Stay, Deposit & Clearance Repository
 */

import mongoose from 'mongoose';
import {
  HostelClearance,
  HostelDepositAccount,
  HostelDepositTransaction,
  HostelStay,
} from './stay.model.js';
import { CLEARANCE_VALIDITY_STATUSES, STAY_STATUSES } from './stay.constants.js';
import { guardFinancialMutation } from '../finance/financialMutationGuard.js';
import { runFinancialTransaction } from '../finance/financialTransaction.js';

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

  async restoreStay(
    stayId,
    {
      joinedOn,
      roomId,
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

        if (tx.status === 'voided') {
          const err = new Error('Deposit transaction is already voided.');
          err.statusCode = 400;
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
    { reason, actorRole, revokedAt, restorationId },
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
