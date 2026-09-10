import { MEMBER_IDS } from '../config/members.js';
import { reportService } from '../reports/report.service.js';
import { HttpError } from '../utils/HttpError.js';
import { paymentRepository } from './payment.repository.js';

export function derivePaymentAmounts({ billAmountPaise, paidAmountPaise, periodType, ratesConfigured }) {
  if (periodType === 'future') {
    return { remainingAmountPaise: 0, overpaidAmountPaise: 0, status: 'not_due_yet' };
  }
  if (!ratesConfigured || billAmountPaise === null) {
    return { remainingAmountPaise: 0, overpaidAmountPaise: 0, status: 'rates_missing' };
  }

  const remainingAmountPaise = Math.max(billAmountPaise - paidAmountPaise, 0);
  const overpaidAmountPaise = Math.max(paidAmountPaise - billAmountPaise, 0);
  let status = 'paid';
  if (billAmountPaise === 0 && paidAmountPaise === 0) status = 'no_due';
  else if (paidAmountPaise === 0) status = 'pending';
  else if (paidAmountPaise < billAmountPaise) status = 'partial';
  else if (paidAmountPaise > billAmountPaise) status = 'overpaid';

  return { remainingAmountPaise, overpaidAmountPaise, status };
}

export function createPaymentSummaryService({ reports = reportService, repository = paymentRepository } = {}) {
  return Object.freeze({
    async getSummary(month) {
      try {
        const [report, payments] = await Promise.all([
          reports.getMonthlyReport(month),
          repository.findSummaryByMonth(month),
        ]);
        const recorded = payments.filter(({ status }) => status === 'recorded');
        const paidByMember = Object.fromEntries(MEMBER_IDS.map((memberId) => [memberId, 0]));
        for (const payment of recorded) paidByMember[payment.memberId] += payment.amountPaise;

        const ratesConfigured = report.rates.configured;
        const members = Object.fromEntries(MEMBER_IDS.map((memberId) => {
          const billAmountPaise = report.periodType === 'future'
            ? null
            : report.toDate?.members[memberId].amountPaise ?? null;
          const paidAmountPaise = paidByMember[memberId];
          return [memberId, {
            billAmountPaise,
            paidAmountPaise,
            ...derivePaymentAmounts({
              billAmountPaise,
              paidAmountPaise,
              periodType: report.periodType,
              ratesConfigured,
            }),
            projectedBillAmountPaise: report.projection.members[memberId].amountPaise,
          }];
        }));

        const roomBillAmountPaise = report.periodType === 'future'
          ? null
          : report.toDate?.room.amountPaise ?? null;
        const roomPaidAmountPaise = Object.values(paidByMember).reduce((total, value) => total + value, 0);

        return {
          month,
          periodType: report.periodType,
          today: report.today,
          payable: report.periodType !== 'future' && ratesConfigured,
          ratesConfigured,
          members,
          room: {
            billAmountPaise: roomBillAmountPaise,
            paidAmountPaise: roomPaidAmountPaise,
            ...derivePaymentAmounts({
              billAmountPaise: roomBillAmountPaise,
              paidAmountPaise: roomPaidAmountPaise,
              periodType: report.periodType,
              ratesConfigured,
            }),
            projectedBillAmountPaise: report.projection.room.amountPaise,
          },
        };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'Payment summary is temporarily unavailable.', { cause: error });
      }
    },
  });
}

export const paymentSummaryService = createPaymentSummaryService();
