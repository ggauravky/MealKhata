import crypto from 'node:crypto';
import { MEMBERS } from '../config/members.js';
import { broadcastExpensesUpdated } from '../socket.js';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  isSafeIntegerPaise,
  isValidLogicalDate,
  isValidLogicalMonth,
  isValidUuid,
  MAX_EXPENSE_NOTE_LENGTH,
  MAX_EXPENSE_TITLE_LENGTH,
  MAX_REIMBURSEMENT_REF_LENGTH,
  MAX_VOID_REASON_LENGTH,
  REIMBURSEMENT_METHODS,
  REIMBURSEMENT_STATUSES,
} from './expense.constants.js';
import {
  canCreateExpense,
  canMemberAccessExpense,
  canRecordReimbursement,
  canViewHouseholdExpenses,
  canVoidExpense,
  canVoidReimbursement,
} from './expense.permissions.js';
import { defaultExpenseRepository } from './expense.repository.js';
import {
  computeExpenseFinancials,
  serializeExpense,
  serializeReimbursement,
} from './expense.serializer.js';
import { calculateExpenseSplit } from './expenseSplit.service.js';

export class ExpenseDomainError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ExpenseDomainError';
    this.statusCode = statusCode;
  }
}

export class ExpenseService {
  constructor(repository = defaultExpenseRepository) {
    this.repository = repository;
  }

  /**
   * Preview an expense split without persisting to database.
   */
  async previewExpense({ amountPaise, paidByMemberId, splitType, participants, customAllocations }) {
    const split = calculateExpenseSplit({
      amountPaise,
      paidByMemberId,
      splitType,
      participants,
      customAllocations,
    });

    return {
      amountPaise: split.amountPaise,
      splitType: split.splitType,
      allocations: split.allocations,
      reimbursementObligations: split.reimbursementObligations,
      totalInitialReceivablePaise: split.totalInitialReceivablePaise,
    };
  }

  /**
   * Create and record a new expense.
   */
  async createExpense({
    date,
    title,
    category,
    description = '',
    amountPaise,
    paidByMemberId,
    splitType,
    participants,
    customAllocations,
    idempotencyKey,
    actorRole,
    actorMemberId = null,
  }) {
    if (!canCreateExpense(actorRole)) {
      throw new ExpenseDomainError('Only administrators can record expenses.', 403);
    }

    if (!isValidLogicalDate(date)) {
      throw new ExpenseDomainError('Expense date must be in valid YYYY-MM-DD format.', 400);
    }

    const month = date.slice(0, 7);

    if (typeof title !== 'string' || !title.trim() || title.length > MAX_EXPENSE_TITLE_LENGTH) {
      throw new ExpenseDomainError(`Title is required and must not exceed ${MAX_EXPENSE_TITLE_LENGTH} characters.`, 400);
    }

    if (!EXPENSE_CATEGORIES.includes(category)) {
      throw new ExpenseDomainError(`Invalid expense category: ${category}`, 400);
    }

    if (description && description.length > MAX_EXPENSE_NOTE_LENGTH) {
      throw new ExpenseDomainError(`Note must not exceed ${MAX_EXPENSE_NOTE_LENGTH} characters.`, 400);
    }

    // Check idempotency
    if (idempotencyKey) {
      if (!isValidUuid(idempotencyKey)) {
        throw new ExpenseDomainError('Idempotency key must be a valid UUID.', 400);
      }
      const existing = await this.repository.findExpenseByIdempotencyKey(idempotencyKey);
      if (existing) {
        const reimbursements = await this.repository.findReimbursementsByExpenseId(existing.expenseId);
        return serializeExpense({ expense: existing, reimbursements, role: actorRole });
      }
    }

    // Authoritative split calculation
    const splitResult = calculateExpenseSplit({
      amountPaise,
      paidByMemberId,
      splitType,
      participants,
      customAllocations,
    });

    const expenseId = crypto.randomUUID();
    const revision = new Date().toISOString();

    const newExpense = await this.repository.createExpense({
      expenseId,
      date,
      month,
      title: title.trim(),
      category,
      description: description.trim(),
      amountPaise: splitResult.amountPaise,
      paidByMemberId,
      splitType: splitResult.splitType,
      allocations: splitResult.allocations,
      status: EXPENSE_STATUSES.RECORDED,
      idempotencyKey: idempotencyKey || null,
      createdByRole: actorRole,
      createdByMemberId: actorMemberId || null,
      revision,
    });

    broadcastExpensesUpdated({
      scope: 'expenses',
      month,
      revision,
    });

    return serializeExpense({ expense: newExpense, reimbursements: [], role: actorRole });
  }

