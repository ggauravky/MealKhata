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
  canEditExpense,
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
      idempotencyKey: idempotencyKey || undefined,
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

    let rawExpenses;
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

    let updated;
    if (typeof this.repository.executeAtomicExpenseVoid === 'function') {
      try {
        updated = await this.repository.executeAtomicExpenseVoid({
          expenseId,
          reason: reason.trim(),
          actorRole,
        });
      } catch (err) {
        throw new ExpenseDomainError(err.message, err.statusCode || 400);
      }
    } else {
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

      updated = await this.repository.updateExpense(expenseId, {
        status: EXPENSE_STATUSES.VOIDED,
        voidedAt: new Date(),
        voidedByRole: actorRole,
        voidReason: reason.trim(),
        revision: new Date().toISOString(),
      });
    }

    broadcastExpensesUpdated({
      scope: 'expenses',
      month: updated.month,
      revision: updated.revision,
    });

    const reimbursements = await this.repository.findReimbursementsByExpenseId(expenseId);
    return serializeExpense({ expense: updated, reimbursements, role: actorRole });
  }

  /**
   * Correct / Edit an expense (Super Admin only).
   */
  async correctExpense(expenseId, { reason, changes = {}, expectedRevision = null, actorRole }) {
    if (!canEditExpense(actorRole)) {
      throw new ExpenseDomainError('Only Super Admin can correct or edit an expense.', 403);
    }

    if (!isValidUuid(expenseId)) {
      throw new ExpenseDomainError('Invalid expense ID format.', 400);
    }

    if (!reason || typeof reason !== 'string' || !reason.trim() || reason.trim().length > MAX_VOID_REASON_LENGTH) {
      throw new ExpenseDomainError('A mandatory correction reason is required (up to 300 characters).', 400);
    }

    const expense = await this.repository.findExpenseById(expenseId);
    if (!expense) {
      throw new ExpenseDomainError('Expense not found.', 404);
    }

    if (expense.status === EXPENSE_STATUSES.VOIDED) {
      throw new ExpenseDomainError('Cannot edit or correct a voided expense.', 409);
    }

    if (expectedRevision && expense.revision !== expectedRevision) {
      throw new ExpenseDomainError('The expense was modified concurrently. Please refresh and try again.', 409);
    }

    const reimbursements = await this.repository.findReimbursementsByExpenseId(expenseId);
    const activeReimbursements = (reimbursements || []).filter((r) => r.status !== REIMBURSEMENT_STATUSES.VOIDED);

    const newTitle = changes.title !== undefined ? String(changes.title).trim() : expense.title;
    const newCategory = changes.category !== undefined ? changes.category : expense.category;
    const newDate = changes.date !== undefined ? changes.date : expense.date;
    const newDescription = changes.description !== undefined ? String(changes.description).trim() : expense.description;

    const newAmountPaise = changes.amountPaise !== undefined ? Number(changes.amountPaise) : expense.amountPaise;
    const newPaidByMemberId = changes.paidByMemberId !== undefined ? changes.paidByMemberId : expense.paidByMemberId;
    const newSplitType = changes.splitType !== undefined ? changes.splitType : expense.splitType;
    const newParticipants = changes.participants !== undefined ? changes.participants : (expense.allocations || []).map((a) => a.memberId);
    const newCustomAllocations = changes.customAllocations !== undefined ? changes.customAllocations : null;

    if (!isValidLogicalDate(newDate)) {
      throw new ExpenseDomainError('Expense date must be in valid YYYY-MM-DD format.', 400);
    }
    const newMonth = newDate.slice(0, 7);

    if (typeof newTitle !== 'string' || !newTitle || newTitle.length > MAX_EXPENSE_TITLE_LENGTH) {
      throw new ExpenseDomainError(`Title is required and must not exceed ${MAX_EXPENSE_TITLE_LENGTH} characters.`, 400);
    }

    if (!EXPENSE_CATEGORIES.includes(newCategory)) {
      throw new ExpenseDomainError(`Invalid expense category: ${newCategory}`, 400);
    }

    if (newDescription && newDescription.length > MAX_EXPENSE_NOTE_LENGTH) {
      throw new ExpenseDomainError(`Note must not exceed ${MAX_EXPENSE_NOTE_LENGTH} characters.`, 400);
    }

    // Determine if financial/attribution fields changed (date change is attribution-sensitive)
    const isFinancialChange =
      newAmountPaise !== expense.amountPaise ||
      newPaidByMemberId !== expense.paidByMemberId ||
      newSplitType !== expense.splitType ||
      newDate !== expense.date ||
      newMonth !== expense.month ||
      changes.participants !== undefined ||
      changes.customAllocations !== undefined;

    if (isFinancialChange && !expectedRevision) {
      throw new ExpenseDomainError('expectedRevision is required for financial corrections to prevent concurrent conflicts.', 400);
    }

    if (isFinancialChange && activeReimbursements.length > 0) {
      throw new ExpenseDomainError(
        'This Expense has recorded reimbursements. Financial details cannot be changed until the existing reimbursements are reconciled.',
        409,
      );
    }

    let finalAllocations = expense.allocations;
    let finalSplitType = expense.splitType;
    let finalAmountPaise = expense.amountPaise;

    if (isFinancialChange) {
      const splitResult = calculateExpenseSplit({
        amountPaise: newAmountPaise,
        paidByMemberId: newPaidByMemberId,
        splitType: newSplitType,
        participants: newParticipants,
        customAllocations: newCustomAllocations,
      });
      finalAllocations = splitResult.allocations;
      finalSplitType = splitResult.splitType;
      finalAmountPaise = splitResult.amountPaise;
    }

    const previousSnapshot = {
      title: expense.title,
      category: expense.category,
      date: expense.date,
      month: expense.month,
      amountPaise: expense.amountPaise,
      paidByMemberId: expense.paidByMemberId,
      splitType: expense.splitType,
      allocations: (expense.allocations || []).map((a) => ({ memberId: a.memberId, amountPaise: a.amountPaise })),
      description: expense.description || '',
    };

    const newSnapshot = {
      title: newTitle,
      category: newCategory,
      date: newDate,
      month: newMonth,
      amountPaise: finalAmountPaise,
      paidByMemberId: newPaidByMemberId,
      splitType: finalSplitType,
      allocations: finalAllocations,
      description: newDescription,
    };

    const correctionRecord = {
      correctionId: crypto.randomUUID(),
      correctedAt: new Date(),
      correctedByRole: actorRole,
      reason: reason.trim(),
      previousSnapshot,
      newSnapshot,
      revision: expense.revision,
    };

    const updateData = {
      title: newTitle,
      category: newCategory,
      date: newDate,
      month: newMonth,
      description: newDescription,
      amountPaise: finalAmountPaise,
      paidByMemberId: newPaidByMemberId,
      splitType: finalSplitType,
      allocations: finalAllocations,
    };

    let updated;
    if (typeof this.repository.executeAtomicExpenseCorrection === 'function') {
      try {
        updated = await this.repository.executeAtomicExpenseCorrection({
          expenseId,
          updateData,
          correctionRecord,
          expectedRevision,
          isFinancialChange,
        });
      } catch (err) {
        throw new ExpenseDomainError(err.message, err.statusCode || 400);
      }
    } else {
      updated = await this.repository.recordExpenseCorrection(expenseId, {
        updateData,
        correctionRecord,
        expectedRevision,
      });
    }

    if (!updated) {
      throw new ExpenseDomainError('The expense was modified concurrently. Please refresh and try again.', 409);
    }

    broadcastExpensesUpdated({
      scope: 'expenses',
      month: newMonth,
      revision: updated.revision,
    });
    if (newMonth !== expense.month) {
      broadcastExpensesUpdated({
        scope: 'expenses',
        month: expense.month,
        revision: updated.revision,
      });
    }

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
        if (
          existing.fromMemberId !== fromMemberId ||
          existing.amountPaise !== amountPaise ||
          existing.expenseId !== expenseId
        ) {
          throw new ExpenseDomainError(
            'Idempotency key has already been used with a different transaction payload.',
            409,
          );
        }
        return serializeReimbursement(existing);
      }
    }

    if (typeof this.repository.executeAtomicReimbursement === 'function') {
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
      const allocation = (expense.allocations || []).find((a) => a.memberId === fromMemberId);
      if (!allocation) {
        throw new ExpenseDomainError(`Member ${fromMemberId} is not a beneficiary of this expense.`, 400);
      }

      const reimbursementId = crypto.randomUUID();
      const newRevision = crypto.randomUUID();
      const reimbursementData = {
        reimbursementId,
        expenseId,
        expenseMonth: expense.month,
        fromMemberId,
        toMemberId: expense.paidByMemberId,
        amountPaise,
        method,
        reference: reference ? reference.trim() : null,
        idempotencyKey: idempotencyKey || undefined,
        status: REIMBURSEMENT_STATUSES.RECORDED,
        recordedAt: new Date(),
        recordedByRole: actorRole,
      };

      try {
        const created = await this.repository.executeAtomicReimbursement({
          expenseId,
          fromMemberId,
          amountPaise,
          reimbursementData,
          newRevision,
        });

        broadcastExpensesUpdated({
          scope: 'expenses',
          month: expense.month,
          revision: newRevision,
        });

        return serializeReimbursement(created);
      } catch (err) {
        if (err.statusCode) {
          throw new ExpenseDomainError(err.message, err.statusCode);
        }
        throw err;
      }
    }

    throw new ExpenseDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
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

    if (typeof this.repository.executeAtomicReimbursementVoid === 'function') {
      try {
        const updated = await this.repository.executeAtomicReimbursementVoid({
          reimbursementId,
          reason: reason.trim(),
          actorRole,
        });

        broadcastExpensesUpdated({
          scope: 'expenses',
          month: updated.expenseMonth,
          revision: new Date().toISOString(),
        });

        return serializeReimbursement(updated);
      } catch (err) {
        if (err.statusCode) {
          throw new ExpenseDomainError(err.message, err.statusCode);
        }
        throw err;
      }
    }

    throw new ExpenseDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
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
export const expenseService = defaultExpenseService;
