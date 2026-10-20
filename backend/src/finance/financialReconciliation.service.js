/**
 * MealKhata 2.0 - Financial Reconciliation Service
 * Validates exact integer-paise mathematical invariants across all 3 domains.
 */

export class FinancialReconciliationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FinancialReconciliationError';
    this.statusCode = 500;
    this.details = details;
  }
}

/**
 * Validates member-level unified financial invariants.
 *
 * @param {Object} memberOverview
 */
export function reconcileMemberFinances(memberOverview) {
  const { mess, room, expenses, combined } = memberOverview;

  // Invariant 1: Total outstanding payable must be exact sum of positive domain debts
  const expectedPayable = (mess?.remainingPaise || 0) + (room?.remainingPaise || 0) + (expenses?.owedToOthersPaise || 0);
  if (combined.outstandingPayablePaise !== expectedPayable) {
    throw new FinancialReconciliationError(
      `Member payable mismatch: combined (${combined.outstandingPayablePaise}) !== mess (${mess?.remainingPaise || 0}) + room (${room?.remainingPaise || 0}) + expense debt (${expenses?.owedToOthersPaise || 0})`,
      { expectedPayable, actual: combined.outstandingPayablePaise },
    );
  }

  // Invariant 2: Receivables must match money owed to this member from roommates
  const expectedReceivable = expenses?.owedToMePaise || 0;
  if (combined.receivablePaise !== expectedReceivable) {
    throw new FinancialReconciliationError(
      `Member receivable mismatch: combined (${combined.receivablePaise}) !== expense receivable (${expectedReceivable})`,
      { expectedReceivable, actual: combined.receivablePaise },
    );
  }

  // Invariant 3: Personal tracked cost must be sum of economic costs
  const expectedTrackedCost = (mess?.billPaise || 0) + (room?.issuedChargePaise || 0) + (expenses?.spendingSharePaise || 0);
  if (combined.personalTrackedCostPaise !== expectedTrackedCost) {
    throw new FinancialReconciliationError(
      `Member tracked cost mismatch: combined (${combined.personalTrackedCostPaise}) !== mess (${mess?.billPaise || 0}) + room (${room?.issuedChargePaise || 0}) + expense share (${expenses?.spendingSharePaise || 0})`,
      { expectedTrackedCost, actual: combined.personalTrackedCostPaise },
    );
  }

  return true;
}

/**
 * Validates household-level unified financial invariants.
 *
 * @param {Object} householdOverview
 */
export function reconcileHouseholdFinances(householdOverview) {
  const { trackedCosts, managedDues, roommateReimbursements, memberSummaries } = householdOverview;

  // Invariant 1: Household tracked cost must equal sum of domain costs
  const expectedTrackedCost =
    trackedCosts.messCostPaise + trackedCosts.roomFeesCostPaise + trackedCosts.otherExpensesCostPaise;
  if (trackedCosts.totalTrackedCostPaise !== expectedTrackedCost) {
    throw new FinancialReconciliationError(
      `Household tracked cost mismatch: total (${trackedCosts.totalTrackedCostPaise}) !== mess (${trackedCosts.messCostPaise}) + room (${trackedCosts.roomFeesCostPaise}) + expenses (${trackedCosts.otherExpensesCostPaise})`,
      { expectedTrackedCost, actual: trackedCosts.totalTrackedCostPaise },
    );
  }

  // Invariant 2: Managed dues must equal sum of external dues
  const expectedManagedDues = managedDues.messOutstandingPaise + managedDues.roomFeesOutstandingPaise;
  if (managedDues.totalManagedDuesPaise !== expectedManagedDues) {
    throw new FinancialReconciliationError(
      `Household managed dues mismatch: total (${managedDues.totalManagedDuesPaise}) !== mess (${managedDues.messOutstandingPaise}) + room (${managedDues.roomFeesOutstandingPaise})`,
      { expectedManagedDues, actual: managedDues.totalManagedDuesPaise },
    );
  }

  // Invariant 3: Sum of member spending shares must equal other expenses total
  const sumMemberExpenseShares = Object.values(memberSummaries).reduce(
    (sum, m) => sum + (m.expenses?.spendingSharePaise || 0),
    0,
  );
  if (sumMemberExpenseShares !== trackedCosts.otherExpensesCostPaise) {
    throw new FinancialReconciliationError(
      `Member expense shares sum (${sumMemberExpenseShares}) !== household other expenses (${trackedCosts.otherExpensesCostPaise})`,
      { sumMemberExpenseShares, householdExpenseCost: trackedCosts.otherExpensesCostPaise },
    );
  }

  // Invariant 4: Sum of member debts owed to others must equal sum of receivables owed to members
  const sumDebtsOwed = Object.values(memberSummaries).reduce(
    (sum, m) => sum + (m.expenses?.owedToOthersPaise || 0),
    0,
  );
  const sumReceivables = Object.values(memberSummaries).reduce(
    (sum, m) => sum + (m.expenses?.owedToMePaise || 0),
    0,
  );
  if (sumDebtsOwed !== sumReceivables) {
    throw new FinancialReconciliationError(
      `Roommate internal debt asymmetry: sum debts owed (${sumDebtsOwed}) !== sum receivables (${sumReceivables})`,
      { sumDebtsOwed, sumReceivables },
    );
  }

  // Invariant 5: Pending reimbursements must equal sum of internal debts
  if (roommateReimbursements.pendingReimbursementsPaise !== sumDebtsOwed) {
    throw new FinancialReconciliationError(
      `Pending reimbursements mismatch: report (${roommateReimbursements.pendingReimbursementsPaise}) !== sum debts (${sumDebtsOwed})`,
      { pending: roommateReimbursements.pendingReimbursementsPaise, sumDebtsOwed },
    );
  }

  return true;
}
