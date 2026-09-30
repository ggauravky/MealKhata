import crypto from 'node:crypto';
import { MEMBER_IDS } from '../config/members.js';
import { paymentSummaryService } from '../payments/paymentSummary.service.js';
import { reportService } from '../reports/report.service.js';
import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalMonth } from '../utils/month.js';
import { monthlySettlementRepository } from './monthlySettlement.repository.js';
import { serializeSettlement, serializeSettlementHistory } from './monthlySettlement.serializer.js';

export function createSettlementService({
  reports = reportService,
  summaries = paymentSummaryService,
  repository = monthlySettlementRepository,
  now = () => new Date(),
} = {}) {
  return Object.freeze({
    async isMonthClosed(month) {
      if (!isValidLogicalMonth(month)) return false;
      const active = await repository.findActiveByMonth(month);
      return Boolean(active && active.status === 'closed');
    },

    async getActiveSettlement(month) {
      if (!isValidLogicalMonth(month)) return null;
      const doc = await repository.findActiveByMonth(month);
      return serializeSettlement(doc);
    },

    async getSettlementHistory(month) {
      if (!isValidLogicalMonth(month)) return [];
      const docs = await repository.findHistoryByMonth(month);
      return serializeSettlementHistory(docs);
    },

    async getSettlementStatus(month) {
      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'Month must be a valid calendar month in YYYY-MM format.');
      }

      const active = await repository.findActiveByMonth(month);
      if (active && active.status === 'closed') {
        return {
          month,
          state: 'closed',
          canClose: false,
          canReopen: true,
          activeSettlement: serializeSettlement(active),
          blockers: [],
        };
      }

      const [report, summary] = await Promise.all([
        reports.getMonthlyReport(month),
        summaries.getSummary(month),
      ]);

      const blockers = [];

      if (report.periodType === 'future') {
        blockers.push({
          type: 'future_month',
          message: 'Future months cannot be closed.',
        });
      } else if (report.periodType === 'current') {
        blockers.push({
          type: 'current_month',
          message: 'Current month cannot be closed until it has completed.',
        });
      }

      if (!report.rates?.configured) {
        blockers.push({
          type: 'rates_missing',
          message: 'Monthly meal rates must be configured before closing.',
        });
      }

      for (const memberId of MEMBER_IDS) {
        const memberSummary = summary.members[memberId];
        if (!memberSummary) continue;

        if (memberSummary.remainingAmountPaise > 0) {
          blockers.push({
            type: 'remaining_balance',
            memberId,
            amountPaise: memberSummary.remainingAmountPaise,
            message: `${memberId} has remaining balance to settle.`,
          });
        }

        if (memberSummary.overpaidAmountPaise > 0) {
          blockers.push({
            type: 'overpayment',
            memberId,
            amountPaise: memberSummary.overpaidAmountPaise,
            message: `Blocked: ${memberId} is overpaid. Correct the payment ledger before closing.`,
          });
        }
      }

      const canClose = blockers.length === 0 && report.periodType === 'past';
      const state = canClose ? 'ready_to_close' : 'not_ready';

      return {
        month,
        state,
        canClose,
        canReopen: false,
        activeSettlement: null,
        blockers,
      };
    },

    async closeMonth({ month, actorRole = 'superadmin' }) {
      if (actorRole !== 'superadmin') {
        throw new HttpError(403, 'Only Super Admin can close a monthly settlement.');
      }

      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'Month must be a valid calendar month in YYYY-MM format.');
      }

      const isClosed = await this.isMonthClosed(month);
      if (isClosed) {
        throw new HttpError(409, 'This month is already closed.');
      }

      const status = await this.getSettlementStatus(month);
      if (!status.canClose) {
        const primaryBlocker = status.blockers[0]?.message || 'Month is not ready to close.';
        throw new HttpError(409, primaryBlocker, { blockers: status.blockers });
      }

      const [report, summary] = await Promise.all([
        reports.getMonthlyReport(month),
        summaries.getSummary(month),
      ]);

      const members = {};
      for (const memberId of MEMBER_IDS) {
        const toDateMember = report.toDate?.members[memberId] || { morningCount: 0, nightCount: 0, totalMeals: 0, amountPaise: 0 };
        const summaryMember = summary.members[memberId] || { paidAmountPaise: 0 };

        members[memberId] = {
          morningCount: toDateMember.morningCount,
          nightCount: toDateMember.nightCount,
          totalPlates: toDateMember.totalMeals,
          billAmountPaise: toDateMember.amountPaise,
          paidAmountPaise: summaryMember.paidAmountPaise,
          remainingAmountPaise: 0,
        };
      }

      const toDateRoom = report.toDate?.room || { morningCount: 0, nightCount: 0, totalMeals: 0, amountPaise: 0 };
      const room = {
        morningCount: toDateRoom.morningCount,
        nightCount: toDateRoom.nightCount,
        totalPlates: toDateRoom.totalMeals,
        billAmountPaise: toDateRoom.amountPaise,
        paidAmountPaise: summary.room?.paidAmountPaise || 0,
        remainingAmountPaise: 0,
      };

      const snapshot = {
        rates: {
          morningPricePaise: report.rates.morningPricePaise,
          nightPricePaise: report.rates.nightPricePaise,
        },
        members,
        room,
      };

      const latest = await repository.findLatestByMonth(month);
      const sequence = (latest?.sequence || 0) + 1;
      const settlementId = crypto.randomUUID();

      try {
        const created = await repository.createSettlement({
          settlementId,
          month,
          sequence,
          snapshot,
          closedAt: now(),
          closedByRole: actorRole,
        });

        return serializeSettlement(created);
      } catch (error) {
        if (error?.code === 11000) {
          throw new HttpError(409, 'This month is already closed.');
        }
        throw error;
      }
    },

    async reopenMonth({ month, reason, actorRole = 'superadmin' }) {
      if (actorRole !== 'superadmin') {
        throw new HttpError(403, 'Only Super Admin can reopen a closed month.');
      }

      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'Month must be a valid calendar month in YYYY-MM format.');
      }

      if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) {
        throw new HttpError(400, 'A meaningful reason (3-500 characters) is required to reopen a closed month.');
      }

      const active = await repository.findActiveByMonth(month);
      if (!active || active.status !== 'closed') {
        throw new HttpError(404, 'No closed settlement found for this month.');
      }

      const updated = await repository.reopenSettlement({
        settlementId: active.settlementId,
        reopenedAt: now(),
        reopenedByRole: actorRole,
        reopenReason: reason.trim(),
      });

      return serializeSettlement(updated);
    },
  });
}

export const settlementService = createSettlementService();
