import { MEMBER_IDS } from '../config/members.js';
import { env } from '../config/env.js';
import { mealRepository } from '../meals/meal.repository.js';
import { serializeMealDay } from '../meals/meal.serializer.js';
import { HttpError } from '../utils/HttpError.js';
import { firstDateOfMonth, lastDateOfMonth, listDatesInMonth } from '../utils/month.js';

function serializeMonthDay(document, date, { timezone = env.appTimezone } = {}) {
  const serialized = serializeMealDay(document, date, { timezone });

  const morningTaking = MEMBER_IDS.filter((memberId) => serialized.meals.morning[memberId] === 'taking').length;
  const nightTaking = MEMBER_IDS.filter((memberId) => serialized.meals.night[memberId] === 'taking').length;
  const morningSkipping = MEMBER_IDS.filter((memberId) => serialized.meals.morning[memberId] === 'skip').length;
  const nightSkipping = MEMBER_IDS.filter((memberId) => serialized.meals.night[memberId] === 'skip').length;
  const morningNotSet = MEMBER_IDS.filter((memberId) => (serialized.meals.morning[memberId] ?? 'not_set') === 'not_set').length;
  const nightNotSet = MEMBER_IDS.filter((memberId) => (serialized.meals.night[memberId] ?? 'not_set') === 'not_set').length;

  const isMorningCustom = serialized.allocations.morning.source === 'custom';
  const isNightCustom = serialized.allocations.night.source === 'custom';
  const hasCustomAllocation = isMorningCustom || isNightCustom;

  const hasMealActivity = Boolean(
    document && (
      hasCustomAllocation ||
      Object.values(serialized.meals.morning).some((s) => s === 'taking' || s === 'skip') ||
      Object.values(serialized.meals.night).some((s) => s === 'taking' || s === 'skip')
    ),
  );

  return {
    date,
    saved: serialized.saved,
    hasMealActivity,
    hasCustomAllocation,
    revision: serialized.revision,
    meals: serialized.meals,
    allocations: serialized.allocations,
    counts: {
      morningTaking,
      morningSkipping,
      morningNotSet,
      nightTaking,
      nightSkipping,
      nightNotSet,
      morningPhysicalPlates: serialized.plateCounts.morning,
      nightPhysicalPlates: serialized.plateCounts.night,
      totalPhysicalPlates: serialized.plateCounts.total,
      isMorningCustom,
      isNightCustom,
    },
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
          days: listDatesInMonth(month).map((date) =>
            serializeMonthDay(byDate.get(date), date, { timezone }),
          ),
        };
      } catch (error) {
        throw new HttpError(503, 'Monthly meal data is temporarily unavailable.', { cause: error });
      }
    },
  });
}

export const monthMealService = createMonthMealService();