  /**
   * Get an expense by ID with role & involvement authorization.
   */
  async getExpenseById(expenseId, { actorRole, actorMemberId }) {
    if (!isValidUuid(expenseId)) {
      throw new ExpenseDomainError('Invalid expense ID format.', 400);
    }

    const expense = await this.repository.findExpenseById(expenseId);
    if (!expense) {
      throw new ExpenseDomainError('Expense not found.', 404);
    }

    // Authorization check
    if (!canViewHouseholdExpenses(actorRole)) {
      if (!canMemberAccessExpense(actorMemberId, expense)) {
        throw new ExpenseDomainError('You are not authorized to view this expense.', 403);
      }
    }

    const reimbursements = await this.repository.findReimbursementsByExpenseId(expenseId);
    return serializeExpense({
      expense,
      reimbursements,
      currentMemberId: actorMemberId,
      role: actorRole,
    });
  }

  /**
   * List expenses by month with strict privacy filtering.
   */
  async listExpensesByMonth(month, { actorRole, actorMemberId, category, status }) {
    if (!isValidLogicalMonth(month)) {
      throw new ExpenseDomainError('Month must be in YYYY-MM format.', 400);
    }

    let rawExpenses = [];
    if (canViewHouseholdExpenses(actorRole)) {
      rawExpenses = await this.repository.findExpensesByMonth(month, { includeVoided: true });
    } else {
      if (!actorMemberId) {
        throw new ExpenseDomainError('Member identity required.', 401);
      }
      rawExpenses = await this.repository.findExpensesForMemberByMonth(actorMemberId, month, {
        includeVoided: true,
      });
    }

    // Apply optional filters
    if (category && EXPENSE_CATEGORIES.includes(category)) {
      rawExpenses = rawExpenses.filter((e) => e.category === category);
    }
    if (status) {
      rawExpenses = rawExpenses.filter((e) => e.status === status);
    }

    // Fetch reimbursements for all expenses in this month
    const allReimbursements = await this.repository.findReimbursementsByMonth(month, {
      includeVoided: true,
    });

    const reimbursementsByExpense = new Map();
    for (const r of allReimbursements) {
      if (!reimbursementsByExpense.has(r.expenseId)) {
        reimbursementsByExpense.set(r.expenseId, []);
      }
      reimbursementsByExpense.get(r.expenseId).push(r);
    }

    return rawExpenses.map((expense) =>
      serializeExpense({
        expense,
        reimbursements: reimbursementsByExpense.get(expense.expenseId) || [],
        currentMemberId: actorMemberId,
        role: actorRole,
      }),
    );
  }

