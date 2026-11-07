import { DEFAULT_MEAL_STATUS, MEAL_TYPES } from './meal.constants.js';
import { resolveMealParticipants } from './mealParticipants.js';

export function createDefaultMeals(participants, options) {
  const participantIds = resolveMealParticipants(participants, options);
  return Object.fromEntries(
    MEAL_TYPES.map((mealType) => [
      mealType,
      Object.fromEntries(participantIds.map((studentId) => [studentId, DEFAULT_MEAL_STATUS])),
    ]),
  );
}

export function createDefaultMealDay(date, participants, options) {
  const participantIds = resolveMealParticipants(participants, options);
  return {
    date,
    schemaVersion: 3,
    participantOrder: participantIds,
    meals: createDefaultMeals(participantIds, options),
    allocations: {
      morning: null,
      night: null,
    },
    priceOverrides: {
      morning: null,
      night: null,
    },
    revision: 0,
    changes: [],
    allocationChanges: [],
    priceChanges: [],
  };
}

