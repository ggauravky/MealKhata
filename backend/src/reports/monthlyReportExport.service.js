import { MEMBER_IDS, MEMBER_NAMES } from '../config/members.js';
import { env } from '../config/env.js';
import { monthMealService } from '../calendar/monthMeal.service.js';
import { reportService } from '../reports/report.service.js';
import { paymentSummaryService } from '../payments/paymentSummary.service.js';
import { paymentRepository } from '../payments/payment.repository.js';
import { settlementService } from '../settlement/settlement.service.js';
import { monthlyRateService } from '../billing/monthlyRate.service.js';
import {
  getEffectiveMealAllocation,
  splitMealCost,
} from '../meals/plateAllocation.service.js';
import { MEAL_PRICES } from '../meals/plateAllocation.constants.js';
import { getLogicalDateInTimeZone } from '../utils/date.js';
import {
  compareLogicalMonths,
  firstDateOfMonth,
  formatLogicalMonth,
  isValidLogicalMonth,
  lastDateOfMonth,
} from '../utils/month.js';
import { HttpError } from '../utils/HttpError.js';

export function formatReportDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const dayStr = String(day).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthStr = monthNames[month - 1];
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdayStr = weekdayNames[date.getUTCDay()];
  return {
    dayStr,
    monthStr,
    yearStr: String(year),
    weekdayStr,
    displayDate: `${dayStr} ${monthStr} ${year}`,
    compactDate: `${dayStr} ${monthStr}`,
  };
}

export function formatPdfPlateFraction(shareUnits) {
  if (!shareUnits || shareUnits === 0) return '0';
  const whole = Math.floor(shareUnits / 6);
  const rem = shareUnits % 6;
  const remMap = {
    1: '1/6',
    2: '1/3',
    3: '1/2',
    4: '2/3',
    5: '5/6',
  };
  const frac = remMap[rem];
  if (!frac) return String(whole);
  if (whole === 0) return frac;
  return `${whole} ${frac}`;
}

export function formatPdfRupees(paise) {
  const amount = ((paise || 0) / 100).toFixed(2);
  return `Rs. ${amount}`;
}

function mapStatusLabel(rawStatus) {
  if (rawStatus === 'taking') return 'Taking';
  if (rawStatus === 'skip') return 'Skip';
  return 'Not set';
}

