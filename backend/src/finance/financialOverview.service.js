/**
 * MealKhata 2.0 - Financial Overview Service
 * Authoritative read-only composition service joining Mess, Room Fees, and Other Expenses.
 */

import { MEMBER_IDS, MEMBERS } from '../config/members.js';
import { ROLES } from '../auth/permissions.js';
import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalMonth, compareLogicalMonths } from '../utils/month.js';
import { getLogicalDateInTimeZone } from '../utils/date.js';
import { FINANCIAL_TIMEZONE, OVERALL_PAYMENT_STATUSES } from './financialConstants.js';
import { reconcileMemberFinances, reconcileHouseholdFinances } from './financialReconciliation.service.js';
import { serializeMemberOverview, serializeHouseholdOverview } from './financialOverview.serializer.js';

import { paymentSummaryService as defaultPaymentSummaryService } from '../payments/paymentSummary.service.js';
import { reportService as defaultReportService } from '../reports/report.service.js';
import { settlementService as defaultSettlementService } from '../settlement/settlement.service.js';
import { roomFeeService as defaultRoomFeeService } from '../roomFees/roomFee.service.js';
import { defaultExpenseService } from '../expenses/expense.service.js';
import { UnallocatedCredit } from '../stays/paymentReclassification.model.js';

const databaseCreditReader = Object.freeze({
  listOpenForMember(memberId) {
    return UnallocatedCredit.find({ memberId, status: 'OPEN' }).sort({ paymentDate: 1 }).lean();
  },
});

