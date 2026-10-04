import { monthMealService } from '../calendar/monthMeal.service.js';
import { env } from '../config/env.js';
import { monthlyRateService } from '../billing/monthlyRate.service.js';
import { getLogicalDateInTimeZone } from '../utils/date.js';
import {
  compareLogicalMonths,
  firstDateOfMonth,
  lastDateOfMonth,
} from '../utils/month.js';
import { calculateBillingSummary } from './billing.service.js';

function classifyPeriod(month, today) {
  const comparison = compareLogicalMonths(month, today.slice(0, 7));
  return comparison < 0 ? 'past' : comparison > 0 ? 'future' : 'current';
}

export function createReportService({
  meals = monthMealService,
  rates = monthlyRateService,
  now = () => new Date(),
  timezone = env.appTimezone,
} = {}) {
  return Object.freeze({
    async getMonthlyReport(month) {
      const currentTime = now();
      const today = getLogicalDateInTimeZone(currentTime, timezone);
      const [monthData, rateData] = await Promise.all([
        meals.getMonth(month),
        rates.getRate(month),
      ]);
      const periodType = classifyPeriod(month, today);
      const startDate = firstDateOfMonth(month);
      const endDate = lastDateOfMonth(month);
      const projection = calculateBillingSummary(monthData.days, rateData, {
        startDate,
        endDate,
      });
      const toDate = periodType === 'future'
        ? null
        : calculateBillingSummary(
          periodType === 'current'
            ? monthData.days.filter((day) => day.date <= today)
            : monthData.days,
          rateData,
          { startDate, endDate: periodType === 'current' ? today : endDate },
        );

      const recordedDayCount = monthData.days.filter((day) => day.saved).length;
      const hasRecordedMeals = monthData.days.some((day) =>
        day.saved && (
          Object.values(day.meals?.morning || {}).some((s) => s === 'taking') ||
          Object.values(day.meals?.night || {}).some((s) => s === 'taking')
        ),
      );
      const hasMealActivity = monthData.days.some((day) => day.saved && (day.hasMealActivity ?? true));
      const hasFinancialActivity =
        (projection?.room?.amountPaise ?? 0) > 0 || (toDate?.room?.amountPaise ?? 0) > 0;

      return {
        month,
        periodType,
        today,
        timezone,
        rates: rateData,
        recordedDayCount,
        hasRecordedMeals,
        hasMealActivity,
        hasFinancialActivity,
        toDate,
        projection,
      };
    },
  });
}

export const reportService = createReportService();

