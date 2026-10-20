/**
 * MealKhata 2.0 - Lifetime Financial Report Service
 * Aggregates lifetime financial history, room history, and deposits across a resident's hostel stay.
 */

import { getLogicalDateInTimeZone } from '../utils/date.js';
import { stayRepository } from './stay.repository.js';
import { financialOverviewService } from '../finance/financialOverview.service.js';
import { depositService } from './deposit.service.js';
import { roomFeeService } from '../roomFees/roomFee.service.js';
import { getPreviousLogicalMonth, isValidLogicalMonth } from '../utils/month.js';
import { MEMBERS } from '../config/members.js';
import { STAY_STATUSES } from './stay.constants.js';

function getMonthsRange(startMonth, endMonth) {
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

export function createLifetimeReportService({
  repository = stayRepository,
  finance = financialOverviewService,
  deposits = depositService,
  roomFees = roomFeeService,
} = {}) {
  return {
    async getLifetimeFinancialReport(stayId, { actorRole = 'member' } = {}) {
      const stay = await repository.findStayById(stayId);
      if (!stay) {
        throw new Error('Hostel stay not found');
      }

      const member = MEMBERS.find((m) => m.id === stay.memberId) || {
        id: stay.memberId,
        name: stay.memberId,
      };

      const startMonth = stay.joinedOn.slice(0, 7);
      const currentMonth = getLogicalDateInTimeZone(new Date(), 'Asia/Kolkata').slice(0, 7);
      const endMonth = stay.actualLeftOn ? stay.actualLeftOn.slice(0, 7) : currentMonth;

      const months = getMonthsRange(startMonth, endMonth);

      // Fetch monthly financial snapshots - fail closed if any month fails
      const monthlySummaries = await Promise.all(
        months.map(async (month) => {
          try {
            return await finance.getMemberFinancialOverview({
              memberId: stay.memberId,
              month,
              actorRole,
            });
          } catch (err) {
            const error = new Error(`Failed to calculate authoritative financial overview for month ${month}: ${err.message}`);
            error.statusCode = 500;
            error.month = month;
            throw error;
          }
        }),
      );

      const validMonthSummaries = monthlySummaries;

      // Aggregate lifetime totals
      let totalMessBilledPaise = 0;
      let totalMessPaidPaise = 0;
      let totalMessRemainingPaise = 0;

      let totalRoomBilledPaise = 0;
      let totalRoomPaidPaise = 0;
      let totalRoomRemainingPaise = 0;

      let totalExpenseSharePaise = 0;
      let totalExpenseOwedPaise = 0;
      let totalExpenseReceivablePaise = 0;

      let fullyPaidRoomMonths = 0;
      let partialRoomMonths = 0;
      let unpaidRoomMonths = 0;
      let issuedRoomMonths = 0;

      for (const ms of validMonthSummaries) {
        totalMessBilledPaise += ms.mess.billPaise || 0;
        totalMessPaidPaise += ms.mess.paidPaise || 0;
        totalMessRemainingPaise += ms.mess.remainingPaise || 0;

        if (ms.room.chargeIssued) {
          issuedRoomMonths += 1;
          totalRoomBilledPaise += ms.room.issuedChargePaise || 0;
          totalRoomPaidPaise += ms.room.paidPaise || 0;
          totalRoomRemainingPaise += ms.room.remainingPaise || 0;

          if (ms.room.remainingPaise === 0) {
            fullyPaidRoomMonths += 1;
          } else if (ms.room.paidPaise > 0) {
            partialRoomMonths += 1;
          } else {
            unpaidRoomMonths += 1;
          }
        }

        totalExpenseSharePaise += ms.expenses.spendingSharePaise || 0;
        totalExpenseOwedPaise += ms.expenses.owedToOthersPaise || 0;
        totalExpenseReceivablePaise += ms.expenses.owedToMePaise || 0;
      }

      // Fetch Deposit Summary
      const depositOverview = await deposits.getDepositSummary(stayId);

      // Fetch Clearances if checked out
      const clearances = await repository.findClearancesByStayId(stayId);

      // Calculate stay duration in months
      const stayDurationMonths = months.length;

      // Current live payable
      const currentPayablePaise =
        totalMessRemainingPaise + totalRoomRemainingPaise + totalExpenseOwedPaise;

      return {
        stay,
        member: {
          id: member.id,
          memberId: member.id,
          displayName: member.name,
        },
        summary: {
          periodStartMonth: startMonth,
          periodEndMonth: endMonth,
          totalMonths: stayDurationMonths,
        },
        duration: {
          joinedOn: stay.joinedOn,
          actualLeftOn: stay.actualLeftOn,
          status: stay.status,
          totalMonths: stayDurationMonths,
        },
        lifetimeTotals: {
          mess: {
            billedPaise: totalMessBilledPaise,
            paidPaise: totalMessPaidPaise,
            remainingPaise: totalMessRemainingPaise,
          },
          room: {
            issuedMonths: issuedRoomMonths,
            fullyPaidMonths: fullyPaidRoomMonths,
            partialMonths: partialRoomMonths,
            unpaidMonths: unpaidRoomMonths,
            billedPaise: totalRoomBilledPaise,
            paidPaise: totalRoomPaidPaise,
            remainingPaise: totalRoomRemainingPaise,
          },
          expenses: {
            spendingSharePaise: totalExpenseSharePaise,
            owedToOthersPaise: totalExpenseOwedPaise,
            owedToMePaise: totalExpenseReceivablePaise,
          },
          combined: {
            totalTrackedSpendingPaise:
              totalMessBilledPaise + totalRoomBilledPaise + totalExpenseSharePaise,
            totalOutstandingPayablePaise: currentPayablePaise,
            totalReceivablePaise: totalExpenseReceivablePaise,
          },
        },
        depositOverview,
        clearances,
        monthlySummaries: validMonthSummaries,
        generatedAt: new Date().toISOString(),
      };
    },
    async generateLifetimeReport(stayId, options) {
      return this.getLifetimeFinancialReport(stayId, options);
    },
  };
}

export const lifetimeReportService = createLifetimeReportService();
