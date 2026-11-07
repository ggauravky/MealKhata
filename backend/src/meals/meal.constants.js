import { assertSafeStudentId } from '../students/studentId.js';

export const MEAL_TYPES = Object.freeze(['morning', 'night']);
export const MEAL_STATUSES = Object.freeze(['not_set', 'taking', 'skip']);
export const WRITABLE_MEAL_STATUSES = Object.freeze(['taking', 'skip']);
export const DEFAULT_MEAL_STATUS = 'not_set';

export function getMealPath(mealType, memberId) {
  if (!MEAL_TYPES.includes(mealType)) return null;
  assertSafeStudentId(memberId);
  return `meals.${mealType}.${memberId}`;
}

