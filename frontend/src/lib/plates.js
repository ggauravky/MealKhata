const MEAL_TYPES = Object.freeze(['morning', 'night']);

export function getMealPlateCount(meals = {}) {
  return Object.values(meals).filter((status) => status === 'taking').length;
}

export function getPlateCounts(meals = {}) {
  const counts = Object.fromEntries(
    MEAL_TYPES.map((mealType) => [mealType, getMealPlateCount(meals[mealType])]),
  );

  return Object.freeze({
    ...counts,
    total: counts.morning + counts.night,
  });
}

export function formatPlateCount(count) {
  return `${count} ${count === 1 ? 'plate' : 'plates'}`;
}
