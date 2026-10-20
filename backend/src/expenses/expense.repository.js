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

        expense.revision = newRevision || new Date().toISOString();
        await expense.save({ session });

        const created = await ExpenseReimbursement.create([reimbursementData], { session });
        await session.commitTransaction();
        return created[0].toObject();
      } catch (err) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
          // Fall through if standalone
        } else {
          throw err;
        }
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    }

    const expense = await Expense.findOne({ expenseId });
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
    const activeReimbursements = await ExpenseReimbursement.find({
      expenseId,
      fromMemberId,
      status: 'recorded',
    });
    const alreadyReimbursedPaise = activeReimbursements.reduce((sum, r) => sum + r.amountPaise, 0);
    const remainingOwedPaise = Math.max(0, allocation.amountPaise - alreadyReimbursedPaise);
    if (amountPaise > remainingOwedPaise) {
      const err = new Error(`Payment of ₹${(amountPaise / 100).toFixed(2)} exceeds remaining due of ₹${(remainingOwedPaise / 100).toFixed(2)}.`);
      err.statusCode = 409;
      throw err;
    }
    expense.revision = newRevision || new Date().toISOString();
    await expense.save();
    const created = await ExpenseReimbursement.create(reimbursementData);
    return created.toObject();
  }
}

export const defaultExpenseRepository = new ExpenseRepository();
