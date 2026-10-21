import { paiseToRupeeInput } from './money.js';

export function buildExpenseEditInitialValues(expense) {
  const customAmounts = { gaurav: '', nikhil: '', devansh: '' };
  for (const allocation of expense?.allocations || []) {
    if (Object.hasOwn(customAmounts, allocation.memberId)) {
      customAmounts[allocation.memberId] = paiseToRupeeInput(allocation.amountPaise);
    }
  }

  return {
    amountRupees: paiseToRupeeInput(expense?.amountPaise),
    customAmounts,
  };
}
