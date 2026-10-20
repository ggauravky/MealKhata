export class InMemoryExpenseRepository {
  constructor() {
    this.expenses = [];
    this.reimbursements = [];
  }

  reset() {
    this.expenses = [];
    this.reimbursements = [];
  }

  async createExpense(data) {
    const doc = {
      ...data,
      createdAt: data.createdAt || new Date(),
      updatedAt: new Date(),
    };
    this.expenses.push(doc);
    return JSON.parse(JSON.stringify(doc));
  }

  async findExpenseById(expenseId) {
    const found = this.expenses.find((e) => e.expenseId === expenseId);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  async findExpenseByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    const found = this.expenses.find((e) => e.idempotencyKey === idempotencyKey);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  async findExpensesByMonth(month, { includeVoided = true } = {}) {
    return this.expenses
      .filter((e) => e.month === month && (includeVoided || e.status === 'recorded'))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => JSON.parse(JSON.stringify(e)));
  }

  async findExpensesForMemberByMonth(memberId, month, { includeVoided = true } = {}) {
    return this.expenses
      .filter((e) => {
        if (e.month !== month) return false;
        if (!includeVoided && e.status !== 'recorded') return false;
        const isPayer = e.paidByMemberId === memberId;
        const isBeneficiary = e.allocations?.some((a) => a.memberId === memberId);
        return isPayer || isBeneficiary;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => JSON.parse(JSON.stringify(e)));
  }

  async updateExpense(expenseId, updateData) {
    const index = this.expenses.findIndex((e) => e.expenseId === expenseId);
    if (index === -1) return null;
    this.expenses[index] = {
      ...this.expenses[index],
      ...updateData,
      updatedAt: new Date(),
    };
    return JSON.parse(JSON.stringify(this.expenses[index]));
  }

  async acquireExpenseRevision(expenseId, expectedRevision, newRevision) {
    const index = this.expenses.findIndex(
      (e) =>
        e.expenseId === expenseId &&
        e.status === 'recorded' &&
        (!expectedRevision || e.revision === expectedRevision),
    );
    if (index === -1) return null;
    this.expenses[index] = {
      ...this.expenses[index],
      revision: newRevision,
      updatedAt: new Date(),
    };
    return JSON.parse(JSON.stringify(this.expenses[index]));
  }

  async createReimbursement(data) {
    const doc = {
      ...data,
      recordedAt: data.recordedAt || new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.reimbursements.push(doc);
    return JSON.parse(JSON.stringify(doc));
  }

  async findReimbursementById(reimbursementId) {
    const found = this.reimbursements.find((r) => r.reimbursementId === reimbursementId);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  async findReimbursementByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    const found = this.reimbursements.find((r) => r.idempotencyKey === idempotencyKey);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  async findReimbursementsByExpenseId(expenseId) {
    return this.reimbursements
      .filter((r) => r.expenseId === expenseId)
      .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
      .map((r) => JSON.parse(JSON.stringify(r)));
  }

  async findReimbursementsByMonth(expenseMonth, { includeVoided = true } = {}) {
    return this.reimbursements
      .filter((r) => r.expenseMonth === expenseMonth && (includeVoided || r.status === 'recorded'))
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
      .map((r) => JSON.parse(JSON.stringify(r)));
  }

  async findReimbursementsForMemberByMonth(memberId, expenseMonth, { includeVoided = true } = {}) {
    return this.reimbursements
      .filter((r) => {
        if (r.expenseMonth !== expenseMonth) return false;
        if (!includeVoided && r.status !== 'recorded') return false;
        return r.fromMemberId === memberId || r.toMemberId === memberId;
      })
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
      .map((r) => JSON.parse(JSON.stringify(r)));
  }

  async updateReimbursement(reimbursementId, updateData) {
    const index = this.reimbursements.findIndex((r) => r.reimbursementId === reimbursementId);
    if (index === -1) return null;
    this.reimbursements[index] = {
      ...this.reimbursements[index],
      ...updateData,
      updatedAt: new Date(),
    };
    return JSON.parse(JSON.stringify(this.reimbursements[index]));
  }
}
