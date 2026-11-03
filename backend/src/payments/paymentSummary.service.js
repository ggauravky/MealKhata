import { reportService } from '../reports/report.service.js';
import { studentResolver } from '../students/studentResolver.service.js';
import { assertSafeStudentId } from '../students/studentId.js';
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

export function createPaymentSummaryService({ reports = reportService, repository = paymentRepository, students = null } = {}) {
  return Object.freeze({
    async getSummary(month) {
      try {
        const [report, payments] = await Promise.all([
          reports.getMonthlyReport(month),
          repository.findSummaryByMonth(month),
        ]);
        const memberIds = new Set([
          ...Object.keys(report.projection?.members ?? {}),
          ...Object.keys(report.toDate?.members ?? {}),
        ]);
        const paidByMember = {};
        const paymentOnlyNames = {};
        for (const payment of payments) {
          try {
            assertSafeStudentId(payment.memberId);
          } catch {
            throw new HttpError(409, `Invalid payment student reference: ${payment.memberId}`);
          }
          if (!memberIds.has(payment.memberId)) {
            if (!students) throw new HttpError(409, `Unknown payment student reference: ${payment.memberId}`);
            try {
              const student = await students.assertKnown(payment.memberId);
              paymentOnlyNames[payment.memberId] = student.displayName;
            } catch {
              throw new HttpError(409, `Unknown payment student reference: ${payment.memberId}`);
            }
            memberIds.add(payment.memberId);
          }
          if (payment.status === 'recorded') {
            paidByMember[payment.memberId] = (paidByMember[payment.memberId] ?? 0) + payment.amountPaise;
          } else if (payment.status !== 'voided') {
            throw new HttpError(409, `Invalid payment status for ${payment.memberId}`);
          }
        }

        const ratesConfigured = report.rates.configured;
        const members = Object.fromEntries([...memberIds].map((memberId) => {
          const billAmountPaise = report.periodType === 'future'
            ? null
            : report.toDate?.members?.[memberId]?.amountPaise ?? 0;
          const paidAmountPaise = paidByMember[memberId] ?? 0;
          return [memberId, {
            displayName: report.toDate?.members?.[memberId]?.displayName
              ?? report.projection?.members?.[memberId]?.displayName
              ?? paymentOnlyNames[memberId] ?? memberId,
            billAmountPaise,
            paidAmountPaise,
            ...derivePaymentAmounts({
              billAmountPaise,
              paidAmountPaise,
              periodType: report.periodType,
              ratesConfigured,
            }),
            projectedBillAmountPaise: report.projection.members?.[memberId]?.amountPaise ?? 0,
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

export const paymentSummaryService = createPaymentSummaryService({ students: studentResolver });
