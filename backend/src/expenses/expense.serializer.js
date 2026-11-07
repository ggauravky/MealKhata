import { EXPENSE_CATEGORY_LABELS } from './expense.constants.js';

/**
 * Computes exact member-wise debts, remaining balances, and status for one expense.
 */
export function computeExpenseFinancials({ expense, reimbursements = [] }) {
  const activeReimbursements = (reimbursements || []).filter((r) => r.status !== 'voided');
  const payerId = expense.paidByMemberId;
  const isVoided = expense.status === 'voided';

  // Map allocations with debt and payment tracking
  let totalInitialReceivablePaise = 0;
  let totalReimbursedReceivedPaise = 0;

  const memberShares = (expense.allocations || []).map((alloc) => {
    const isPayer = alloc.memberId === payerId;
    const sharePaise = alloc.amountPaise;
    const initialOwedPaise = isPayer ? 0 : sharePaise;

    // Sum active reimbursements from this member for this expense
    const reimbursedPaise = activeReimbursements
      .filter((r) => r.fromMemberId === alloc.memberId)
      .reduce((sum, r) => sum + r.amountPaise, 0);

    const remainingOwedPaise = Math.max(0, initialOwedPaise - reimbursedPaise);

    if (!isPayer) {
      totalInitialReceivablePaise += initialOwedPaise;
      totalReimbursedReceivedPaise += reimbursedPaise;
    }

    let settlementStatus = 'unsettled';
    if (isPayer) {
      settlementStatus = 'payer';
    } else if (initialOwedPaise === 0) {
      settlementStatus = 'no_reimbursement_needed';
    } else if (remainingOwedPaise === 0) {
      settlementStatus = 'fully_reimbursed';
    } else if (reimbursedPaise > 0) {
      settlementStatus = 'partially_reimbursed';
    }

    return {
      memberId: alloc.memberId,
      sharePaise,
      isPayer,
      initialOwedPaise,
      reimbursedPaise,
      remainingOwedPaise,
      settlementStatus,
      isFullyReimbursed: initialOwedPaise > 0 && remainingOwedPaise === 0,
    };
  });

  const totalOutstandingReceivablePaise = Math.max(
    0,
    totalInitialReceivablePaise - totalReimbursedReceivedPaise,
  );

  let derivedStatus;
  if (isVoided) {
    derivedStatus = 'voided';
  } else if (totalInitialReceivablePaise === 0) {
    derivedStatus = 'no_reimbursement_needed';
  } else if (totalOutstandingReceivablePaise === 0) {
    derivedStatus = 'fully_reimbursed';
  } else if (totalReimbursedReceivedPaise > 0) {
    derivedStatus = 'partially_reimbursed';
  } else {
    derivedStatus = 'unsettled';
  }

  return {
    memberShares,
    totalInitialReceivablePaise,
    totalReimbursedReceivedPaise,
    totalOutstandingReceivablePaise,
    derivedStatus,
  };
}

export function serializeExpense({ expense, reimbursements = [], currentMemberId = null, role = 'member' }) {
  if (!expense) return null;

  const financials = computeExpenseFinancials({ expense, reimbursements });

  // Member-specific perspective if requested by a member
  let myPerspective = null;
  if (currentMemberId) {
    const myShareItem = financials.memberShares.find((m) => m.memberId === currentMemberId);
    const isPayer = expense.paidByMemberId === currentMemberId;

    myPerspective = {
      isPayer,
      isBeneficiary: Boolean(myShareItem),
      mySharePaise: myShareItem?.sharePaise || 0,
      iOwePayerPaise: isPayer ? 0 : (myShareItem?.remainingOwedPaise || 0),
      iReimbursedPaise: isPayer ? 0 : (myShareItem?.reimbursedPaise || 0),
      owedToMePaise: isPayer ? financials.totalOutstandingReceivablePaise : 0,
      reimbursedToMePaise: isPayer ? financials.totalReimbursedReceivedPaise : 0,
    };
  }

  return {
    expenseId: expense.expenseId,
    date: expense.date,
    month: expense.month,
    title: expense.title,
    category: expense.category,
    categoryLabel: EXPENSE_CATEGORY_LABELS[expense.category] || expense.category,
    description: expense.description || '',
    amountPaise: expense.amountPaise,
    paidByMemberId: expense.paidByMemberId,
    splitType: expense.splitType,
    allocations: (expense.allocations || []).map((a) => ({
      memberId: a.memberId,
      amountPaise: a.amountPaise,
    })),
    status: expense.status,
    financials,
    derivedStatus: financials.derivedStatus,
    memberShares: financials.memberShares,
    totalInitialReceivablePaise: financials.totalInitialReceivablePaise,
    totalReimbursedReceivedPaise: financials.totalReimbursedReceivedPaise,
    totalOutstandingReceivablePaise: financials.totalOutstandingReceivablePaise,
    myPerspective,
    reimbursements: (reimbursements || []).map(serializeReimbursement),
    idempotencyKey: expense.idempotencyKey || null,
    createdByRole: expense.createdByRole,
    createdAt: expense.createdAt?.toISOString ? expense.createdAt.toISOString() : expense.createdAt,
    voidedAt: expense.voidedAt?.toISOString ? expense.voidedAt.toISOString() : expense.voidedAt,
    voidedByRole: expense.voidedByRole || null,
    voidReason: expense.voidReason || null,
    corrections: (expense.corrections || []).map((c) => ({
      correctionId: c.correctionId,
      correctedAt: c.correctedAt?.toISOString ? c.correctedAt.toISOString() : c.correctedAt,
      correctedByRole: c.correctedByRole,
      reason: c.reason,
      previousSnapshot: c.previousSnapshot,
    })),
    revision: expense.revision,
  };
}

export function serializeReimbursement(r) {
  if (!r) return null;
  return {
    reimbursementId: r.reimbursementId,
    expenseId: r.expenseId,
    expenseMonth: r.expenseMonth,
    fromMemberId: r.fromMemberId,
    toMemberId: r.toMemberId,
    amountPaise: r.amountPaise,
    method: r.method,
    reference: r.reference || null,
    fundingSource: r.fundingSource || 'CASH_RECEIPT',
    sourceCreditAllocationId: r.sourceCreditAllocationId || null,
    status: r.status,
    recordedAt: r.recordedAt?.toISOString ? r.recordedAt.toISOString() : r.recordedAt,
    recordedByRole: r.recordedByRole,
    voidedAt: r.voidedAt?.toISOString ? r.voidedAt.toISOString() : r.voidedAt,
    voidedByRole: r.voidedByRole || null,
    voidReason: r.voidReason || null,
  };
}
