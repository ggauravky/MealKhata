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
}

export const defaultExpenseRepository = new ExpenseRepository();
