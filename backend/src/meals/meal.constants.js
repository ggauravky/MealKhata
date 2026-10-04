import { MEMBER_IDS } from '../config/members.js';

export const MEAL_TYPES = Object.freeze(['morning', 'night']);
export const MEAL_STATUSES = Object.freeze(['not_set', 'taking', 'skip']);
export const WRITABLE_MEAL_STATUSES = Object.freeze(['taking', 'skip']);
export const DEFAULT_MEAL_STATUS = 'not_set';

export const MEAL_PATHS = Object.freeze(
  Object.fromEntries(
    MEAL_TYPES.map((mealType) => [
      mealType,
      Object.freeze(
        Object.fromEntries(
          MEMBER_IDS.map((memberId) => [memberId, `meals.${mealType}.${memberId}`]),
        ),
      ),
    ]),
  ),
);

export function getMealPath(mealType, memberId) {
  return MEAL_PATHS[mealType]?.[memberId] ?? null;
}

