import { MEMBER_IDS } from '../config/members.js';
import { DEFAULT_MEAL_STATUS, MEAL_TYPES } from './meal.constants.js';
import { normalizeParticipantIds } from './mealParticipants.js';

export function createDefaultMeals(participants = MEMBER_IDS) {
  const participantIds = normalizeParticipantIds(participants);
  return Object.fromEntries(
    MEAL_TYPES.map((mealType) => [
      mealType,
      Object.fromEntries(participantIds.map((studentId) => [studentId, DEFAULT_MEAL_STATUS])),
    ]),
  );
}

export function createDefaultMealDay(date, participants = MEMBER_IDS) {
  return {
    date,
    schemaVersion: 3,
    participantOrder: normalizeParticipantIds(participants),
    meals: createDefaultMeals(participants),
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