  /**
   * Void an expense (Super Admin only).
   */
  async voidExpense(expenseId, { reason, actorRole }) {
    if (!canVoidExpense(actorRole)) {
      throw new ExpenseDomainError('Only Super Admin can void an expense.', 403);
    }

    if (!isValidUuid(expenseId)) {
      throw new ExpenseDomainError('Invalid expense ID format.', 400);
    }

    if (!reason || typeof reason !== 'string' || !reason.trim() || reason.length > MAX_VOID_REASON_LENGTH) {
      throw new ExpenseDomainError('A mandatory void reason is required (up to 300 characters).', 400);
    }

    const expense = await this.repository.findExpenseById(expenseId);
    if (!expense) {
      throw new ExpenseDomainError('Expense not found.', 404);
    }

    if (expense.status === EXPENSE_STATUSES.VOIDED) {
      throw new ExpenseDomainError('Expense is already voided.', 409);
    }

    // Integrity Guard: Check if active reimbursements exist
    const reimbursements = await this.repository.findReimbursementsByExpenseId(expenseId);
    const activeReimbursements = reimbursements.filter((r) => r.status !== REIMBURSEMENT_STATUSES.VOIDED);

    if (activeReimbursements.length > 0) {
      throw new ExpenseDomainError(
        `Cannot void expense with ${activeReimbursements.length} active reimbursement(s). Void active reimbursements first.`,
        409,
      );
    }

    const updated = await this.repository.updateExpense(expenseId, {
      status: EXPENSE_STATUSES.VOIDED,
      voidedAt: new Date(),
      voidedByRole: actorRole,
      voidReason: reason.trim(),
      revision: new Date().toISOString(),
    });

    broadcastExpensesUpdated({
      scope: 'expenses',
      month: expense.month,
      revision: updated.revision,
    });

    return serializeExpense({ expense: updated, reimbursements, role: actorRole });
  }

  /**
   * Record a confirmed reimbursement for an expense.
   */
  async recordReimbursement({
    expenseId,
    fromMemberId,
    amountPaise,
    method = 'upi',
    reference = null,
    idempotencyKey,
    actorRole,
  }) {
    if (!canRecordReimbursement(actorRole)) {
      throw new ExpenseDomainError('Only administrators can record reimbursements.', 403);
    }

    if (!isValidUuid(expenseId)) {
      throw new ExpenseDomainError('Invalid expense ID format.', 400);
    }

    if (!isSafeIntegerPaise(amountPaise)) {
      throw new ExpenseDomainError('Reimbursement amount must be a positive integer in paise.', 400);
    }

    if (!REIMBURSEMENT_METHODS.includes(method)) {
      throw new ExpenseDomainError(`Invalid reimbursement method: ${method}`, 400);
    }

    if (reference && reference.length > MAX_REIMBURSEMENT_REF_LENGTH) {
      throw new ExpenseDomainError(`Reference must not exceed ${MAX_REIMBURSEMENT_REF_LENGTH} characters.`, 400);
    }

    // Check idempotency
    if (idempotencyKey) {
      if (!isValidUuid(idempotencyKey)) {
        throw new ExpenseDomainError('Idempotency key must be a valid UUID.', 400);
      }
      const existing = await this.repository.findReimbursementByIdempotencyKey(idempotencyKey);
      if (existing) {
        return serializeReimbursement(existing);
      }
    }

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const expense = await this.repository.findExpenseById(expenseId);
      if (!expense) {
        throw new ExpenseDomainError('Expense not found.', 404);
      }

      if (expense.status === EXPENSE_STATUSES.VOIDED) {
        throw new ExpenseDomainError('Cannot record reimbursement against a voided expense.', 409);
      }

      if (fromMemberId === expense.paidByMemberId) {
        throw new ExpenseDomainError('Payer cannot reimburse themselves for their own purchase.', 400);
      }

      // Find allocation for the member owing
      const allocation = (expense.allocations || []).find((a) => a.memberId === fromMemberId);
      if (!allocation) {
        throw new ExpenseDomainError(`Member ${fromMemberId} is not a beneficiary of this expense.`, 400);
      }

      // Concurrency-safe calculation of remaining debt
      const existingReimbursements = await this.repository.findReimbursementsByExpenseId(expenseId);
      const activeReimbursements = existingReimbursements.filter(
        (r) => r.status !== REIMBURSEMENT_STATUSES.VOIDED && r.fromMemberId === fromMemberId,
      );

      const alreadyReimbursedPaise = activeReimbursements.reduce((sum, r) => sum + r.amountPaise, 0);
      const remainingOwedPaise = Math.max(0, allocation.amountPaise - alreadyReimbursedPaise);

      if (remainingOwedPaise === 0) {
        throw new ExpenseDomainError(
          `Member ${fromMemberId}'s share of this expense is already fully reimbursed.`,
          409,
        );
      }

      if (amountPaise > remainingOwedPaise) {
        const remainingRupees = (remainingOwedPaise / 100).toFixed(2);
        throw new ExpenseDomainError(
          `Payment of ₹${(amountPaise / 100).toFixed(2)} exceeds remaining due of ₹${remainingRupees}.`,
          409,
        );
      }

      // Atomic revision transition guard
      const newRevision = crypto.randomUUID();
      const acquired = await this.repository.acquireExpenseRevision(
        expenseId,
        expense.revision,
        newRevision,
      );

      if (!acquired) {
        // Revision conflict from concurrent request; retry with refreshed state
        continue;
      }

      const reimbursementId = crypto.randomUUID();
      const newReimbursement = await this.repository.createReimbursement({
        reimbursementId,
        expenseId,
        expenseMonth: expense.month,
        fromMemberId,
        toMemberId: expense.paidByMemberId,
        amountPaise,
        method,
        reference: reference ? reference.trim() : null,
        idempotencyKey: idempotencyKey || null,
        status: REIMBURSEMENT_STATUSES.RECORDED,
        recordedAt: new Date(),
        recordedByRole: actorRole,
      });

      broadcastExpensesUpdated({
        scope: 'expenses',
        month: expense.month,
        revision: newRevision,
      });

      return serializeReimbursement(newReimbursement);
    }

