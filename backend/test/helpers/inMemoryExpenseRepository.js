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

  async recordExpenseCorrection(expenseId, { updateData, correctionRecord, expectedRevision }) {
    const index = this.expenses.findIndex(
      (e) =>
        e.expenseId === expenseId &&
        e.status === 'recorded' &&
        (!expectedRevision || e.revision === expectedRevision),
    );
    if (index === -1) return null;
    const existing = this.expenses[index];
    const corrections = Array.isArray(existing.corrections) ? [...existing.corrections] : [];
    corrections.push(correctionRecord);
    this.expenses[index] = {
      ...existing,
      ...updateData,
      corrections,
      revision: new Date().toISOString(),
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

  async executeAtomicReimbursement({
    expenseId,
    fromMemberId,
    amountPaise,
    reimbursementData,
    newRevision,
  }) {
    const expense = this.expenses.find((e) => e.expenseId === expenseId);
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
    const activeReimbursements = this.reimbursements.filter(
      (r) => r.expenseId === expenseId && r.fromMemberId === fromMemberId && r.status !== 'voided',
    );
    const alreadyReimbursedPaise = activeReimbursements.reduce((sum, r) => sum + r.amountPaise, 0);
    const remainingOwedPaise = Math.max(0, allocation.amountPaise - alreadyReimbursedPaise);
    if (amountPaise > remainingOwedPaise) {
      const err = new Error(`Payment of ₹${(amountPaise / 100).toFixed(2)} exceeds remaining due of ₹${(remainingOwedPaise / 100).toFixed(2)}.`);
      err.statusCode = 409;
      throw err;
    }

    if (reimbursementData.idempotencyKey) {
      const dup = this.reimbursements.find((r) => r.idempotencyKey === reimbursementData.idempotencyKey);
      if (dup) {
        if (dup.fromMemberId !== fromMemberId || dup.amountPaise !== amountPaise || dup.expenseId !== expenseId) {
          const err = new Error('Idempotency key has already been used with a different transaction payload.');
          err.statusCode = 409;
          throw err;
        }
        return JSON.parse(JSON.stringify(dup));
      }
    }

    expense.revision = newRevision || new Date().toISOString();
    const doc = {
      ...reimbursementData,
      recordedAt: reimbursementData.recordedAt || new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.reimbursements.push(doc);
    return JSON.parse(JSON.stringify(doc));
  }

  async executeAtomicReimbursementVoid({ reimbursementId, reason, actorRole }) {
    const reimbursement = this.reimbursements.find((r) => r.reimbursementId === reimbursementId);
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
    const expense = this.expenses.find((e) => e.expenseId === reimbursement.expenseId);
    if (!expense) {
      const err = new Error('Expense not found.');
      err.statusCode = 404;
      throw err;
    }
    expense.revision = new Date().toISOString();
    reimbursement.status = 'voided';
    reimbursement.voidedAt = new Date();
    reimbursement.voidedByRole = actorRole;
    reimbursement.voidReason = reason.trim();
    reimbursement.updatedAt = new Date();
    return JSON.parse(JSON.stringify(reimbursement));
  }

  async executeAtomicExpenseVoid({ expenseId, reason, actorRole }) {
    const expense = this.expenses.find((e) => e.expenseId === expenseId);
    if (!expense) {
      const err = new Error('Expense not found.');
      err.statusCode = 404;
      throw err;
    }
    if (expense.status === 'voided') {
      const err = new Error('Expense is already voided.');
      err.statusCode = 409;
      throw err;
    }

    const activeReimbursements = this.reimbursements.filter(
      (r) => r.expenseId === expenseId && r.status !== 'voided',
    );
    if (activeReimbursements.length > 0) {
      const err = new Error(
        `Cannot void expense with ${activeReimbursements.length} active reimbursement(s). Void active reimbursements first.`,
      );
      err.statusCode = 409;
      throw err;
    }

    expense.status = 'voided';
    expense.voidedAt = new Date();
    expense.voidedByRole = actorRole;
    expense.voidReason = reason.trim();
    expense.revision = new Date().toISOString();
    expense.updatedAt = new Date();
    return JSON.parse(JSON.stringify(expense));
  }

  async executeAtomicExpenseCorrection({
    expenseId,
    updateData,
    correctionRecord,
    expectedRevision,
    isFinancialChange,
  }) {
    const expense = this.expenses.find((e) => e.expenseId === expenseId);
    if (!expense) {
      const err = new Error('Expense not found.');
      err.statusCode = 404;
      throw err;
    }
    if (expense.status === 'voided') {
      const err = new Error('Cannot edit or correct a voided expense.');
      err.statusCode = 409;
      throw err;
    }
    if (expectedRevision && expense.revision !== expectedRevision) {
      const err = new Error('The expense was modified concurrently. Please refresh and try again.');
      err.statusCode = 409;
      throw err;
    }

    if (isFinancialChange) {
      const activeReimbursements = this.reimbursements.filter(
        (r) => r.expenseId === expenseId && r.status !== 'voided',
      );
      if (activeReimbursements.length > 0) {
        const err = new Error(
          'This Expense has recorded reimbursements. Financial details cannot be changed until the existing reimbursements are reconciled.',
        );
        err.statusCode = 409;
        throw err;
      }
    }

    Object.assign(expense, updateData);
    expense.revision = new Date().toISOString();
    if (!expense.corrections) {
      expense.corrections = [];
    }
    expense.corrections.push(correctionRecord);
    expense.updatedAt = new Date();
    return JSON.parse(JSON.stringify(expense));
  }
}
