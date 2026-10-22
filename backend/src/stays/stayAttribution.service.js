/**
 * MealKhata 2.0 - Stay Financial Attribution Service
 * Provides canonical, obligation-level financial attribution isolated by individual hostel stays.
 * Resolves the issue where calendar months bundle multiple stays together.
 */

import { getLogicalDateInTimeZone } from '../utils/date.js';
import { lastDateOfMonth } from '../utils/month.js';
import { stayRepository as defaultStayRepository } from './stay.repository.js';
import { financialOverviewService as defaultFinancialOverviewService } from '../finance/financialOverview.service.js';
import { depositService as defaultDepositService } from './deposit.service.js';
import { defaultExpenseService } from '../expenses/expense.service.js';
import { defaultExpenseRepository } from '../expenses/expense.repository.js';
import { roomFeeService as defaultRoomFeeService } from '../roomFees/roomFee.service.js';
import { roomRepository as defaultRoomFeeRepository } from '../roomFees/room.repository.js';
import { mealRepository as defaultMealRepository } from '../meals/meal.repository.js';
import { STAY_STATUSES } from './stay.constants.js';

export function getMonthsRange(startMonth, endMonth) {
  const months = [];
  let current = startMonth;
  while (current <= endMonth) {
    months.push(current);
    const [yStr, mStr] = current.split('-');
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    current = `${y}-${String(m).padStart(2, '0')}`;
  }
  return months;
}