    throw new ExpenseDomainError(
      'Could not record reimbursement due to concurrent update conflict. Please retry.',
      409,
    );
  }

  /**
   * Void a reimbursement (Super Admin only).
   */
  async voidReimbursement(reimbursementId, { reason, actorRole }) {
    if (!canVoidReimbursement(actorRole)) {
      throw new ExpenseDomainError('Only Super Admin can void a reimbursement.', 403);
    }

    if (!isValidUuid(reimbursementId)) {
      throw new ExpenseDomainError('Invalid reimbursement ID format.', 400);
    }

    if (!reason || typeof reason !== 'string' || !reason.trim() || reason.length > MAX_VOID_REASON_LENGTH) {
      throw new ExpenseDomainError('A mandatory void reason is required (up to 300 characters).', 400);
    }

    const reimbursement = await this.repository.findReimbursementById(reimbursementId);
    if (!reimbursement) {
      throw new ExpenseDomainError('Reimbursement not found.', 404);
    }

    if (reimbursement.status === REIMBURSEMENT_STATUSES.VOIDED) {
      throw new ExpenseDomainError('Reimbursement is already voided.', 409);
    }

    const updated = await this.repository.updateReimbursement(reimbursementId, {
      status: REIMBURSEMENT_STATUSES.VOIDED,
      voidedAt: new Date(),
      voidedByRole: actorRole,
      voidReason: reason.trim(),
    });

    broadcastExpensesUpdated({
      scope: 'expenses',
      month: reimbursement.expenseMonth,
      revision: new Date().toISOString(),
    });

    return serializeReimbursement(updated);
  }

  async getMemberExpenseSummary(arg1, arg2) {
    const month = isValidLogicalMonth(arg1) ? arg1 : arg2;
    const memberId = isValidLogicalMonth(arg1) ? arg2 : arg1;
    if (!isValidLogicalMonth(month)) {
      throw new ExpenseDomainError('Month must be in YYYY-MM format.', 400);
    }
    if (!memberId) {
      throw new ExpenseDomainError('Member ID required.', 400);
    }

    const expenses = await this.repository.findExpensesForMemberByMonth(memberId, month, {
      includeVoided: false,
    });
    const reimbursements = await this.repository.findReimbursementsForMemberByMonth(memberId, month, {
      includeVoided: false,
    });

    let spendingSharePaise = 0;
    let paidMerchantsPaise = 0;
    let iOweOthersPaise = 0;
    let owedToMePaise = 0;

    for (const exp of expenses) {
      const expReimbursements = reimbursements.filter((r) => r.expenseId === exp.expenseId);
      const financials = computeExpenseFinancials({ expense: exp, reimbursements: expReimbursements });

      const isPayer = exp.paidByMemberId === memberId;
      const myShare = financials.memberShares.find((m) => m.memberId === memberId);

      if (myShare) {
        spendingSharePaise += myShare.sharePaise;
      }

      if (isPayer) {
        paidMerchantsPaise += exp.amountPaise;
        owedToMePaise += financials.totalOutstandingReceivablePaise;
      } else if (myShare) {
        iOweOthersPaise += myShare.remainingOwedPaise;
      }
    }

    const reimbursementsPaidPaise = reimbursements
      .filter((r) => r.fromMemberId === memberId)
      .reduce((sum, r) => sum + r.amountPaise, 0);

    const reimbursementsReceivedPaise = reimbursements
      .filter((r) => r.toMemberId === memberId)
      .reduce((sum, r) => sum + r.amountPaise, 0);

    return {
      month,
      memberId,
      spendingSharePaise,
      paidMerchantsPaise,
      iOweOthersPaise,
      owedToMePaise,
      reimbursementsPaidPaise,
      reimbursementsReceivedPaise,
    };
  }

  /**
   * Get household-level summary for a month (Admin/Super Admin only).
   */
  async getHouseholdExpenseSummary(month, { actorRole }) {
    if (!canViewHouseholdExpenses(actorRole)) {
      throw new ExpenseDomainError('Only administrators can view household expense summaries.', 403);
    }

    if (!isValidLogicalMonth(month)) {
      throw new ExpenseDomainError('Month must be in YYYY-MM format.', 400);
    }

    const activeExpenses = await this.repository.findExpensesByMonth(month, { includeVoided: false });
    const allReimbursements = await this.repository.findReimbursementsByMonth(month, { includeVoided: false });

    let totalExpensesPaise = 0;
    let totalOutstandingReimbursementsPaise = 0;

    const categoryBreakdown = {};
    for (const cat of EXPENSE_CATEGORIES) {
      categoryBreakdown[cat] = { count: 0, totalPaise: 0 };
    }

    const memberBreakdown = {};
    for (const m of MEMBERS) {
      memberBreakdown[m.id] = {
        memberId: m.id,
        memberName: m.name,
        spendingSharePaise: 0,
        paidMerchantsPaise: 0,
        iOweOthersPaise: 0,
        owedToMePaise: 0,
      };
    }

    for (const exp of activeExpenses) {
      totalExpensesPaise += exp.amountPaise;

      if (categoryBreakdown[exp.category]) {
        categoryBreakdown[exp.category].count += 1;
        categoryBreakdown[exp.category].totalPaise += exp.amountPaise;
      }

      if (memberBreakdown[exp.paidByMemberId]) {
        memberBreakdown[exp.paidByMemberId].paidMerchantsPaise += exp.amountPaise;
      }

      const expReimbursements = allReimbursements.filter((r) => r.expenseId === exp.expenseId);
      const financials = computeExpenseFinancials({ expense: exp, reimbursements: expReimbursements });

      totalOutstandingReimbursementsPaise += financials.totalOutstandingReceivablePaise;

      for (const share of financials.memberShares) {
        if (memberBreakdown[share.memberId]) {
          memberBreakdown[share.memberId].spendingSharePaise += share.sharePaise;
          if (!share.isPayer) {
            memberBreakdown[share.memberId].iOweOthersPaise += share.remainingOwedPaise;
          }
        }
      }

      if (memberBreakdown[exp.paidByMemberId]) {
        memberBreakdown[exp.paidByMemberId].owedToMePaise += financials.totalOutstandingReceivablePaise;
      }
    }

    const totalReimbursementsPaidPaise = allReimbursements.reduce((sum, r) => sum + r.amountPaise, 0);

    return {
      month,
      totalExpensesPaise,
      totalReimbursementsPaidPaise,
      totalOutstandingReimbursementsPaise,
      expenseCount: activeExpenses.length,
      categoryBreakdown,
      members: memberBreakdown,
    };
  }
}

export const defaultExpenseService = new ExpenseService();
