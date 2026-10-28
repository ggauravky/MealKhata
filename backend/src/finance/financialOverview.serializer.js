/**
 * MealKhata 2.0 - Financial Overview Serializer
 * Formats canonical DTOs for member and household financial overviews.
 */

import { FINANCIAL_CURRENCY, FINANCIAL_TIMEZONE } from './financialConstants.js';
import { MEMBERS } from '../config/members.js';

const MEMBER_MAP = new Map(MEMBERS.map((m) => [m.id, m]));

export function serializeMemberOverview(overview) {
  const memberConfig = MEMBER_MAP.get(overview.memberId) || { id: overview.memberId, name: overview.memberId };

  return {
    month: overview.month,
    currency: FINANCIAL_CURRENCY,
    timezone: FINANCIAL_TIMEZONE,
    generatedAt: overview.generatedAt || new Date().toISOString(),
    periodType: overview.periodType,
    member: {
      memberId: memberConfig.id,
      displayName: memberConfig.name,
      avatarColor: memberConfig.color || null,
    },
    mess: {
      billPaise: overview.mess.billPaise,
      paidPaise: overview.mess.paidPaise,
      remainingPaise: overview.mess.remainingPaise,
      overpaidPaise: overview.mess.overpaidPaise,
      status: overview.mess.status,
      isClosed: overview.mess.isClosed,
      projectedBillPaise: overview.mess.projectedBillPaise || null,
    },
    room: {
      chargeIssued: overview.room.chargeIssued,
      issuedChargePaise: overview.room.issuedChargePaise,
      paidPaise: overview.room.paidPaise,
      remainingPaise: overview.room.remainingPaise,
      overpaidPaise: overview.room.overpaidPaise,
      status: overview.room.status,
      dueDate: overview.room.dueDate,
      roomNumber: overview.room.roomNumber,
      scheduledFeePaise: overview.room.scheduledFeePaise,
    },
    expenses: {
      spendingSharePaise: overview.expenses.spendingSharePaise,
      merchantSpendingPaise: overview.expenses.merchantSpendingPaise,
      owedToOthersPaise: overview.expenses.owedToOthersPaise,
      owedToMePaise: overview.expenses.owedToMePaise,
      debtsOwed: overview.expenses.debtsOwed || [],
      receivables: overview.expenses.receivables || [],
    },
    combined: {
      outstandingPayablePaise: overview.combined.outstandingPayablePaise,
      receivablePaise: overview.combined.receivablePaise,
      personalTrackedCostPaise: overview.combined.personalTrackedCostPaise,
      overallStatus: overview.combined.overallStatus,
      unallocatedCreditPaise: overview.combined.unallocatedCreditPaise || 0,
      financialRelationshipSettled: overview.combined.financialRelationshipSettled !== false,
    },
    credits: {
      unallocatedCreditPaise: overview.credits?.unallocatedCreditPaise || 0,
      unresolvedItems: overview.credits?.unresolvedItems || [],
    },
  };
}

export function serializeHouseholdOverview(overview) {
  const serializedMemberSummaries = {};
  for (const [memberId, memberData] of Object.entries(overview.memberSummaries)) {
    serializedMemberSummaries[memberId] = serializeMemberOverview(memberData);
  }

  return {
    month: overview.month,
    currency: FINANCIAL_CURRENCY,
    timezone: FINANCIAL_TIMEZONE,
    generatedAt: overview.generatedAt || new Date().toISOString(),
    periodType: overview.periodType,
    isMessClosed: overview.isMessClosed,
    trackedCosts: {
      messCostPaise: overview.trackedCosts.messCostPaise,
      roomFeesCostPaise: overview.trackedCosts.roomFeesCostPaise,
      otherExpensesCostPaise: overview.trackedCosts.otherExpensesCostPaise,
      totalTrackedCostPaise: overview.trackedCosts.totalTrackedCostPaise,
    },
    managedDues: {
      messOutstandingPaise: overview.managedDues.messOutstandingPaise,
      roomFeesOutstandingPaise: overview.managedDues.roomFeesOutstandingPaise,
      totalManagedDuesPaise: overview.managedDues.totalManagedDuesPaise,
      messCollectedPaise: overview.managedDues.messCollectedPaise,
      roomFeesCollectedPaise: overview.managedDues.roomFeesCollectedPaise,
    },
    roommateReimbursements: {
      pendingReimbursementsPaise: overview.roommateReimbursements.pendingReimbursementsPaise,
      settledReimbursementsPaise: overview.roommateReimbursements.settledReimbursementsPaise,
    },
    credits: {
      unallocatedCreditPaise: overview.credits?.unallocatedCreditPaise || 0,
    },
    memberSummaries: serializedMemberSummaries,
    expenseCategories: overview.expenseCategories || [],
    actionableAttention: overview.actionableAttention || [],
  };
}
