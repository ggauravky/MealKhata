import { MEMBER_IDS } from '../config/members.js';
import { env } from '../config/env.js';
import { createDefaultMealDay } from '../meals/meal.defaults.js';
import { mealRepository } from '../meals/meal.repository.js';
import { getEffectiveMealAllocation } from '../meals/plateAllocation.service.js';
import { HttpError } from '../utils/HttpError.js';
import { firstDateOfMonth, lastDateOfMonth, listDatesInMonth } from '../utils/month.js';

function getDayPlateStats(meals, allocations) {
  const morningAlloc = getEffectiveMealAllocation({
    statuses: meals.morning,
    customAllocation: allocations?.morning,
  });
  const nightAlloc = getEffectiveMealAllocation({
    statuses: meals.night,
    customAllocation: allocations?.night,
  });

  const morningTaking = MEMBER_IDS.filter((memberId) => meals.morning[memberId] === 'taking').length;
  const nightTaking = MEMBER_IDS.filter((memberId) => meals.night[memberId] === 'taking').length;

  return {
    morningTaking,
    morningSkipping: MEMBER_IDS.length - morningTaking,
    nightTaking,
    nightSkipping: MEMBER_IDS.length - nightTaking,
    morningPhysicalPlates: morningAlloc.plates.length,
    nightPhysicalPlates: nightAlloc.plates.length,
    totalPhysicalPlates: morningAlloc.plates.length + nightAlloc.plates.length,
    isMorningCustom: morningAlloc.source === 'custom',
    isNightCustom: nightAlloc.source === 'custom',
  };
}

function serializeMonthDay(document, date) {
  const source = document ?? createDefaultMealDay(date);
  const meals = {
    morning: { ...source.meals.morning },
    night: { ...source.meals.night },
  };
  const allocations = source.allocations
    ? {
        morning: source.allocations.morning ? { ...source.allocations.morning } : null,
        night: source.allocations.night ? { ...source.allocations.night } : null,
      }
    : null;

  return {
    date,
    saved: Boolean(document),
    revision: source.revision,
    meals,
    allocations,
    counts: getDayPlateStats(meals, allocations),
  };
}

export function createMonthMealService({ repository = mealRepository, timezone = env.appTimezone } = {}) {
  return Object.freeze({
    async getMonth(month) {
      try {
        const documents = await repository.findInDateRange(
          firstDateOfMonth(month),
          lastDateOfMonth(month),
        );
        const byDate = new Map(documents.map((document) => [document.date, document]));

        return {
          month,
          timezone,
          days: listDatesInMonth(month).map((date) => serializeMonthDay(byDate.get(date), date)),
        };
      } catch (error) {
        throw new HttpError(503, 'Monthly meal data is temporarily unavailable.', { cause: error });
      }
    },
  });
}

export const monthMealService = createMonthMealService();
