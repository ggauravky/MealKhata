import { MEMBER_IDS } from '../config/members.js';
import { env } from '../config/env.js';
import { createDefaultMealDay } from '../meals/meal.defaults.js';
import { mealRepository } from '../meals/meal.repository.js';
import { HttpError } from '../utils/HttpError.js';
import { firstDateOfMonth, lastDateOfMonth, listDatesInMonth } from '../utils/month.js';

function countMeals(meals) {
  const morningTaking = MEMBER_IDS.filter((memberId) => meals.morning[memberId] === 'taking').length;
  const nightTaking = MEMBER_IDS.filter((memberId) => meals.night[memberId] === 'taking').length;

  return {
    morningTaking,
    morningSkipping: MEMBER_IDS.length - morningTaking,
    nightTaking,
    nightSkipping: MEMBER_IDS.length - nightTaking,
  };
}

function serializeMonthDay(document, date) {
  const source = document ?? createDefaultMealDay(date);
  const meals = {
    morning: { ...source.meals.morning },
    night: { ...source.meals.night },
  };

  return {
    date,
    saved: Boolean(document),
    revision: source.revision,
    meals,
    counts: countMeals(meals),
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

