import { env } from '../config/env.js';
import { createDefaultMealDay } from './meal.defaults.js';
import {
  calculateMemberShareUnits,
  getEffectiveMealAllocation,
  splitMealCost,
} from './plateAllocation.service.js';
import { MEAL_PRICES } from './plateAllocation.constants.js';

function serializeDate(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeMealDay(document, date, { timezone = env.appTimezone } = {}) {
  const source = document ?? createDefaultMealDay(date);

  const morningAllocation = getEffectiveMealAllocation({
    statuses: source.meals?.morning,
    customAllocation: source.allocations?.morning,
  });

  const nightAllocation = getEffectiveMealAllocation({
    statuses: source.meals?.night,
    customAllocation: source.allocations?.night,
  });

  const morningUnits = calculateMemberShareUnits(morningAllocation);
  const nightUnits = calculateMemberShareUnits(nightAllocation);

  const morningCost = splitMealCost({
    date,
    mealType: 'morning',
    effectiveAllocation: morningAllocation,
    pricePaise: MEAL_PRICES.morning,
  });

  const nightCost = splitMealCost({
    date,
    mealType: 'night',
    effectiveAllocation: nightAllocation,
    pricePaise: MEAL_PRICES.night,
  });

  return {
    date,
    timezone,
    saved: Boolean(document),
    revision: source.revision,
    meals: {
      morning: { ...source.meals?.morning },
      night: { ...source.meals?.night },
    },
    allocations: {
      morning: {
        mode: morningAllocation.mode,
        source: morningAllocation.source,
        plates: morningAllocation.plates,
        physicalPlates: morningAllocation.plates.length,
        shareUnits: morningUnits,
        cost: morningCost,
      },
      night: {
        mode: nightAllocation.mode,
        source: nightAllocation.source,
        plates: nightAllocation.plates,
        physicalPlates: nightAllocation.plates.length,
        shareUnits: nightUnits,
        cost: nightCost,
      },
    },
    plateCounts: {
      morning: morningAllocation.plates.length,
      night: nightAllocation.plates.length,
      total: morningAllocation.plates.length + nightAllocation.plates.length,
    },
    updatedAt: serializeDate(source.updatedAt),
  };
}

export function serializeHistory(document, date, limit) {
  const changes = document?.changes ?? [];
  const allocationChanges = document?.allocationChanges ?? [];

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
      type: 'status',
    }));

  const serializedAllocations = allocationChanges
    .slice(Math.max(0, allocationChanges.length - limit))
    .reverse()
    .map((change) => ({
      changedAt: serializeDate(change.changedAt),
      actorRole: change.actorRole,
      actorMemberId: change.actorMemberId ?? null,
      mealType: change.mealType,
      changeType: change.changeType,
      from: change.from,
      to: change.to,
      reason: change.reason ?? null,
      type: 'allocation',
    }));

  return {
    date,
    items,
    allocationChanges: serializedAllocations,
  };
}
