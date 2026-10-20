import mongoose from 'mongoose';
import { Expense } from './expense.model.js';
import { ExpenseReimbursement } from './expenseReimbursement.model.js';

export class ExpenseRepository {
  async createExpense(data) {
    return Expense.create(data);
  }

  async findExpenseById(expenseId) {
    return Expense.findOne({ expenseId }).lean();
  }

  async findExpenseByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    return Expense.findOne({ idempotencyKey }).lean();
  }

  async findExpensesByMonth(month, { includeVoided = true } = {}) {
    const filter = { month };
    if (!includeVoided) filter.status = 'recorded';
    return Expense.find(filter).sort({ date: -1, createdAt: -1 }).lean();
  }

  async findExpensesForMemberByMonth(memberId, month, { includeVoided = true } = {}) {
    const filter = {
      month,
      $or: [{ paidByMemberId: memberId }, { 'allocations.memberId': memberId }],
    };
    if (!includeVoided) filter.status = 'recorded';
    return Expense.find(filter).sort({ date: -1, createdAt: -1 }).lean();
  }

  async updateExpense(expenseId, updateData) {
    return Expense.findOneAndUpdate({ expenseId }, { $set: updateData }, { new: true }).lean();
  }

  async recordExpenseCorrection(expenseId, { updateData, correctionRecord, expectedRevision }) {
    const filter = { expenseId, status: 'recorded' };
    if (expectedRevision) {
      filter.revision = expectedRevision;
    }
    const update = {
      $set: { ...updateData, revision: new Date().toISOString() },
      $push: { corrections: correctionRecord },
    };
    return Expense.findOneAndUpdate(filter, update, { new: true }).lean();
  }

  async acquireExpenseRevision(expenseId, expectedRevision, newRevision) {
    const filter = { expenseId, status: 'recorded' };
    if (expectedRevision) {
      filter.revision = expectedRevision;
    }
    return Expense.findOneAndUpdate(
      filter,
      { $set: { revision: newRevision } },
      { new: true },
    ).lean();
  }

  async createReimbursement(data) {
    return ExpenseReimbursement.create(data);
  }

  async findReimbursementById(reimbursementId) {
    return ExpenseReimbursement.findOne({ reimbursementId }).lean();
  }

  async findReimbursementByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    return ExpenseReimbursement.findOne({ idempotencyKey }).lean();
  }

  async findReimbursementsByExpenseId(expenseId) {
    return ExpenseReimbursement.find({ expenseId }).sort({ recordedAt: 1 }).lean();
  }

  async findReimbursementsByMonth(expenseMonth, { includeVoided = true } = {}) {
    const filter = { expenseMonth };
    if (!includeVoided) filter.status = 'recorded';
    return ExpenseReimbursement.find(filter).sort({ recordedAt: -1 }).lean();
  }

  async findReimbursementsForMemberByMonth(memberId, expenseMonth, { includeVoided = true } = {}) {
    const filter = {
      expenseMonth,
      $or: [{ fromMemberId: memberId }, { toMemberId: memberId }],
    };
    if (!includeVoided) filter.status = 'recorded';
    return ExpenseReimbursement.find(filter).sort({ recordedAt: -1 }).lean();
  }

  async updateReimbursement(reimbursementId, updateData) {
    return ExpenseReimbursement.findOneAndUpdate(
      { reimbursementId },
      { $set: updateData },
      { new: true },
    ).lean();
  }

  async executeAtomicReimbursement({
    expenseId,
    fromMemberId,
    amountPaise,
    reimbursementData,
    newRevision,
  }) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const maxRetries = 5;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let session = null;
        try {
          session = await mongoose.startSession();
          session.startTransaction();

          const expense = await Expense.findOne({ expenseId }).session(session);
          if (!expense || expense.status === 'voided') {
            const err = new Error('Expense not found or voided.');
            err.statusCode = 404;
            throw err;
          }

          const allocation = (expense.allocations || []).find((a) => a.memberId === fromMemberId);
          if (!allocation) {
            const err = new Error(`Member ${fromMemberId} is not a beneficiary of this expense.`);
            err.statusCode = 400;
            throw err;
          }

          if (reimbursementData.idempotencyKey) {
            const dup = await ExpenseReimbursement.findOne({
              idempotencyKey: reimbursementData.idempotencyKey,
            }).session(session);
            if (dup) {
              if (
                dup.fromMemberId !== fromMemberId ||
                dup.amountPaise !== amountPaise ||
                dup.expenseId !== expenseId
              ) {
                const err = new Error('Idempotency key has already been used with a different transaction payload.');
                err.statusCode = 409;
                throw err;
              }
              await session.commitTransaction();
              return dup.toObject();
            }
          }

          // Concurrency guard: serialize concurrent reimbursements on this expense
          await Expense.updateOne(
            { expenseId },
            { $set: { revision: newRevision || new Date().toISOString() } },
            { session },
          );

          const activeReimbursements = await ExpenseReimbursement.find({
            expenseId,
            fromMemberId,
            status: 'recorded',
          }).session(session);

          const alreadyReimbursedPaise = activeReimbursements.reduce((sum, r) => sum + r.amountPaise, 0);
          const remainingOwedPaise = Math.max(0, allocation.amountPaise - alreadyReimbursedPaise);

          if (amountPaise > remainingOwedPaise) {
            const err = new Error(`Payment of ₹${(amountPaise / 100).toFixed(2)} exceeds remaining due of ₹${(remainingOwedPaise / 100).toFixed(2)}.`);
            err.statusCode = 409;
            throw err;
          }

          const created = await ExpenseReimbursement.create([reimbursementData], { session });
          await session.commitTransaction();
          return created[0].toObject();
        } catch (err) {
          if (session && session.inTransaction()) {
            await session.abortTransaction();
          }
          const isTransient =
            err.errorLabels?.has?.('TransientTransactionError') ||
            err.errorLabelSet?.has?.('TransientTransactionError') ||
            err.code === 112 ||
            (typeof err.message === 'string' && (err.message.includes('WriteConflict') || err.message.includes('catalog changes')));

          if (isTransient && attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            continue;
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
    }

    const err = new Error('Financial transaction unavailable. Database connection required.');
    err.statusCode = 503;
    throw err;
  }

  async executeAtomicReimbursementVoid({ reimbursementId, reason, actorRole }) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      let session = null;
      try {
        session = await mongoose.startSession();
        session.startTransaction();

        const reimbursement = await ExpenseReimbursement.findOne({ reimbursementId }).session(session);
        if (!reimbursement) {
          const err = new Error('Reimbursement not found.');
          err.statusCode = 404;
          throw err;
        }
        if (reimbursement.status === 'voided') {
          const err = new Error('Reimbursement is already voided.');
          err.statusCode = 409;
          throw err;
        }

        const expense = await Expense.findOne({ expenseId: reimbursement.expenseId }).session(session);
        if (!expense) {
          const err = new Error('Expense not found.');
          err.statusCode = 404;
          throw err;
        }

        expense.revision = new Date().toISOString();
        await expense.save({ session });

        reimbursement.status = 'voided';
        reimbursement.voidedAt = new Date();
        reimbursement.voidedByRole = actorRole;
        reimbursement.voidReason = reason.trim();
        await reimbursement.save({ session });

        await session.commitTransaction();
        return reimbursement.toObject();
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
  }
}

export const defaultExpenseRepository = new ExpenseRepository();
