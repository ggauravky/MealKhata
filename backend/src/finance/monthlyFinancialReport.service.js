/**
 * MealKhata 2.0 - Monthly Financial Report Service
 * Aggregates unified datasets for monthly reporting tabs and PDF generation.
 */

import { MEMBER_IDS, MEMBERS } from '../config/members.js';
import { ROLES } from '../auth/permissions.js';
import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalMonth } from '../utils/month.js';
import { financialOverviewService } from './financialOverview.service.js';
import { defaultExpenseService } from '../expenses/expense.service.js';
import { roomFeeService } from '../roomFees/roomFee.service.js';
import { reportService } from '../reports/report.service.js';
import { settlementService } from '../settlement/settlement.service.js';

export function createMonthlyFinancialReportService({
  overviewService = financialOverviewService,
  expenseService = defaultExpenseService,
  roomFees = roomFeeService,
  reports = reportService,
  settlements = settlementService,
} = {}) {
  return Object.freeze({
    /**
     * Aggregates the complete household monthly financial dataset.
     */
    async getHouseholdReportData(month, { actorRole = ROLES.ADMIN } = {}) {
      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'Month must be in YYYY-MM format.');
      }

      const [overview, expenses, roomCharges, messReport, isClosed, activeSettlement] = await Promise.all([
        overviewService.getHouseholdFinancialOverview({ month, actorRole }),
        expenseService.listExpensesByMonth(month, { actorRole }),
        roomFees.getChargesForMonth(month, actorRole),
        reports.getMonthlyReport(month),
        settlements.isMonthClosed(month),
        settlements.getActiveSettlement(month),
      ]);

      const activeExpenses = expenses.filter((e) => e.status !== 'voided');

      return {
        month,
        overview,
        isMessClosed: isClosed,
        activeSettlement,
        messReport,
        roomCharges,
        expenses: activeExpenses,
      };
    },

    /**
     * Aggregates a single member's private monthly financial dataset.
     */
    async getMemberReportData(memberId, month, { actorRole = ROLES.MEMBER } = {}) {
      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'Month must be in YYYY-MM format.');
      }
      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, `Invalid member ID: ${memberId}`);
      }

      const [memberOverview, memberExpenses, memberHistory] = await Promise.all([
        overviewService.getMemberFinancialOverview({ memberId, month, actorRole }),
        expenseService.listExpensesByMonth(month, { actorRole, actorMemberId: memberId }),
        roomFees.getMemberOverview({ memberId, targetMonth: month }),
      ]);

      const activeMemberExpenses = memberExpenses.filter((e) => e.status !== 'voided');

      return {
        memberId,
        month,
        overview: memberOverview,
        expenses: activeMemberExpenses,
        roomHistory: memberHistory,
      };
    },
  });
}

export const monthlyFinancialReportService = createMonthlyFinancialReportService();
