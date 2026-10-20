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

import { createStayAttributionService, defaultStayAttributionService } from './stayAttribution.service.js';

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
  stayAttribution = null,
} = {}) {
  const attributionService =
    stayAttribution ||
    createStayAttributionService({
      stayRepo: repository,
      finance,
      deposits,
      roomFees,
    });
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

      const attr = await attributionService.getStayAttributedFinances({
        stayId,
        actorRole,
      });

      let fullyPaidRoomMonths = 0;
      let partialRoomMonths = 0;
      let unpaidRoomMonths = 0;
      let issuedRoomMonths = 0;

      for (const ms of attr.monthlySummaries) {
        if (ms.room.chargeIssued) {
          issuedRoomMonths += 1;
          if (ms.room.remainingPaise === 0) {
            fullyPaidRoomMonths += 1;
          } else if (ms.room.paidPaise > 0) {
            partialRoomMonths += 1;
          } else {
            unpaidRoomMonths += 1;
          }
        }
      }

      // Fetch Clearances if checked out
      const clearances = await repository.findClearancesByStayId(stayId);

      // Calculate stay duration in months
      const stayDurationMonths = attr.months.length;

      // Current live payable
      const currentPayablePaise = attr.totalOutstandingPayablePaise;

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
            billedPaise: attr.totalMessBilledPaise,
            paidPaise: attr.totalMessPaidPaise,
            remainingPaise: attr.totalMessRemainingPaise,
          },
          room: {
            issuedMonths: issuedRoomMonths,
            fullyPaidMonths: fullyPaidRoomMonths,
            partialMonths: partialRoomMonths,
            unpaidMonths: unpaidRoomMonths,
            billedPaise: attr.totalRoomBilledPaise,
            paidPaise: attr.totalRoomPaidPaise,
            remainingPaise: attr.totalRoomRemainingPaise,
          },
          expenses: {
            spendingSharePaise: attr.totalExpenseSharePaise,
            owedToOthersPaise: attr.totalExpenseOwedPaise,
            owedToMePaise: attr.totalExpenseReceivablePaise,
          },
          combined: {
            totalTrackedSpendingPaise:
              attr.totalMessBilledPaise + attr.totalRoomBilledPaise + attr.totalExpenseSharePaise,
            totalOutstandingPayablePaise: currentPayablePaise,
            totalReceivablePaise: attr.totalExpenseReceivablePaise,
          },
        },
        depositOverview: attr.depositOverview,
        attributionWarnings: attr.attributionWarnings || [],
        isAttributionComplete: attr.isAttributionComplete !== false,
        clearances,
        monthlySummaries: attr.monthlySummaries,
        generatedAt: new Date().toISOString(),
      };
    },
    async generateLifetimeReport(stayId, options) {
      return this.getLifetimeFinancialReport(stayId, options);
    },
  };
}

export const lifetimeReportService = createLifetimeReportService();