export function createStayAttributionService({
  stayRepo = defaultStayRepository,
  finance = defaultFinancialOverviewService,
  deposits = defaultDepositService,
  expenses = defaultExpenseService,
  expenseRepo = defaultExpenseRepository,
  roomFees = defaultRoomFeeService,
  roomRepo = defaultRoomFeeRepository,
  mealRepo = defaultMealRepository,
} = {}) {
  return {
    /**
     * Compute stay-isolated financial attribution across all domains (Mess, Room Fees, Other Expenses, Security Deposit).
     */
    async getStayAttributedFinances({ stayId, session = null, actorRole = 'admin' }) {
      const stay = await stayRepo.findStayById(stayId, { session });
      if (!stay) {
        const err = new Error('Hostel stay not found.');
        err.statusCode = 404;
        throw err;
      }

      const memberId = stay.memberId;
      const todayDate = getLogicalDateInTimeZone(new Date(), 'Asia/Kolkata');
      const startMonth = stay.joinedOn.slice(0, 7);
      const effectiveEndDate = stay.actualLeftOn || todayDate;
      const endMonth = effectiveEndDate.slice(0, 7);

      const months = getMonthsRange(startMonth, endMonth);

      // Check if this member has other stays that overlap with any of these months
      const allMemberStays = await stayRepo.findStaysByMember(memberId, { session });
      const otherStays = (allMemberStays || []).filter(
        (s) => s.stayId !== stayId && s.status !== STAY_STATUSES.CANCELLED,
      );

      // Check if any month in the range intersects another stay of the same member
      const isMultiStayMonth = (month) => {
        return otherStays.some((s) => {
          const sFrom = s.joinedOn.slice(0, 7);
          const sTo = (s.actualLeftOn || '9999-12').slice(0, 7);
          return month >= sFrom && month <= sTo;
        });
      };

      const monthlySummaries = [];
      const outstandingObligations = [];
      const attributionWarnings = [];
      const warningKeys = new Set();
      const addWarning = (warning) => {
        const key = `${warning.domain}:${warning.month}:${warning.code}`;
        if (!warningKeys.has(key)) {
          warningKeys.add(key);
          attributionWarnings.push(warning);
        }
      };

      let totalMessBilledPaise = 0;
      let totalMessPaidPaise = 0;
      let totalMessRemainingPaise = 0;

      let totalRoomBilledPaise = 0;
      let totalRoomPaidPaise = 0;
      let totalRoomRemainingPaise = 0;

      let totalExpenseSharePaise = 0;
      let totalExpenseOwedPaise = 0;
      let totalExpenseReceivablePaise = 0;

      for (const month of months) {
        // Query base monthly overview
        let overview;
        try {
          overview = await finance.getMemberFinancialOverview({
            memberId,
            month,
            actorRole,
          });
        } catch (err) {
          const error = new Error(`Failed to load authoritative financial overview for ${month} during stay attribution: ${err.message}`);
          error.statusCode = 500;
          throw error;
        }

        const multiStay = isMultiStayMonth(month);
        const monthStart = `${month}-01`;
        const monthEnd = lastDateOfMonth(month);
        const partialStayMonth = stay.joinedOn > monthStart
          || Boolean(stay.actualLeftOn && stay.actualLeftOn < monthEnd);

        let monthMessBilled = overview.mess?.billPaise || 0;
        let monthMessPaid = overview.mess?.paidPaise || 0;
        let monthMessRemaining = overview.mess?.remainingPaise || 0;

        let monthRoomBilled = overview.room?.issuedChargePaise || 0;
        let monthRoomPaid = overview.room?.paidPaise || 0;
        let monthRoomRemaining = overview.room?.remainingPaise || 0;
        let monthRoomIssued = overview.room?.chargeIssued || false;

        let monthExpenseShare = overview.expenses?.spendingSharePaise || 0;
        let monthExpenseOwed = overview.expenses?.owedToOthersPaise || 0;
        let monthExpenseReceivable = overview.expenses?.owedToMePaise || 0;
        let monthDebtsOwed = overview.expenses?.debtsOwed || [];
        let monthReceivables = overview.expenses?.receivables || [];
        const unattributed = { mess: null, room: null };

        if (
          (multiStay || partialStayMonth)
          && (monthMessBilled !== 0 || monthMessPaid !== 0 || monthMessRemaining !== 0)
        ) {
          addWarning({
            domain: 'MESS',
            month,
            code: multiStay ? 'MULTIPLE_STAYS_IN_MONTH' : 'PARTIAL_MONTH_WITHOUT_STAY_REFERENCE',
            message: 'Mess bills and payments are stored by member and month without a Stay reference, so exact ownership requires review.',
            amounts: {
              billPaise: monthMessBilled,
              paidPaise: monthMessPaid,
              remainingPaise: monthMessRemaining,
            },
          });
          if (multiStay) {
            unattributed.mess = {
              billPaise: monthMessBilled,
              paidPaise: monthMessPaid,
              remainingPaise: monthMessRemaining,
            };
            monthMessBilled = 0;
            monthMessPaid = 0;
            monthMessRemaining = 0;
          }
        }

        if (
          multiStay
          && (monthRoomBilled !== 0 || monthRoomPaid !== 0 || monthRoomRemaining !== 0)
        ) {
          addWarning({
            domain: 'ROOM_FEES',
            month,
            code: 'MULTIPLE_STAYS_IN_MONTH',
            message: 'Room charges and payments are stored by member and month without a Stay reference, so exact ownership requires review.',
            amounts: {
              issuedChargePaise: monthRoomBilled,
              paidPaise: monthRoomPaid,
              remainingPaise: monthRoomRemaining,
            },
          });
          unattributed.room = {
            issuedChargePaise: monthRoomBilled,
            paidPaise: monthRoomPaid,
            remainingPaise: monthRoomRemaining,
          };
          monthRoomBilled = 0;
          monthRoomPaid = 0;
          monthRoomRemaining = 0;
          monthRoomIssued = false;
        }

        // If this month contains multiple stays for this member, isolate by exact stay dates!
        if (multiStay) {
          // 1. Other Expenses: Filter exact expenses by expense date within stay duration
          const monthExpenses = await expenses.listExpensesByMonth(month, {
            actorRole: 'admin',
            actorMemberId: memberId,
          });

          // Expenses dated within this stay's tenure
          const stayExpenses = monthExpenses.filter((e) => {
            if (e.status === 'voided') return false;
            return e.date >= stay.joinedOn && (!stay.actualLeftOn || e.date <= stay.actualLeftOn);
          });

          monthExpenseShare = 0;
          monthExpenseOwed = 0;
          monthExpenseReceivable = 0;
          monthDebtsOwed = [];
          monthReceivables = [];

          for (const exp of stayExpenses) {
            // Is member a debtor to the payer?
            if (exp.paidByMemberId !== memberId) {
              const alloc = (exp.allocations || []).find((a) => a.memberId === memberId);
              if (alloc) {
                monthExpenseShare += alloc.amountPaise;
                const memberShare = exp.memberShares?.find((s) => s.memberId === memberId);
                const remaining = memberShare ? memberShare.remainingOwedPaise : alloc.amountPaise;
                monthExpenseOwed += remaining;
                if (remaining > 0) {
                  monthDebtsOwed.push({
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

            // Is member the payer?
            if (exp.paidByMemberId === memberId) {
              const myAlloc = (exp.allocations || []).find((a) => a.memberId === memberId);
              if (myAlloc) {
                monthExpenseShare += myAlloc.amountPaise;
              }
              for (const share of exp.memberShares || []) {
                if (share.memberId !== memberId) {
                  monthExpenseReceivable += share.remainingOwedPaise;
                  if (share.remainingOwedPaise > 0) {
                    monthReceivables.push({
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
          }

          // 2. Room Fees: verify if this stay owned the room assignment for this month
          const assignments = await roomRepo.findAssignmentsForMember(memberId, { session });
          const stayAssignment = (assignments || []).find((a) => {
            const aFrom = a.effectiveFromDate || `${a.effectiveFromMonth}-01`;
            const aUntil = a.effectiveUntilDate || (a.effectiveUntilMonth ? `${a.effectiveUntilMonth}-31` : '9999-99-99');
            return aFrom <= (stay.actualLeftOn || '9999-99-99') && aUntil >= stay.joinedOn;
          });

          if (stay.actualLeftOn && stay.actualLeftOn < monthStart) {
            monthRoomBilled = 0;
            monthRoomPaid = 0;
            monthRoomRemaining = 0;
            monthRoomIssued = false;
          } else if (stay.joinedOn > monthEnd) {
            monthRoomBilled = 0;
            monthRoomPaid = 0;
            monthRoomRemaining = 0;
            monthRoomIssued = false;
          }
        }

        totalMessBilledPaise += monthMessBilled;
        totalMessPaidPaise += monthMessPaid;
        totalMessRemainingPaise += monthMessRemaining;

        if (monthMessRemaining > 0) {
          outstandingObligations.push({
            domain: 'MESS',
            month,
            title: `Hostel Mess Bill (${month})`,
            amountPaise: monthMessRemaining,
            toRecipient: 'Hostel Kitchen / Mess Fund',
          });
        }

        totalRoomBilledPaise += monthRoomBilled;
        totalRoomPaidPaise += monthRoomPaid;
        totalRoomRemainingPaise += monthRoomRemaining;

        if (monthRoomRemaining > 0) {
          outstandingObligations.push({
            domain: 'ROOM_FEES',
            month,
            title: `Monthly Room Fee (${month})`,
            amountPaise: monthRoomRemaining,
            toRecipient: 'Hostel Administration',
          });
        }

        totalExpenseSharePaise += monthExpenseShare;
        totalExpenseOwedPaise += monthExpenseOwed;
        totalExpenseReceivablePaise += monthExpenseReceivable;

        for (const debt of monthDebtsOwed) {
          if (debt.amountPaise > 0) {
            outstandingObligations.push({
              domain: 'OTHER_EXPENSES',
              month,
              title: `Reimbursement to ${debt.toMemberId}: ${debt.title || 'Shared Expense'} (${month})`,
              amountPaise: debt.amountPaise,
              toRecipient: debt.toMemberId,
            });
          }
        }

        monthlySummaries.push({
          month,
          mess: {
            billPaise: monthMessBilled,
            paidPaise: monthMessPaid,
            remainingPaise: monthMessRemaining,
          },
          room: {
            chargeIssued: monthRoomIssued,
            issuedChargePaise: monthRoomBilled,
            paidPaise: monthRoomPaid,
            remainingPaise: monthRoomRemaining,
          },
          expenses: {
            spendingSharePaise: monthExpenseShare,
            owedToOthersPaise: monthExpenseOwed,
            owedToMePaise: monthExpenseReceivable,
            debtsOwed: monthDebtsOwed,
            receivables: monthReceivables,
          },
          combined: {
            totalTrackedSpendingPaise: monthMessBilled + monthRoomBilled + monthExpenseShare,
            outstandingPayablePaise: monthMessRemaining + monthRoomRemaining + monthExpenseOwed,
            totalReceivablePaise: monthExpenseReceivable,
          },
          unattributed,
        });
      }

      // Live deposit overview for this specific stayId
      const depositOverview = await deposits.getDepositSummary(stayId, { session });
      const depositHeldPaise = depositOverview?.summary?.heldPaise || 0;

      if (depositHeldPaise > 0) {
        outstandingObligations.push({
          domain: 'SECURITY_DEPOSIT',
          title: 'Unrefunded Security Deposit Held',
          amountPaise: depositHeldPaise,
          toRecipient: `Resident Member (${memberId})`,
        });
      }

      const totalOutstandingPayablePaise =
        totalMessRemainingPaise + totalRoomRemainingPaise + totalExpenseOwedPaise;

      const isEligibleForNoDues =
        totalOutstandingPayablePaise === 0
        && depositHeldPaise === 0
        && attributionWarnings.length === 0;

      return {
        stay,
        memberId,
        months,
        monthlySummaries,
        outstandingObligations,
        depositOverview,
        depositHeldPaise,
        totalMessBilledPaise,
        totalMessPaidPaise,
        totalMessRemainingPaise,
        totalRoomBilledPaise,
        totalRoomPaidPaise,
        totalRoomRemainingPaise,
        totalExpenseSharePaise,
        totalExpenseOwedPaise,
        totalExpenseReceivablePaise,
        totalOutstandingPayablePaise,
        attributionWarnings,
        isAttributionComplete: attributionWarnings.length === 0,
        isEligibleForNoDues,
      };
    },
  };
}

export const defaultStayAttributionService = createStayAttributionService();
