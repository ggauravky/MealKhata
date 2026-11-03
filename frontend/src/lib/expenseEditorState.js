import { paiseToRupeeInput } from './money.js';

export function buildExpenseEditInitialValues(expense) {
  const customAmounts = {};
  for (const allocation of expense?.allocations || []) {
    customAmounts[allocation.memberId] = paiseToRupeeInput(allocation.amountPaise);
  }

  return {
    amountRupees: paiseToRupeeInput(expense?.amountPaise),
    customAmounts,
  };
}
