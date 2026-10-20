import { MEMBERS } from '../config/members.js';
import { isSafeIntegerPaise, SPLIT_TYPES } from './expense.constants.js';

const VALID_MEMBER_IDS = new Set(MEMBERS.map((m) => m.id));

export class ExpenseSplitError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ExpenseSplitError';
    this.statusCode = statusCode;
  }
}

/**
 * Pure calculation function for splitting expenses and deriving obligations.
 *
 * @param {Object} params
 * @param {number} params.amountPaise - Total purchase amount in integer paise.
 * @param {string} params.paidByMemberId - ID of member who paid the merchant.
 * @param {'equal'|'personal'|'custom'} params.splitType - Method of splitting.
 * @param {string[]} [params.participants] - Member IDs for equal or personal split.
 * @param {Array<{memberId: string, amountPaise: number}>} [params.customAllocations] - Specific amounts for custom split.
 * @returns {{
 *   amountPaise: number,
 *   splitType: string,
 *   allocations: Array<{memberId: string, amountPaise: number}>,
 *   reimbursementObligations: Array<{
 *     memberId: string,
 *     sharePaise: number,
 *     owesPayerPaise: number,
 *     payerMemberId: string
 *   }>,
 *   totalInitialReceivablePaise: number
 * }}
 */
export function calculateExpenseSplit({
  amountPaise,
  paidByMemberId,
  splitType,
  participants = [],
  customAllocations = [],
}) {
  if (!isSafeIntegerPaise(amountPaise)) {
    throw new ExpenseSplitError('Expense amount must be a positive integer in paise.', 400);
  }

  if (!VALID_MEMBER_IDS.has(paidByMemberId)) {
    throw new ExpenseSplitError(`Invalid merchant payer member ID: ${paidByMemberId}`, 400);
  }

  if (!SPLIT_TYPES.includes(splitType)) {
    throw new ExpenseSplitError(`Invalid split type: ${splitType}`, 400);
  }

  let allocations = [];

  if (splitType === 'personal') {
    if (!Array.isArray(participants) || participants.length !== 1) {
      throw new ExpenseSplitError('Personal expense requires exactly one beneficiary.', 400);
    }
    const targetMemberId = participants[0];
    if (!VALID_MEMBER_IDS.has(targetMemberId)) {
      throw new ExpenseSplitError(`Invalid beneficiary member ID: ${targetMemberId}`, 400);
    }
    allocations = [{ memberId: targetMemberId, amountPaise }];
  } else if (splitType === 'equal') {
    if (!Array.isArray(participants) || participants.length === 0) {
      throw new ExpenseSplitError('Equal split requires at least one participating member.', 400);
    }

    if (new Set(participants).size !== participants.length) {
      throw new ExpenseSplitError('Duplicate participants are not allowed in split.', 400);
    }

    for (const id of participants) {
      if (!VALID_MEMBER_IDS.has(id)) {
        throw new ExpenseSplitError(`Invalid participant member ID: ${id}`, 400);
      }
    }

    // Sort participants in canonical order (matching MEMBERS)
    const sorted = MEMBERS.filter((m) => participants.includes(m.id)).map((m) => m.id);

    const count = sorted.length;
    const baseShare = Math.floor(amountPaise / count);
    const remainder = amountPaise % count;

    allocations = sorted.map((memberId, index) => {
      const share = baseShare + (index < remainder ? 1 : 0);
      return { memberId, amountPaise: share };
    });
  } else if (splitType === 'custom') {
    if (!Array.isArray(customAllocations) || customAllocations.length === 0) {
      throw new ExpenseSplitError('Custom split requires non-empty allocations.', 400);
    }

    const seenMembers = new Set();
    let sum = 0;

    for (const alloc of customAllocations) {
      if (!alloc || !VALID_MEMBER_IDS.has(alloc.memberId)) {
        throw new ExpenseSplitError(`Invalid member ID in custom allocation: ${alloc?.memberId}`, 400);
      }
      if (seenMembers.has(alloc.memberId)) {
        throw new ExpenseSplitError(`Duplicate member in custom allocation: ${alloc.memberId}`, 400);
      }
      seenMembers.add(alloc.memberId);

      if (!isSafeIntegerPaise(alloc.amountPaise)) {
        throw new ExpenseSplitError(
          `Allocation for ${alloc.memberId} must be a positive integer in paise.`,
          400,
        );
      }
      sum += alloc.amountPaise;
    }

    if (sum !== amountPaise) {
      const diffPaise = Math.abs(amountPaise - sum);
      const diffRupees = (diffPaise / 100).toFixed(2);
      if (sum < amountPaise) {
        throw new ExpenseSplitError(
          `Allocated amounts must total ₹${(amountPaise / 100).toFixed(2)}. ₹${diffRupees} remains unallocated.`,
          400,
        );
      } else {
        throw new ExpenseSplitError(
          `Allocated amounts total ₹${(sum / 100).toFixed(2)}, which exceeds expense total by ₹${diffRupees}.`,
          400,
        );
      }
    }

    // Order canonical
    allocations = MEMBERS.filter((m) => seenMembers.has(m.id)).map((m) => ({
      memberId: m.id,
      amountPaise: customAllocations.find((a) => a.memberId === m.id).amountPaise,
    }));
  }

  // Exact Sum Invariant Check
  const totalAllocated = allocations.reduce((acc, a) => acc + a.amountPaise, 0);
  if (totalAllocated !== amountPaise) {
    throw new ExpenseSplitError(
      `Internal math error: total allocated (${totalAllocated}) does not match expense amount (${amountPaise})`,
      500,
    );
  }

  // Derive initial reimbursement obligations
  let totalInitialReceivablePaise = 0;
  const reimbursementObligations = [];

  for (const alloc of allocations) {
    if (alloc.memberId !== paidByMemberId && alloc.amountPaise > 0) {
      totalInitialReceivablePaise += alloc.amountPaise;
      reimbursementObligations.push({
        fromMemberId: alloc.memberId,
        toMemberId: paidByMemberId,
        amountPaise: alloc.amountPaise,
      });
    }
  }

  return {
    amountPaise,
    splitType,
    allocations,
    reimbursementObligations,
    totalInitialReceivablePaise,
  };
}
