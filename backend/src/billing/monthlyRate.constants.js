export const MAX_MEAL_PRICE_PAISE = 10_000_000;

export function isValidPricePaise(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_MEAL_PRICE_PAISE;
}

