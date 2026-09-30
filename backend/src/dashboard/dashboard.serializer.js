export function serializeDashboardSummary(data) {
  if (!data) return null;

  return {
    today: data.today,
    currentTime: data.currentTime,
    timezone: data.timezone,
    greeting: data.greeting,
    identity: {
      role: data.identity?.role || 'viewer',
      memberId: data.identity?.memberId || null,
      displayName: data.identity?.displayName || null,
    },
    meals: {
      date: data.meals?.date,
      saved: Boolean(data.meals?.saved),
      revision: data.meals?.revision ?? 0,
      morning: { ...(data.meals?.morning || {}) },
      night: { ...(data.meals?.night || {}) },
      permissions: {
        canEdit: Boolean(data.meals?.permissions?.canEdit),
        editableMemberIds: [...(data.meals?.permissions?.editableMemberIds || [])],
      },
    },
    householdToday: {
      morningPlates: data.householdToday?.morningPlates ?? 0,
      nightPlates: data.householdToday?.nightPlates ?? 0,
      totalPlates: data.householdToday?.totalPlates ?? 0,
      members: (data.householdToday?.members || []).map((m) => ({
        memberId: m.memberId,
        name: m.name,
        morning: m.morning,
        night: m.night,
        plates: m.plates,
      })),
    },
    personalHero: data.personalHero
      ? {
          memberId: data.personalHero.memberId,
          displayName: data.personalHero.displayName,
          morning: data.personalHero.morning,
          night: data.personalHero.night,
          canEdit: Boolean(data.personalHero.canEdit),
        }
      : null,
    currentMonth: {
      month: data.currentMonth?.month,
      monthLabel: data.currentMonth?.monthLabel,
      ratesConfigured: Boolean(data.currentMonth?.ratesConfigured),
      rates: data.currentMonth?.rates
        ? {
            morningPricePaise: data.currentMonth.rates.morningPricePaise,
            nightPricePaise: data.currentMonth.rates.nightPricePaise,
          }
        : null,
      personal: data.currentMonth?.personal
        ? {
            month: data.currentMonth.personal.month,
            monthLabel: data.currentMonth.personal.monthLabel,
            memberId: data.currentMonth.personal.memberId,
            displayName: data.currentMonth.personal.displayName,
            morningCount: data.currentMonth.personal.morningCount,
            nightCount: data.currentMonth.personal.nightCount,
            totalPlates: data.currentMonth.personal.totalPlates,
            billAmountPaise: data.currentMonth.personal.billAmountPaise,
            paidAmountPaise: data.currentMonth.personal.paidAmountPaise,
            remainingAmountPaise: data.currentMonth.personal.remainingAmountPaise,
            overpaidAmountPaise: data.currentMonth.personal.overpaidAmountPaise,
            projectedBillAmountPaise: data.currentMonth.personal.projectedBillAmountPaise,
            status: data.currentMonth.personal.status,
          }
        : null,
      household: data.currentMonth?.household
        ? {
            month: data.currentMonth.household.month,
            monthLabel: data.currentMonth.household.monthLabel,
            morningCount: data.currentMonth.household.morningCount,
            nightCount: data.currentMonth.household.nightCount,
            totalPlates: data.currentMonth.household.totalPlates,
            billAmountPaise: data.currentMonth.household.billAmountPaise,
            projectedBillAmountPaise: data.currentMonth.household.projectedBillAmountPaise,
            paidAmountPaise: data.currentMonth.household.paidAmountPaise,
            remainingAmountPaise: data.currentMonth.household.remainingAmountPaise,
            overpaidAmountPaise: data.currentMonth.household.overpaidAmountPaise,
            ratesConfigured: Boolean(data.currentMonth.household.ratesConfigured),
          }
        : null,
    },
    previousMonthSettlement: {
      month: data.previousMonthSettlement?.month,
      monthLabel: data.previousMonthSettlement?.monthLabel,
      state: data.previousMonthSettlement?.state,
      isClosed: Boolean(data.previousMonthSettlement?.isClosed),
      canClose: Boolean(data.previousMonthSettlement?.canClose),
      blockers: [...(data.previousMonthSettlement?.blockers || [])],
      activeSettlement: data.previousMonthSettlement?.activeSettlement
        ? {
            sequence: data.previousMonthSettlement.activeSettlement.sequence,
            closedAt: data.previousMonthSettlement.activeSettlement.closedAt,
          }
        : null,
    },
    reminders: {
      nextReminder: data.reminders?.nextReminder
        ? {
            mealType: data.reminders.nextReminder.mealType,
            time: data.reminders.nextReminder.time,
            label: data.reminders.nextReminder.label,
            timeFormatted: data.reminders.nextReminder.timeFormatted,
          }
        : null,
      isPushConfigured: Boolean(data.reminders?.isPushConfigured),
    },
    attention: (data.attention || []).map((item) => ({
      id: item.id,
      type: item.type,
      priority: item.priority,
      title: item.title,
      message: item.message,
      link: item.link,
      actionLabel: item.actionLabel,
    })),
    quickActions: (data.quickActions || []).map((action) => ({
      id: action.id,
      label: action.label,
      icon: action.icon,
      to: action.to,
    })),
    errors: data.errors ? { ...data.errors } : undefined,
  };
}
