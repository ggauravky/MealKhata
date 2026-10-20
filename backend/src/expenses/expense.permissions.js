export function canViewHouseholdExpenses(role) {
  return role === 'admin' || role === 'superadmin';
}

export function canCreateExpense(role) {
  return role === 'admin' || role === 'superadmin';
}

export function canRecordReimbursement(role) {
  return role === 'admin' || role === 'superadmin';
}

export function canVoidExpense(role) {
  return role === 'superadmin';
}

export function canVoidReimbursement(role) {
  return role === 'superadmin';
}

/**
 * Strict server-side involvement check for Member privacy.
 * A member can only read an expense if they are the merchant payer or an allocation beneficiary.
 */
export function canMemberAccessExpense(memberId, expense) {
  if (!memberId || !expense) return false;
  if (expense.paidByMemberId === memberId) return true;
  if (Array.isArray(expense.allocations)) {
    return expense.allocations.some((a) => a.memberId === memberId);
  }
  return false;
}
