import { env } from '../config/env.js';
import { createDefaultMealDay } from './meal.defaults.js';

function serializeDate(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeMealDay(document, date, { timezone = env.appTimezone } = {}) {
  const source = document ?? createDefaultMealDay(date);

  return {
    date,
    timezone,
    saved: Boolean(document),
    revision: source.revision,
    meals: {
      morning: { ...source.meals.morning },
      night: { ...source.meals.night },
    },
    updatedAt: serializeDate(source.updatedAt),
  };
}

export function serializeHistory(document, date, limit) {
  const changes = document?.changes ?? [];
  const items = changes
    .slice(Math.max(0, changes.length - limit))
    .reverse()
    .map((change) => ({
      changedAt: serializeDate(change.changedAt),
      actorRole: change.actorRole,
      actorMemberId: change.actorMemberId ?? null,
      mealType: change.mealType,
      memberId: change.memberId,
      from: change.from,
      to: change.to,
    }));

  return { date, items };
}