export function createFinancialOverviewService({
  paymentSummaries = defaultPaymentSummaryService,
  reports = defaultReportService,
  settlements = defaultSettlementService,
  roomFees = defaultRoomFeeService,
  expenses = defaultExpenseService,
  creditReader = { listOpenForMember: async () => [] },
  now = () => new Date(),
  timezone = FINANCIAL_TIMEZONE,
} = {}) {
  function getPeriodType(month) {
    const today = getLogicalDateInTimeZone(now(), timezone);
    const currentMonth = today.slice(0, 7);
    const comparison = compareLogicalMonths(month, currentMonth);
    return comparison < 0 ? 'past' : comparison > 0 ? 'future' : 'current';
  }

  return Object.freeze({
    /**
     * Get authoritative financial overview for an individual member in a specific month.
     */
    async getMemberFinancialOverview({ memberId, month, actorRole }) {
      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'Month must be in YYYY-MM format.');
      }
      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, `Invalid member ID: ${memberId}`);
      }

      const periodType = getPeriodType(month);

      // Concurrently query the 3 authoritative domain services
      const [isMessClosed, activeSettlement, messSummary, roomOverview, expenseSummary, expenseList, credits] =
        await Promise.all([
          settlements.isMonthClosed(month),
          settlements.getActiveSettlement(month),
          paymentSummaries.getSummary(month),
          roomFees.getMemberOverview({ memberId, targetMonth: month }),
          expenses.getMemberExpenseSummary(month, memberId),
          expenses.listExpensesByMonth(month, { actorRole: ROLES.ADMIN, actorMemberId: memberId }),
          creditReader.listOpenForMember(memberId),
        ]);

      // 1. Mess Domain
      let messBillPaise = 0;
      let messPaidPaise = 0;
      let messRemainingPaise = 0;
      let messOverpaidPaise = 0;
      let messStatus = OVERALL_PAYMENT_STATUSES.NO_DUE;
      let projectedBillPaise = null;

      if (isMessClosed && activeSettlement?.snapshot?.members?.[memberId]) {
        const snap = activeSettlement.snapshot.members[memberId];
        messBillPaise = snap.billAmountPaise || 0;
        messPaidPaise = snap.paidAmountPaise || 0;
        messRemainingPaise = snap.remainingAmountPaise || 0;
        messOverpaidPaise = snap.overpaidAmountPaise || 0;
        messStatus = 'closed';
      } else if (messSummary?.members?.[memberId]) {
        const mm = messSummary.members[memberId];
        messBillPaise = mm.billAmountPaise || 0;
        messPaidPaise = mm.paidAmountPaise || 0;
        messRemainingPaise = mm.remainingAmountPaise || 0;
        messOverpaidPaise = mm.overpaidAmountPaise || 0;
        messStatus = mm.status;
        projectedBillPaise = mm.projectedBillAmountPaise || null;
      }

      // 2. Room Fees Domain
      let chargeIssued = false;
      let roomIssuedChargePaise = 0;
      let roomPaidPaise = 0;
      let roomRemainingPaise = 0;
      let roomOverpaidPaise = 0;
      let roomStatus = OVERALL_PAYMENT_STATUSES.NOT_ISSUED;
      let roomDueDate = null;
      let roomNumber = roomOverview?.currentRoom?.roomNumber || null;
      const scheduledFeePaise = roomOverview?.scheduledFeePaise || null;

      const currentCharge = roomOverview?.currentMonthCharge;
      if (currentCharge && currentCharge.status !== 'cancelled') {
        chargeIssued = true;
        roomIssuedChargePaise = currentCharge.finalBillAmountPaise || 0;
        roomPaidPaise = currentCharge.paidAmountPaise || 0;
        roomRemainingPaise = currentCharge.remainingAmountPaise || 0;
        roomOverpaidPaise = currentCharge.overpaidAmountPaise || 0;
        roomStatus = currentCharge.paymentStatus;
        roomDueDate = currentCharge.dueDate;
        roomNumber = currentCharge.roomNumber || roomNumber;
      }

      // 3. Other Expenses Domain
      const spendingSharePaise = expenseSummary?.spendingSharePaise || 0;
      const merchantSpendingPaise = expenseSummary?.merchantSpendingPaise || 0;
      const owedToOthersPaise = expenseSummary?.owedToOthersPaise || 0;
      const owedToMePaise = expenseSummary?.owedToMePaise || 0;

      // Extract specific itemized debts and receivables for detailed view
      const debtsOwed = [];
      const receivables = [];

      for (const exp of expenseList || []) {
        if (exp.status === 'voided') continue;

        // Is member a debtor to the payer?
        if (exp.paidByMemberId !== memberId) {
          const alloc = (exp.allocations || []).find((a) => a.memberId === memberId);
          if (alloc) {
            const memberShare = exp.memberShares?.find((s) => s.memberId === memberId);
            const remaining = memberShare ? memberShare.remainingOwedPaise : alloc.amountPaise;
            if (remaining > 0) {
              debtsOwed.push({
                expenseId: exp.expenseId,
                title: exp.title,
                date: exp.date,
                category: exp.category,
                toMemberId: exp.paidByMemberId,
                amountPaise: remaining,
              });
            }
          }
        }

        // Is member the merchant payer who is owed reimbursements?
        if (exp.paidByMemberId === memberId) {
          for (const share of exp.memberShares || []) {
            if (share.memberId !== memberId && share.remainingOwedPaise > 0) {
              receivables.push({
                expenseId: exp.expenseId,
                title: exp.title,
                date: exp.date,
                category: exp.category,
                fromMemberId: share.memberId,
                amountPaise: share.remainingOwedPaise,
              });
            }
          }
        }
      }

      // 4. Canonical Combined Totals (Section 7)
      const outstandingPayablePaise = messRemainingPaise + roomRemainingPaise + owedToOthersPaise;
      const receivablePaise = owedToMePaise;
      const personalTrackedCostPaise = messBillPaise + roomIssuedChargePaise + spendingSharePaise;
      const unallocatedCreditPaise = credits.reduce(
        (sum, credit) => sum + (credit.remainingAmountPaise || 0),
        0,
      );

      let overallStatus = OVERALL_PAYMENT_STATUSES.PENDING;
      if (outstandingPayablePaise === 0) {
        overallStatus = personalTrackedCostPaise > 0 ? OVERALL_PAYMENT_STATUSES.PAID : OVERALL_PAYMENT_STATUSES.NO_DUE;
      } else if (messPaidPaise > 0 || roomPaidPaise > 0) {
        overallStatus = OVERALL_PAYMENT_STATUSES.PARTIAL;
      }

      const rawOverview = {
        memberId,
        month,
        periodType,
        generatedAt: now().toISOString(),
        mess: {
          billPaise: messBillPaise,
          paidPaise: messPaidPaise,
          remainingPaise: messRemainingPaise,
          overpaidPaise: messOverpaidPaise,
          status: messStatus,
          isClosed: isMessClosed,
          projectedBillPaise,
        },
        room: {
          chargeIssued,
          issuedChargePaise: roomIssuedChargePaise,
          paidPaise: roomPaidPaise,
          remainingPaise: roomRemainingPaise,
          overpaidPaise: roomOverpaidPaise,
          status: roomStatus,
          dueDate: roomDueDate,
          roomNumber,
          scheduledFeePaise,
        },
        expenses: {
          spendingSharePaise,
          merchantSpendingPaise,
          owedToOthersPaise,
          owedToMePaise,
          debtsOwed,
          receivables,
        },
        combined: {
          outstandingPayablePaise,
          receivablePaise,
          personalTrackedCostPaise,
          overallStatus,
          unallocatedCreditPaise,
          financialRelationshipSettled: outstandingPayablePaise === 0 && unallocatedCreditPaise === 0,
        },
        credits: {
          unallocatedCreditPaise,
          unresolvedItems: credits.map((credit) => ({
            code: 'UNALLOCATED_CREDIT_PENDING',
            creditId: credit.creditId,
            amountPaise: credit.remainingAmountPaise,
            sourceDepositTransactionId: credit.sourceDepositTransactionId,
          })),
        },
      };

      // Exact mathematical check before returning
      reconcileMemberFinances(rawOverview);

      return serializeMemberOverview(rawOverview);
    },

    /**
     * Get authoritative financial overview for the entire household in a specific month.
     */
    async getHouseholdFinancialOverview({ month, actorRole }) {
      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'Month must be in YYYY-MM format.');
      }

      const periodType = getPeriodType(month);

      // Concurrently query domain services and individual member overviews
      const [isMessClosed, activeSettlement, messSummary, roomSummary, expenseSummary, ...memberOverviews] =
        await Promise.all([
          settlements.isMonthClosed(month),
          settlements.getActiveSettlement(month),
          paymentSummaries.getSummary(month),
          roomFees.getMonthlySummary(month, actorRole),
          expenses.getHouseholdExpenseSummary(month, { actorRole }),
          ...MEMBER_IDS.map((memberId) => this.getMemberFinancialOverview({ memberId, month, actorRole })),
        ]);

      // 1. Household Mess Numbers
      let messCostPaise = 0;
      let messCollectedPaise = 0;
      let messOutstandingPaise = 0;

      if (isMessClosed && activeSettlement?.snapshot?.room) {
        const snapRoom = activeSettlement.snapshot.room;
        messCostPaise = snapRoom.billAmountPaise || 0;
        messCollectedPaise = snapRoom.paidAmountPaise || 0;
        messOutstandingPaise = snapRoom.remainingAmountPaise || 0;
      } else if (messSummary?.room) {
        messCostPaise = messSummary.room.billAmountPaise || 0;
        messCollectedPaise = messSummary.room.paidAmountPaise || 0;
        messOutstandingPaise = messSummary.room.remainingAmountPaise || 0;
      }

      // 2. Household Room Fee Numbers
      const roomFeesCostPaise = roomSummary?.totalBilledPaise || 0;
      const roomFeesCollectedPaise = roomSummary?.totalCollectedPaise || 0;
      const roomFeesOutstandingPaise = roomSummary?.totalOutstandingPaise || 0;

      // 3. Household Other Expenses Numbers
      const otherExpensesCostPaise = expenseSummary?.totalExpensesPaise || 0;
      const pendingReimbursementsPaise = expenseSummary?.totalOutstandingReimbursementsPaise || 0;
      const settledReimbursementsPaise = expenseSummary?.totalReimbursementsPaidPaise || 0;

      // 4. Combined Household Totals (Section 10)
      const totalTrackedCostPaise = messCostPaise + roomFeesCostPaise + otherExpensesCostPaise;
      const totalManagedDuesPaise = messOutstandingPaise + roomFeesOutstandingPaise;
      const unallocatedCreditPaise = memberOverviews.reduce(
        (sum, member) => sum + (member.credits?.unallocatedCreditPaise || 0),
        0,
      );

      // Member summaries keyed by memberId
      const memberSummaries = {};
      for (const m of memberOverviews) {
        memberSummaries[m.member.memberId] = m;
      }

      // Actionable attention items derived strictly from active numbers
      const actionableAttention = [];
      if (roomFeesOutstandingPaise > 0) {
        const owingMembers = memberOverviews.filter((m) => m.room.remainingPaise > 0);
        actionableAttention.push({
          type: 'room_fees_due',
          count: owingMembers.length,
          amountPaise: roomFeesOutstandingPaise,
          message: `${owingMembers.length} member(s) have unpaid Room Fee dues totaling ₹${(roomFeesOutstandingPaise / 100).toFixed(2)}.`,
        });
      }
      if (pendingReimbursementsPaise > 0) {
        actionableAttention.push({
          type: 'reimbursements_pending',
          amountPaise: pendingReimbursementsPaise,
          message: `₹${(pendingReimbursementsPaise / 100).toFixed(2)} in roommate reimbursements remains pending.`,
        });
      }
      if (messOutstandingPaise > 0) {
        const owingMembers = memberOverviews.filter((m) => m.mess.remainingPaise > 0);
        actionableAttention.push({
          type: 'mess_due',
          count: owingMembers.length,
          amountPaise: messOutstandingPaise,
          message: `${owingMembers.length} member(s) have Mess dues totaling ₹${(messOutstandingPaise / 100).toFixed(2)}.`,
        });
      }
      if (unallocatedCreditPaise > 0) {
        actionableAttention.push({
          type: 'unallocated_credit_pending',
          amountPaise: unallocatedCreditPaise,
          message: `₹${(unallocatedCreditPaise / 100).toFixed(2)} in resident credit remains unapplied.`,
        });
      }

      // Category breakdown for expenses
      const expenseCategories = Object.entries(expenseSummary?.categoryBreakdown || {}).map(
        ([cat, data]) => ({
          category: cat,
          count: data.count,
          amountPaise: data.totalPaise,
        }),
      );

      const rawHousehold = {
        month,
        periodType,
        isMessClosed,
        generatedAt: now().toISOString(),
        trackedCosts: {
          messCostPaise,
          roomFeesCostPaise,
          otherExpensesCostPaise,
          totalTrackedCostPaise,
        },
        managedDues: {
          messOutstandingPaise,
          roomFeesOutstandingPaise,
          totalManagedDuesPaise,
          messCollectedPaise,
          roomFeesCollectedPaise,
        },
        roommateReimbursements: {
          pendingReimbursementsPaise,
          settledReimbursementsPaise,
        },
        credits: { unallocatedCreditPaise },
        memberSummaries,
        expenseCategories,
        actionableAttention,
      };

      // Exact mathematical check before returning
      reconcileHouseholdFinances(rawHousehold);

      return serializeHouseholdOverview(rawHousehold);
    },
  });
}

export const financialOverviewService = createFinancialOverviewService({ creditReader: databaseCreditReader });
