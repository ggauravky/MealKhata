import { MEAL_PRICES } from '../meals/plateAllocation.constants.js';

function serializeDate(value) {
  return value ? new Date(value).toISOString() : null;
}

export function serializeMonthlyRate(document, month) {
  return {
    month,
    configured: true,
    fixed: true,
    source: 'fixed',
    morningPricePaise: MEAL_PRICES.morning,
    nightPricePaise: MEAL_PRICES.night,
    revision: document?.revision ?? 1,
    updatedAt: serializeDate(document?.updatedAt),
  };
}
