import mongoose from 'mongoose';
import { Payment } from './payment.model.js';
import { guardFinancialMutation } from '../finance/financialMutationGuard.js';

function toPlainObject(document) {
  return document?.toObject ? document.toObject() : document;
}

function isTransientTransactionError(error) {
  return error.errorLabels?.has?.('TransientTransactionError')
    || error.errorLabelSet?.has?.('TransientTransactionError')
    || error.code === 112
    || (typeof error.message === 'string' && error.message.includes('WriteConflict'));
}

async function runFinancialTransaction(work) {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    const error = new Error('Financial transaction unavailable. Database connection required.');
    error.statusCode = 503;
    throw error;
  }

  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let session = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session?.inTransaction()) await session.abortTransaction();
      if (isTransientTransactionError(error) && attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      if (
        error.message?.includes('Transactions are not supported')
        || error.message?.includes('replica set')
      ) {
        const unavailable = new Error('Financial transaction unavailable. Database transaction support is required.');
        unavailable.statusCode = 503;
        throw unavailable;
      }
      throw error;
    } finally {
      if (session) await session.endSession();
    }
  }

  const error = new Error('Financial transaction could not be completed safely.');
  error.statusCode = 409;
  throw error;
}

export const paymentRepository = Object.freeze({
  async findByMonth(month) {
    return Payment.find({ month }).sort({ recordedAt: -1, paymentId: -1 }).lean().exec();
  },

  async findHistoryByMonth(month) {
    return Payment.find({ month })
      .select({
        _id: 0,
        paymentId: 1,
        month: 1,
        memberId: 1,
        amountPaise: 1,
        method: 1,
        upiReference: 1,
        recordedAt: 1,
        recordedByRole: 1,
        status: 1,
        voidedAt: 1,
        voidedByRole: 1,
        voidReason: 1,
      })
      .sort({ recordedAt: -1, paymentId: -1 })
      .lean()
      .exec();
  },

  async findSummaryByMonth(month) {
    return Payment.find({ month })
      .select({ _id: 0, memberId: 1, amountPaise: 1, status: 1 })
      .lean()
      .exec();
  },

  async findByPaymentId(paymentId) {
    return Payment.findOne({ paymentId }).lean().exec();
  },

  async findByIdempotencyKey(idempotencyKey) {
    return Payment.findOne({ idempotencyKey }).lean().exec();
  },

  async create(payment) {
    return runFinancialTransaction(async (session) => {
      await guardFinancialMutation({
        memberId: payment.memberId,
        effectiveMonth: payment.month,
        session,
      });
      const [document] = await Payment.create([payment], { session });
      return toPlainObject(document);
    });
  },

  async voidIfRecorded({ paymentId, voidedAt, voidedByRole, voidReason }) {
    return runFinancialTransaction(async (session) => {
      const payment = await Payment.findOne({ paymentId }).session(session).lean();
      if (!payment || payment.status !== 'recorded') return null;

      await guardFinancialMutation({
        memberId: payment.memberId,
        effectiveMonth: payment.month,
        session,
      });

      return Payment.findOneAndUpdate(
        { paymentId, status: 'recorded' },
        {
          $set: {
            status: 'voided',
            voidedAt,
            voidedByRole,
            voidReason,
          },
        },
        { returnDocument: 'after', runValidators: true, session },
      ).lean().exec();
    });
  },
});