function verifyExportReconciliation({
  summary,
  members,
  actualDays,
  payments,
  reportState,
  activeSettlement,
}) {
  // 1. Daily room cost sum vs Room bill
  const dailyRoomSum = actualDays.reduce((acc, d) => acc + d.dailyTotalPaise, 0);
  if (dailyRoomSum !== summary.roomAmountPaise) {
    throw new Error(
      `Reconciliation failure: daily room cost sum (${dailyRoomSum}) does not equal room bill (${summary.roomAmountPaise})`,
    );
  }

  // 2. Sum of member bills vs Room bill
  const memberBillsSum = MEMBER_IDS.reduce((acc, id) => acc + members[id].billAmountPaise, 0);
  if (memberBillsSum !== summary.roomAmountPaise) {
    throw new Error(
      `Reconciliation failure: sum of member bills (${memberBillsSum}) does not equal room bill (${summary.roomAmountPaise})`,
    );
  }

  // 3. For each member: sum of daily costs vs member bill
  for (const id of MEMBER_IDS) {
    const mDailySum = actualDays.reduce((acc, d) => acc + d.members[id].dailyTotalPaise, 0);
    if (mDailySum !== members[id].billAmountPaise) {
      throw new Error(
        `Reconciliation failure for ${id}: daily costs sum (${mDailySum}) does not equal member bill (${members[id].billAmountPaise})`,
      );
    }

    const mMorningSum = actualDays.reduce((acc, d) => acc + d.members[id].morning.amountPaise, 0);
    if (mMorningSum !== members[id].morningAmountPaise) {
      throw new Error(
        `Reconciliation failure for ${id}: daily morning costs sum (${mMorningSum}) does not equal member morning cost (${members[id].morningAmountPaise})`,
      );
    }

    const mNightSum = actualDays.reduce((acc, d) => acc + d.members[id].night.amountPaise, 0);
    if (mNightSum !== members[id].nightAmountPaise) {
      throw new Error(
        `Reconciliation failure for ${id}: daily night costs sum (${mNightSum}) does not equal member night cost (${members[id].nightAmountPaise})`,
      );
    }
  }

  // 4. Physical plates reconciliation
  const dailyMorningPlates = actualDays.reduce((acc, d) => acc + d.morning.physicalPlates, 0);
  if (dailyMorningPlates !== summary.morningPhysicalPlates) {
    throw new Error(
      `Reconciliation failure: daily morning physical plates (${dailyMorningPlates}) does not equal summary (${summary.morningPhysicalPlates})`,
    );
  }
  const dailyNightPlates = actualDays.reduce((acc, d) => acc + d.night.physicalPlates, 0);
  if (dailyNightPlates !== summary.nightPhysicalPlates) {
    throw new Error(
      `Reconciliation failure: daily night physical plates (${dailyNightPlates}) does not equal summary (${summary.nightPhysicalPlates})`,
    );
  }

  // 5. Payments reconciliation
  const recordedPayments = payments.filter((p) => p.status === 'recorded');
  const paymentsSum = recordedPayments.reduce((acc, p) => acc + p.amountPaise, 0);
  if (paymentsSum !== summary.paidAmountPaise) {
    throw new Error(
      `Reconciliation failure: sum of recorded payments (${paymentsSum}) does not equal summary paid amount (${summary.paidAmountPaise})`,
    );
  }

  for (const id of MEMBER_IDS) {
    const mPaid = recordedPayments.filter((p) => p.memberId === id).reduce((acc, p) => acc + p.amountPaise, 0);
    if (mPaid !== members[id].paidAmountPaise) {
      throw new Error(
        `Reconciliation failure for ${id}: payments sum (${mPaid}) does not equal summary paid amount (${members[id].paidAmountPaise})`,
      );
    }
  }

  // 6. Frozen settlement snapshot reconciliation (if closed)
  if (reportState === 'closed' && activeSettlement?.snapshot) {
    const snap = activeSettlement.snapshot;
    if (summary.roomAmountPaise !== snap.room.billAmountPaise) {
      throw new Error(
        `Reconciliation failure: summary room bill (${summary.roomAmountPaise}) does not match frozen snapshot (${snap.room.billAmountPaise})`,
      );
    }
    if (summary.paidAmountPaise !== snap.room.paidAmountPaise) {
      throw new Error(
        `Reconciliation failure: summary paid (${summary.paidAmountPaise}) does not match frozen snapshot (${snap.room.paidAmountPaise})`,
      );
    }
    for (const id of MEMBER_IDS) {
      if (members[id].billAmountPaise !== snap.members[id].billAmountPaise) {
        throw new Error(
          `Reconciliation failure for ${id}: member bill (${members[id].billAmountPaise}) does not match frozen snapshot (${snap.members[id].billAmountPaise})`,
        );
      }
      if (members[id].paidAmountPaise !== snap.members[id].paidAmountPaise) {
        throw new Error(
          `Reconciliation failure for ${id}: member paid (${members[id].paidAmountPaise}) does not match frozen snapshot (${snap.members[id].paidAmountPaise})`,
        );
      }
    }
  }

  return true;
}

