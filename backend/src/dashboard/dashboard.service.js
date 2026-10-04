import { ROLES } from '../auth/permissions.js';
import { env, isPushConfigured } from '../config/env.js';
import { MEMBERS } from '../config/members.js';
import { mealService as defaultMealService } from '../meals/meal.service.js';
import {
  calculateMemberShareUnits,
  getEffectiveMealAllocation,
  splitMealCost,
} from '../meals/plateAllocation.service.js';
import { MEAL_PRICES } from '../meals/plateAllocation.constants.js';
import { paymentSummaryService as defaultPaymentSummaryService } from '../payments/paymentSummary.service.js';
import { getLogicalTimeInTimeZone } from '../push/reminderDispatch.service.js';
import { reportService as defaultReportService } from '../reports/report.service.js';
import { reminderSettingsService as defaultReminderSettingsService } from '../settings/reminderSettings.service.js';
import { settlementService as defaultSettlementService } from '../settlement/settlement.service.js';
import { canEditDate, getIndiaGreeting, getLogicalDateInTimeZone } from '../utils/date.js';
import { formatLogicalMonth, getPreviousLogicalMonth } from '../utils/month.js';

function formatPaiseCurrency(paise) {
  if (!Number.isSafeInteger(paise)) return '₹0';
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

export function createDashboardService({
  mealService = defaultMealService,
  reportService = defaultReportService,
  paymentSummaryService = defaultPaymentSummaryService,
  settlementService = defaultSettlementService,
  reminderSettingsService = defaultReminderSettingsService,
  pushConfigured = isPushConfigured,
  now = () => new Date(),
  timezone = env.appTimezone,
} = {}) {
  return Object.freeze({
    async getDashboardSummary({ auth }) {
      const actorRole = auth?.role || ROLES.VIEWER;
      const actorMemberId = auth?.memberId || null;
      const displayName =
        auth?.displayName ||
        (actorMemberId ? MEMBERS.find((m) => m.id === actorMemberId)?.name : null);

      const currentNow = now();
      const today = getLogicalDateInTimeZone(currentNow, timezone);
      const currentMonth = today.slice(0, 7);
      const previousMonth = getPreviousLogicalMonth(currentMonth);
      const currentTime = getLogicalTimeInTimeZone(currentNow, timezone);
      const greetingPrefix = getIndiaGreeting(currentNow, timezone);

      let greeting = 'Today';
      if (actorRole === ROLES.MEMBER && displayName) {
        greeting = `${greetingPrefix}, ${displayName}`;
      } else if (actorRole === ROLES.ADMIN) {
        greeting = `${greetingPrefix}, Admin`;
      } else if (actorRole === ROLES.SUPERADMIN) {
        greeting = `${greetingPrefix}, Super Admin`;
      }

      // Parallel data retrieval with graceful failure tolerance
      const [
        todayMealsResult,
        monthlyReportResult,
        paymentSummaryResult,
        settlementStatusResult,
        reminderSettingsResult,
      ] = await Promise.allSettled([
        mealService.getDay(today),
        reportService.getMonthlyReport(currentMonth),
        paymentSummaryService.getSummary(currentMonth),
        settlementService.getSettlementStatus(previousMonth),
        reminderSettingsService.getSettings(),
      ]);

      const errors = {};

      // 1. Process Today's Meals & Household
      let todayDay = null;
      if (todayMealsResult.status === 'fulfilled') {
        todayDay = todayMealsResult.value;
      } else {
        errors.todayMeals = todayMealsResult.reason?.message || 'Failed to fetch meals';
      }

      const defaultMealStatus = 'not_set';
      const morningMeals = todayDay?.meals?.morning || {
        gaurav: defaultMealStatus,
        nikhil: defaultMealStatus,
        devansh: defaultMealStatus,
      };
      const nightMeals = todayDay?.meals?.night || {
        gaurav: defaultMealStatus,
        nikhil: defaultMealStatus,
        devansh: defaultMealStatus,
      };

      const morningAllocation = getEffectiveMealAllocation({
        statuses: morningMeals,
        customAllocation: todayDay?.allocations?.morning,
      });

      const nightAllocation = getEffectiveMealAllocation({
        statuses: nightMeals,
        customAllocation: todayDay?.allocations?.night,
      });

      const morningUnits = calculateMemberShareUnits(morningAllocation);
      const nightUnits = calculateMemberShareUnits(nightAllocation);

      const morningCost = splitMealCost({
        date: today,
        mealType: 'morning',
        effectiveAllocation: morningAllocation,
        pricePaise: MEAL_PRICES.morning,
      });

      const nightCost = splitMealCost({
        date: today,
        mealType: 'night',
        effectiveAllocation: nightAllocation,
        pricePaise: MEAL_PRICES.night,
      });

      const morningEating = MEMBERS.filter((m) => morningMeals[m.id] === 'taking').length;
      const nightEating = MEMBERS.filter((m) => nightMeals[m.id] === 'taking').length;
      const morningPlates = morningAllocation.plates.length;
      const nightPlates = nightAllocation.plates.length;
      const totalPlatesToday = morningPlates + nightPlates;

      const memberPlates = MEMBERS.map((m) => {
        const mUnits = morningUnits[m.id] ?? 0;
        const nUnits = nightUnits[m.id] ?? 0;
        const totalUnits = mUnits + nUnits;
        const mCost = morningCost.members[m.id]?.amountPaise ?? 0;
        const nCost = nightCost.members[m.id]?.amountPaise ?? 0;

        return {
          memberId: m.id,
          name: m.name,
          morning: morningMeals[m.id] || defaultMealStatus,
          night: nightMeals[m.id] || defaultMealStatus,
          morningShareUnits: mUnits,
          nightShareUnits: nUnits,
          totalShareUnits: totalUnits,
          morningCostPaise: mCost,
          nightCostPaise: nCost,
          totalCostPaise: mCost + nCost,
          plates: totalUnits / 6,
        };
      });

      const canEdit = canEditDate({
        role: actorRole,
        targetDate: today,
        now: currentNow,
        timeZone: timezone,
      });

      const editableMemberIds =
        actorRole === ROLES.MEMBER && actorMemberId
          ? [actorMemberId]
          : actorRole === ROLES.ADMIN || actorRole === ROLES.SUPERADMIN
            ? MEMBERS.map((m) => m.id)
            : [];

      // 2. Member Hero (Personal meals today)
      let personalHero = null;
      if (actorRole === ROLES.MEMBER && actorMemberId) {
        const mUnits = morningUnits[actorMemberId] ?? 0;
        const nUnits = nightUnits[actorMemberId] ?? 0;
        const mCost = morningCost.members[actorMemberId]?.amountPaise ?? 0;
        const nCost = nightCost.members[actorMemberId]?.amountPaise ?? 0;

        personalHero = {
          memberId: actorMemberId,
          displayName,
          morning: morningMeals[actorMemberId] || defaultMealStatus,
          night: nightMeals[actorMemberId] || defaultMealStatus,
          morningShareUnits: mUnits,
          nightShareUnits: nUnits,
          morningPlateEquivalent: mUnits / 6,
          nightPlateEquivalent: nUnits / 6,
          morningCostPaise: mCost,
          nightCostPaise: nCost,
          totalCostPaise: mCost + nCost,
          isMorningShared: morningAllocation.source === 'custom',
          isNightShared: nightAllocation.source === 'custom',
          canEdit,
        };
      }

      // 3. Current Month Stats (Report + Payments)
      let report = null;
      if (monthlyReportResult.status === 'fulfilled') {
        report = monthlyReportResult.value;
      } else {
        errors.monthlyReport = monthlyReportResult.reason?.message || 'Failed to fetch report';
      }

      let paymentSummary = null;
      if (paymentSummaryResult.status === 'fulfilled') {
        paymentSummary = paymentSummaryResult.value;
      } else {
        errors.paymentSummary = paymentSummaryResult.reason?.message || 'Failed to fetch payment summary';
      }

      const rates = {
        morningPricePaise: MEAL_PRICES.morning,
        nightPricePaise: MEAL_PRICES.night,
      };

      let personalMonthly = null;
      if (actorRole === ROLES.MEMBER && actorMemberId) {
        const repToDate = report?.toDate?.members?.[actorMemberId];
        const repProj = report?.projection?.members?.[actorMemberId];
        const payMem = paymentSummary?.members?.[actorMemberId];

        personalMonthly = {
          month: currentMonth,
          monthLabel: formatLogicalMonth(currentMonth),
          memberId: actorMemberId,
          displayName,
          morningCount: repToDate?.morningParticipationCount ?? repToDate?.morningCount ?? 0,
          nightCount: repToDate?.nightParticipationCount ?? repToDate?.nightCount ?? 0,
          morningShareUnits: repToDate?.morningShareUnits ?? 0,
          nightShareUnits: repToDate?.nightShareUnits ?? 0,
          totalShareUnits: repToDate?.totalShareUnits ?? 0,
          totalPlates: repToDate?.totalPlateEquivalent ?? repToDate?.totalPlates ?? 0,
          billAmountPaise: payMem?.billAmountPaise ?? 0,
          paidAmountPaise: payMem?.paidAmountPaise ?? 0,
          remainingAmountPaise: payMem?.remainingAmountPaise ?? 0,
          overpaidAmountPaise: payMem?.overpaidAmountPaise ?? 0,
          projectedBillAmountPaise: payMem?.projectedBillAmountPaise ?? repProj?.amountPaise ?? 0,
          status: payMem?.status ?? 'no_due',
        };
      }

      let householdMonthly = null;
      if (report?.toDate?.room || report?.projection?.room) {
        const roomToDate = report?.toDate?.room;
        const roomProj = report?.projection?.room;
        const roomPay = paymentSummary?.room;

        householdMonthly = {
          month: currentMonth,
          monthLabel: formatLogicalMonth(currentMonth),
          morningCount: roomToDate?.morningPhysicalPlates ?? roomToDate?.morningCount ?? 0,
          nightCount: roomToDate?.nightPhysicalPlates ?? roomToDate?.nightCount ?? 0,
          totalPlates: roomToDate?.totalPhysicalPlates ?? roomToDate?.totalPlates ?? 0,
          morningParticipants: roomToDate?.morningParticipants ?? 0,
          nightParticipants: roomToDate?.nightParticipants ?? 0,
          billAmountPaise: roomPay?.billAmountPaise ?? 0,
          projectedBillAmountPaise: roomPay?.projectedBillAmountPaise ?? roomProj?.amountPaise ?? 0,
          paidAmountPaise: roomPay?.paidAmountPaise ?? 0,
          remainingAmountPaise: roomPay?.remainingAmountPaise ?? 0,
          overpaidAmountPaise: roomPay?.overpaidAmountPaise ?? 0,
          ratesConfigured: true,
        };
      }

      // 4. Previous Month Settlement
      let settlementStatus = null;
      if (settlementStatusResult.status === 'fulfilled') {
        settlementStatus = settlementStatusResult.value;
      } else {
        errors.settlement = settlementStatusResult.reason?.message || 'Failed to fetch settlement';
      }

      const settlementSummary = {
        month: previousMonth,
        monthLabel: formatLogicalMonth(previousMonth),
        state: settlementStatus?.state || 'not_ready',
        isClosed: settlementStatus?.state === 'closed',
        canClose: Boolean(settlementStatus?.canClose),
        blockers: settlementStatus?.blockers || [],
        activeSettlement: settlementStatus?.activeSettlement
          ? {
              sequence: settlementStatus.activeSettlement.sequence,
              closedAt: settlementStatus.activeSettlement.closedAt,
            }
          : null,
      };

      // 5. Next Reminder
      let reminderSettings = null;
      if (reminderSettingsResult.status === 'fulfilled') {
        reminderSettings = reminderSettingsResult.value;
      } else {
        errors.reminders = reminderSettingsResult.reason?.message || 'Failed to fetch reminder settings';
      }

      let nextReminder = null;
      if (reminderSettings?.reminders) {
        const morning = reminderSettings.reminders.morning;
        const night = reminderSettings.reminders.night;

        if (morning?.enabled && currentTime <= morning.time) {
          nextReminder = {
            mealType: 'morning',
            time: morning.time,
            label: 'Morning Meal',
            timeFormatted: `${morning.time} AM`,
          };
        } else if (night?.enabled && currentTime <= night.time) {
          nextReminder = {
            mealType: 'night',
            time: night.time,
            label: 'Night Meal',
            timeFormatted: `${night.time} PM`,
          };
        } else if (morning?.enabled) {
          nextReminder = {
            mealType: 'morning',
            time: morning.time,
            label: 'Morning Meal (Tomorrow)',
            timeFormatted: `${morning.time} AM`,
          };
        } else if (night?.enabled) {
          nextReminder = {
            mealType: 'night',
            time: night.time,
            label: 'Night Meal (Tomorrow)',
            timeFormatted: `${night.time} PM`,
          };
        }
      }

      // 6. Role-Aware Deterministic Attention Items
      const attention = [];

      // Priority 1: Financial actions (for Members)
      if (actorRole === ROLES.MEMBER && personalMonthly) {
        if (personalMonthly.remainingAmountPaise > 0) {
          attention.push({
            id: 'payment_due',
            type: 'financial',
            priority: 1,
            title: 'Outstanding Balance',
            message: `You have ${formatPaiseCurrency(personalMonthly.remainingAmountPaise)} remaining for ${personalMonthly.monthLabel}.`,
            link: `/payments?month=${currentMonth}`,
            actionLabel: 'Go to Payments',
          });
        } else if (personalMonthly.overpaidAmountPaise > 0) {
          attention.push({
            id: 'payment_overpaid',
            type: 'financial',
            priority: 1,
            title: 'Overpaid Balance',
            message: `You are overpaid by ${formatPaiseCurrency(personalMonthly.overpaidAmountPaise)} for ${personalMonthly.monthLabel}.`,
            link: `/payments?month=${currentMonth}`,
            actionLabel: 'View Payments',
          });
        }
      }

      // Priority 2: Previous month settlement
      if (settlementSummary.state === 'ready_to_close') {
        if (actorRole === ROLES.SUPERADMIN) {
          attention.push({
            id: 'settlement_ready',
            type: 'settlement',
            priority: 2,
            title: 'Settlement Ready',
            message: `${settlementSummary.monthLabel} is fully settled and ready to close.`,
            link: `/reports?month=${previousMonth}`,
            actionLabel: 'Close Month',
          });
        } else if (actorRole === ROLES.ADMIN) {
          attention.push({
            id: 'settlement_ready',
            type: 'settlement',
            priority: 3,
            title: 'Settlement Ready',
            message: `${settlementSummary.monthLabel} is fully settled. Super Admin can now close the month.`,
            link: `/reports?month=${previousMonth}`,
            actionLabel: 'View Settlement',
          });
        }
      } else if (settlementSummary.state === 'not_ready' && actorRole === ROLES.SUPERADMIN) {
        if (settlementSummary.blockers.length > 0) {
          attention.push({
            id: 'settlement_blocked',
            type: 'settlement',
            priority: 4,
            title: 'Settlement Blockers',
            message: `${settlementSummary.monthLabel} has outstanding balances to resolve before closing.`,
            link: `/reports?month=${previousMonth}`,
            actionLabel: 'View Settlement',
          });
        }
      } else if (settlementSummary.state === 'closed' && actorRole === ROLES.MEMBER) {
        attention.push({
          id: 'statement_available',
          type: 'informational',
          priority: 5,
          title: 'Previous Statement Ready',
          message: `${settlementSummary.monthLabel} statement is closed. Final statement is available.`,
          link: `/reports?month=${previousMonth}`,
          actionLabel: 'View Report',
        });
      }

      attention.sort((a, b) => a.priority - b.priority);

      // 7. Role-Aware Quick Actions
      let quickActions;
      if (actorRole === ROLES.MEMBER) {
        quickActions = [
          { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', to: '/calendar' },
          { id: 'reports', label: 'Reports', icon: 'ChartNoAxesCombined', to: `/reports?month=${currentMonth}` },
          { id: 'payments', label: 'Payments', icon: 'CreditCard', to: `/payments?month=${currentMonth}` },
        ];
      } else if (actorRole === ROLES.ADMIN) {
        quickActions = [
          { id: 'manage-today', label: "Manage Today's Meals", icon: 'UtensilsCrossed', to: `/admin?date=${today}` },
          { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', to: '/calendar' },
          { id: 'reports', label: 'Reports', icon: 'ChartNoAxesCombined', to: `/reports?month=${currentMonth}` },
          { id: 'payments', label: 'Payments', icon: 'CreditCard', to: `/payments?month=${currentMonth}` },
        ];
      } else if (actorRole === ROLES.SUPERADMIN) {
        quickActions = [
          { id: 'manage-today', label: "Manage Today's Meals", icon: 'UtensilsCrossed', to: `/admin?date=${today}` },
          { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', to: '/calendar' },
          { id: 'reports', label: 'Reports', icon: 'ChartNoAxesCombined', to: `/reports?month=${currentMonth}` },
          { id: 'payments', label: 'Payments', icon: 'CreditCard', to: `/payments?month=${currentMonth}` },
          { id: 'settlement', label: 'Monthly Settlement', icon: 'FileCheck', to: `/reports?month=${previousMonth}` },
          { id: 'reminders', label: 'Reminder Settings', icon: 'Bell', to: '/admin' },
        ];
      } else {
        // Viewer
        quickActions = [
          { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', to: '/calendar' },
          { id: 'reports', label: 'Reports', icon: 'ChartNoAxesCombined', to: '/reports' },
          { id: 'payments', label: 'Payments', icon: 'CreditCard', to: '/payments' },
        ];
      }

      return {
        today,
        currentTime,
        timezone,
        greeting,
        identity: {
          role: actorRole,
          memberId: actorMemberId,
          displayName,
        },
        meals: {
          date: today,
          saved: Boolean(todayDay?.saved),
          revision: todayDay?.revision ?? 0,
          morning: morningMeals,
          night: nightMeals,
          allocations: {
            morning: morningAllocation,
            night: nightAllocation,
          },
          permissions: {
            canEdit,
            editableMemberIds,
          },
        },
        householdToday: {
          morningPlates,
          nightPlates,
          totalPlates: totalPlatesToday,
          morningEating,
          nightEating,
          totalEating: morningEating + nightEating,
          isMorningCustom: morningAllocation.source === 'custom',
          isNightCustom: nightAllocation.source === 'custom',
          members: memberPlates,
        },
        personalHero,
        currentMonth: {
          month: currentMonth,
          monthLabel: formatLogicalMonth(currentMonth),
          ratesConfigured: true,
          rates,
          personal: personalMonthly,
          household: householdMonthly,
        },
        previousMonthSettlement: settlementSummary,
        reminders: {
          nextReminder,
          isPushConfigured: pushConfigured,
        },
        attention,
        quickActions,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
      };
    },
  });
}

export const dashboardService = createDashboardService();
