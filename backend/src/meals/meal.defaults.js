import { MEMBER_IDS } from '../config/members.js';
import { DEFAULT_MEAL_STATUS, MEAL_TYPES } from './meal.constants.js';

export function createDefaultMeals() {
  return Object.fromEntries(
    MEAL_TYPES.map((mealType) => [
      mealType,
      Object.fromEntries(MEMBER_IDS.map((memberId) => [memberId, DEFAULT_MEAL_STATUS])),
    ]),
  );
}

export function createDefaultMealDay(date) {
  return {
    date,
    meals: createDefaultMeals(),
    revision: 0,
    changes: [],
  };
}