export function createMonthlyReportExportService({
  meals = monthMealService,
  reports = reportService,
  summaries = paymentSummaryService,
  payments = paymentRepository,
  settlements = settlementService,
  rates = monthlyRateService,
  now = () => new Date(),
  timezone = env.appTimezone,
} = {}) {
  return Object.freeze({
    async buildMonthlyReportExport(month) {
      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'Month must be a valid calendar month in YYYY-MM format.');
      }

      const currentTime = now();
      const today = getLogicalDateInTimeZone(currentTime, timezone);
      const currentMonth = today.slice(0, 7);
      const comparison = compareLogicalMonths(month, currentMonth);
      const periodType = comparison < 0 ? 'past' : comparison > 0 ? 'future' : 'current';

      const [monthMealData, monthlyReport, paymentSummary, paymentHistory, activeSettlement, rateData] =
        await Promise.all([
          meals.getMonth(month),
          reports.getMonthlyReport(month),
          summaries.getSummary(month),
          payments.findHistoryByMonth(month),
          settlements.getActiveSettlement(month),
          rates.getRate(month),
        ]);

      const isClosed = Boolean(activeSettlement && activeSettlement.status === 'closed');
      let reportState = 'open_past';
      let statusBadgeText = 'PAST MONTH · OPEN';

      if (isClosed) {
        reportState = 'closed';
        statusBadgeText = 'FINAL · CLOSED';
      } else if (periodType === 'future') {
        reportState = 'future_schedule';
        statusBadgeText = 'SCHEDULED · NOT A FINAL BILL';
      } else if (periodType === 'current') {
        reportState = 'current';
        statusBadgeText = 'CURRENT · MONTH TO DATE';
      }

      let morningPricePaise = rateData?.morningPricePaise ?? monthlyReport.rates?.morningPricePaise ?? MEAL_PRICES.morning;
      let nightPricePaise = rateData?.nightPricePaise ?? monthlyReport.rates?.nightPricePaise ?? MEAL_PRICES.night;
      let isFrozen = false;

      if (isClosed && activeSettlement.snapshot?.rates) {
        morningPricePaise = activeSettlement.snapshot.rates.morningPricePaise;
        nightPricePaise = activeSettlement.snapshot.rates.nightPricePaise;
        isFrozen = true;
      }

      const startDate = firstDateOfMonth(month);
      const endDate = lastDateOfMonth(month);

      let scopeEndDate = endDate;
      let reportingPeriodLabel = `${formatReportDate(startDate).displayDate} – ${formatReportDate(endDate).displayDate}`;

      if (periodType === 'current') {
        scopeEndDate = today;
        reportingPeriodLabel = `${formatReportDate(startDate).displayDate} – ${formatReportDate(today).displayDate}`;
      } else if (periodType === 'future') {
        scopeEndDate = null;
        reportingPeriodLabel = `${formatReportDate(startDate).displayDate} – ${formatReportDate(endDate).displayDate} (Scheduled)`;
      }

      // Process daily meal records
      const allDays = monthMealData.days.map((day) => {
        const morningAlloc = getEffectiveMealAllocation({
          statuses: day.meals?.morning,
          customAllocation: day.allocations?.morning,
        });
        const nightAlloc = getEffectiveMealAllocation({
          statuses: day.meals?.night,
          customAllocation: day.allocations?.night,
        });

        const morningSplit = splitMealCost({
          date: day.date,
          mealType: 'morning',
          effectiveAllocation: morningAlloc,
          pricePaise: morningPricePaise,
        });

        const nightSplit = splitMealCost({
          date: day.date,
          mealType: 'night',
          effectiveAllocation: nightAlloc,
          pricePaise: nightPricePaise,
        });

        const dateParts = formatReportDate(day.date);

        const memberData = Object.fromEntries(
          MEMBER_IDS.map((id) => {
            const rawMorningStatus = day.meals?.morning?.[id] ?? 'not_set';
            const rawNightStatus = day.meals?.night?.[id] ?? 'not_set';
            const mShareUnits = morningSplit.members[id].shareUnits;
            const nShareUnits = nightSplit.members[id].shareUnits;
            const mCostPaise = morningSplit.members[id].amountPaise;
            const nCostPaise = nightSplit.members[id].amountPaise;

            return [
              id,
              {
                memberId: id,
                memberName: MEMBER_NAMES[id] ?? id,
                morning: {
                  rawStatus: rawMorningStatus,
                  status: mapStatusLabel(rawMorningStatus),
                  shareUnits: mShareUnits,
                  plateEquivalent: mShareUnits / 6,
                  amountPaise: mCostPaise,
                },
                night: {
                  rawStatus: rawNightStatus,
                  status: mapStatusLabel(rawNightStatus),
                  shareUnits: nShareUnits,
                  plateEquivalent: nShareUnits / 6,
                  amountPaise: nCostPaise,
                },
                dailyTotalPaise: mCostPaise + nCostPaise,
              },
            ];
          }),
        );

        const morningEating = MEMBER_IDS.filter((id) => day.meals?.morning?.[id] === 'taking').length;
        const nightEating = MEMBER_IDS.filter((id) => day.meals?.night?.[id] === 'taking').length;

        return {
          date: day.date,
          dayNumber: Number(dateParts.dayStr),
          dayStr: dateParts.dayStr,
          weekday: dateParts.weekdayStr,
          displayDate: dateParts.displayDate,
          compactDate: dateParts.compactDate,
          saved: day.saved,
          hasMealActivity: day.hasMealActivity,
          morning: {
            eaters: morningEating,
            physicalPlates: morningSplit.physicalPlates,
            amountPaise: morningSplit.roomAmountPaise,
          },
          night: {
            eaters: nightEating,
            physicalPlates: nightSplit.physicalPlates,
            amountPaise: nightSplit.roomAmountPaise,
          },
          dailyTotalPaise: morningSplit.roomAmountPaise + nightSplit.roomAmountPaise,
          members: memberData,
        };
      });

      // Split days into actual and scheduled
      let actualDays = [];
      let scheduledFutureDays = [];

      if (periodType === 'past') {
        actualDays = allDays;
      } else if (periodType === 'current') {
        actualDays = allDays.filter((d) => d.date <= today);
        scheduledFutureDays = allDays.filter((d) => d.date > today && d.saved && d.hasMealActivity);
      } else {
        // Future
        actualDays = [];
        scheduledFutureDays = allDays.filter((d) => d.saved && d.hasMealActivity);
      }

      const recordedActivityDays = actualDays.filter((d) => d.saved && d.hasMealActivity);
      const recordedDayCount = actualDays.filter((d) => d.saved).length;
      const hasRecordedMeals = actualDays.some(
        (d) => d.saved && (d.morning.eaters > 0 || d.night.eaters > 0),
      );
      const hasMealActivity = actualDays.some((d) => d.saved && d.hasMealActivity);

      // Assemble summary totals
      let summaryRoom;
      let summaryMembers;

      if (isClosed && activeSettlement.snapshot) {
        const snap = activeSettlement.snapshot;
        const roomMorningPlates = snap.room.morningPhysicalPlates ?? snap.room.morningCount ?? 0;
        const roomNightPlates = snap.room.nightPhysicalPlates ?? snap.room.nightCount ?? 0;
        const roomTotalPlates = snap.room.totalPhysicalPlates ?? (roomMorningPlates + roomNightPlates);

        summaryRoom = {
          morningPhysicalPlates: roomMorningPlates,
          nightPhysicalPlates: roomNightPlates,
          totalPhysicalPlates: roomTotalPlates,
          morningAmountPaise: snap.room.morningAmountPaise ?? (roomMorningPlates * morningPricePaise),
          nightAmountPaise: snap.room.nightAmountPaise ?? (roomNightPlates * nightPricePaise),
          roomAmountPaise: snap.room.billAmountPaise,
          paidAmountPaise: snap.room.paidAmountPaise,
          remainingAmountPaise: snap.room.remainingAmountPaise ?? 0,
          overpaidAmountPaise: snap.room.overpaidAmountPaise ?? 0,
          status: snap.room.remainingAmountPaise === 0 ? 'paid' : 'partial',
        };

        summaryMembers = Object.fromEntries(
          MEMBER_IDS.map((id) => {
            const m = snap.members[id] || {};
            const mPart = m.morningParticipationCount ?? m.morningCount ?? 0;
            const nPart = m.nightParticipationCount ?? m.nightCount ?? 0;
            const mUnits = m.morningShareUnits ?? (mPart * 6);
            const nUnits = m.nightShareUnits ?? (nPart * 6);
            const totalUnits = m.totalShareUnits ?? (mUnits + nUnits);

            const mCost = actualDays.reduce((acc, d) => acc + d.members[id].morning.amountPaise, 0);
            const nCost = actualDays.reduce((acc, d) => acc + d.members[id].night.amountPaise, 0);

            const rem = m.remainingAmountPaise ?? Math.max(m.billAmountPaise - m.paidAmountPaise, 0);
            const over = m.overpaidAmountPaise ?? Math.max(m.paidAmountPaise - m.billAmountPaise, 0);

            let status = 'paid';
            if (m.billAmountPaise === 0 && m.paidAmountPaise === 0) status = 'no_due';
            else if (rem > 0) status = m.paidAmountPaise > 0 ? 'partial' : 'pending';
            else if (over > 0) status = 'overpaid';

            return [
              id,
              {
                memberId: id,
                memberName: MEMBER_NAMES[id] ?? id,
                morningParticipationCount: mPart,
                nightParticipationCount: nPart,
                totalParticipationCount: mPart + nPart,
                morningShareUnits: mUnits,
                nightShareUnits: nUnits,
                totalShareUnits: totalUnits,
                morningPlateEquivalent: mUnits / 6,
                nightPlateEquivalent: nUnits / 6,
                totalPlateEquivalent: totalUnits / 6,
                morningAmountPaise: mCost,
                nightAmountPaise: nCost,
                billAmountPaise: m.billAmountPaise,
                paidAmountPaise: m.paidAmountPaise,
                remainingAmountPaise: rem,
                overpaidAmountPaise: over,
                status,
              },
            ];
          }),
        );
      } else if (periodType === 'future') {
        summaryRoom = {
          morningPhysicalPlates: 0,
          nightPhysicalPlates: 0,
          totalPhysicalPlates: 0,
          morningAmountPaise: 0,
          nightAmountPaise: 0,
          roomAmountPaise: 0,
          paidAmountPaise: 0,
          remainingAmountPaise: 0,
          overpaidAmountPaise: 0,
          status: 'not_due_yet',
          scheduledPhysicalPlates: scheduledFutureDays.reduce(
            (acc, d) => acc + d.morning.physicalPlates + d.night.physicalPlates,
            0,
          ),
          scheduledAmountPaise: scheduledFutureDays.reduce((acc, d) => acc + d.dailyTotalPaise, 0),
        };

        summaryMembers = Object.fromEntries(
          MEMBER_IDS.map((id) => [
            id,
            {
              memberId: id,
              memberName: MEMBER_NAMES[id] ?? id,
              morningParticipationCount: 0,
              nightParticipationCount: 0,
              totalParticipationCount: 0,
              morningShareUnits: 0,
              nightShareUnits: 0,
              totalShareUnits: 0,
              morningPlateEquivalent: 0,
              nightPlateEquivalent: 0,
              totalPlateEquivalent: 0,
              morningAmountPaise: 0,
              nightAmountPaise: 0,
              billAmountPaise: 0,
              paidAmountPaise: 0,
              remainingAmountPaise: 0,
              overpaidAmountPaise: 0,
              status: 'not_due_yet',
            },
          ]),
        );
      } else {
        // Open Past or Current
        const toDateRoom = monthlyReport.toDate?.room ?? {};
        summaryRoom = {
          morningPhysicalPlates: toDateRoom.morningPhysicalPlates ?? 0,
          nightPhysicalPlates: toDateRoom.nightPhysicalPlates ?? 0,
          totalPhysicalPlates: toDateRoom.totalPhysicalPlates ?? 0,
          morningAmountPaise: toDateRoom.morningAmountPaise ?? 0,
          nightAmountPaise: toDateRoom.nightAmountPaise ?? 0,
          roomAmountPaise: paymentSummary.room.billAmountPaise ?? 0,
          paidAmountPaise: paymentSummary.room.paidAmountPaise ?? 0,
          remainingAmountPaise: paymentSummary.room.remainingAmountPaise ?? 0,
          overpaidAmountPaise: paymentSummary.room.overpaidAmountPaise ?? 0,
          status: paymentSummary.room.status ?? 'no_due',
          scheduledPhysicalPlates: scheduledFutureDays.reduce(
            (acc, d) => acc + d.morning.physicalPlates + d.night.physicalPlates,
            0,
          ),
          scheduledAmountPaise: scheduledFutureDays.reduce((acc, d) => acc + d.dailyTotalPaise, 0),
        };

        summaryMembers = Object.fromEntries(
          MEMBER_IDS.map((id) => {
            const toDateM = monthlyReport.toDate?.members?.[id] ?? {};
            const payM = paymentSummary.members?.[id] ?? {};

            return [
              id,
              {
                memberId: id,
                memberName: MEMBER_NAMES[id] ?? id,
                morningParticipationCount: toDateM.morningParticipationCount ?? 0,
                nightParticipationCount: toDateM.nightParticipationCount ?? 0,
                totalParticipationCount: toDateM.totalParticipationCount ?? 0,
                morningShareUnits: toDateM.morningShareUnits ?? 0,
                nightShareUnits: toDateM.nightShareUnits ?? 0,
                totalShareUnits: toDateM.totalShareUnits ?? 0,
                morningPlateEquivalent: toDateM.morningPlateEquivalent ?? 0,
                nightPlateEquivalent: toDateM.nightPlateEquivalent ?? 0,
                totalPlateEquivalent: toDateM.totalPlateEquivalent ?? 0,
                morningAmountPaise: toDateM.morningAmountPaise ?? 0,
                nightAmountPaise: toDateM.nightAmountPaise ?? 0,
                billAmountPaise: payM.billAmountPaise ?? 0,
                paidAmountPaise: payM.paidAmountPaise ?? 0,
                remainingAmountPaise: payM.remainingAmountPaise ?? 0,
                overpaidAmountPaise: payM.overpaidAmountPaise ?? 0,
                status: payM.status ?? 'no_due',
              },
            ];
          }),
        );
      }

      // Format payments list ascending for audit report
      const formattedPayments = paymentHistory
        .slice()
        .reverse()
        .map((p) => {
          const recDateStr = p.recordedAt ? new Date(p.recordedAt).toISOString().slice(0, 10) : startDate;
          return {
            paymentId: p.paymentId,
            date: formatReportDate(recDateStr).displayDate,
            recordedAtIso: p.recordedAt ? new Date(p.recordedAt).toISOString() : null,
            memberId: p.memberId,
            memberName: MEMBER_NAMES[p.memberId] ?? p.memberId,
            amountPaise: p.amountPaise,
            status: p.status, // 'recorded' | 'voided'
            isVoid: p.status === 'voided',
            method: p.method ?? 'UPI',
            upiReference: p.upiReference?.trim() || null,
          };
        });

      // Verify reconciliation invariants
      verifyExportReconciliation({
        summary: summaryRoom,
        members: summaryMembers,
        actualDays,
        payments: paymentHistory,
        reportState,
        activeSettlement,
      });

      return {
        month,
        monthLabel: formatLogicalMonth(month),
        periodType,
        reportState,
        statusBadgeText,
        generatedAt: currentTime.toISOString(),
        generatedAtFormatted: currentTime.toLocaleString('en-IN', {
          timeZone: timezone,
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
        timezone,
        today,
        reportingPeriod: reportingPeriodLabel,
        scopeStartDate: startDate,
        scopeEndDate,
        prices: {
          morningPricePaise,
          nightPricePaise,
          isFrozen,
        },
        settlement: {
          isClosed,
          settlementId: activeSettlement?.settlementId ?? null,
          sequence: activeSettlement?.sequence ?? null,
          closedAt: activeSettlement?.closedAt
            ? new Date(activeSettlement.closedAt).toLocaleString('en-IN', { timeZone: timezone })
            : null,
        },
        summary: {
          recordedDayCount,
          hasRecordedMeals,
          hasMealActivity,
          hasFinancialActivity: summaryRoom.roomAmountPaise > 0 || summaryRoom.paidAmountPaise > 0,
          ...summaryRoom,
        },
        members: summaryMembers,
        days: actualDays,
        recordedActivityDays,
        scheduledFutureDays,
        payments: formattedPayments,
      };
    },
  });
}

export const monthlyReportExportService = createMonthlyReportExportService();
