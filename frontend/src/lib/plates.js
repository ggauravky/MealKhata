export const SHARE_UNITS_PER_PLATE = 6;
export const MAX_MEMBER_SHARE_UNITS = 6;
export const MORNING_PRICE_PAISE = 5000;
export const NIGHT_PRICE_PAISE = 7000;
export const MEAL_PRICES = Object.freeze({ morning: MORNING_PRICE_PAISE, night: NIGHT_PRICE_PAISE });
export const ALLOCATION_MODES = Object.freeze({ DEFAULT: 'default', CUSTOM: 'custom' });
export const PRESET_NAMES = Object.freeze({
  INDIVIDUAL: 'individual', ONE_PLATE_TWO_SHARED: 'one_plate_two_shared',
  ONE_PLATE_THREE_SHARED: 'one_plate_three_shared', TWO_PLATES_THREE_EQUAL: 'two_plates_three_equal',
  TWO_PLATES_ONE_FULL_TWO_HALF: 'two_plates_one_full_two_half', THREE_PLATES_THREE_FULL: 'three_plates_three_full',
});

function normalizeParticipantIds(participants = []) {
  if (!Array.isArray(participants)) throw new TypeError('participants must be an array');
  const ids = participants.map((item) => typeof item === 'string' ? item : item?.studentId);
  if (ids.some((id) => typeof id !== 'string' || !/^[a-z0-9_-]+$/.test(id)
    || ['__proto__', 'constructor', 'prototype'].includes(id))) throw new TypeError('Invalid student ID');
  return [...new Set(ids)];
}

function participantsFromAllocation(allocation) {
  return normalizeParticipantIds((allocation?.plates ?? []).flatMap((plate) => Object.keys(plate.shares ?? {})));
}

export function getMealPlateCount(meals = {}) {
  return Object.values(meals ?? {}).filter((status) => status === 'taking').length;
}

export function getPlateCounts(meals = {}) {
  const morning = getMealPlateCount(meals.morning);
  const night = getMealPlateCount(meals.night);
  return Object.freeze({ morning, night, total: morning + night });
}

export function formatPlateCount(count) { return `${count} ${count === 1 ? 'plate' : 'plates'}`; }

export function validatePlateAllocation(allocation, { participants = participantsFromAllocation(allocation), maxPhysicalPlates = Math.min(100, Math.max(3, participants.length)) } = {}) {
  const participantIds = normalizeParticipantIds(participants);
  if (!allocation || typeof allocation !== 'object') {
    throw new Error('Allocation must be an object or array of plates');
  }

  const plates = Array.isArray(allocation) ? allocation : allocation.plates;
  const mode = Array.isArray(allocation) ? ALLOCATION_MODES.CUSTOM : (allocation.mode || ALLOCATION_MODES.CUSTOM);

  if (mode !== ALLOCATION_MODES.CUSTOM && mode !== ALLOCATION_MODES.DEFAULT) {
    throw new Error(`Invalid allocation mode: ${mode}`);
  }

  if (!Array.isArray(plates)) {
    throw new Error('Allocation plates must be an array');
  }

  if (!Number.isInteger(maxPhysicalPlates) || maxPhysicalPlates < 1 || maxPhysicalPlates > 100) {
    throw new Error('Maximum physical plates must be an integer from 1 to 100');
  }
  if (plates.length > maxPhysicalPlates) {
    throw new Error(`Cannot allocate more than ${maxPhysicalPlates} physical plates per meal`);
  }

  const memberTotalUnits = Object.fromEntries(participantIds.map((id) => [id, 0]));

  for (let i = 0; i < plates.length; i += 1) {
    const plate = plates[i];
    if (!plate || typeof plate !== 'object' || typeof plate.shares !== 'object' || Array.isArray(plate.shares)) {
      throw new Error(`Plate #${i + 1} must contain a valid shares object`);
    }

    const { shares } = plate;
    let plateTotal = 0;

    for (const key of Object.keys(shares)) {
      if (!participantIds.includes(key)) {
        throw new Error(`Unknown member '${key}' on plate #${i + 1}`);
      }
    }

    for (const memberId of participantIds) {
      const units = shares[memberId] ?? 0;

      if (!Number.isInteger(units) || units < 0 || units > SHARE_UNITS_PER_PLATE) {
        throw new Error(
          `Plate #${i + 1} shares for ${memberId} must be an integer between 0 and ${SHARE_UNITS_PER_PLATE}`,
        );
      }

      plateTotal += units;
      memberTotalUnits[memberId] += units;
    }

    if (plateTotal !== SHARE_UNITS_PER_PLATE) {
      throw new Error(
        `Plate #${i + 1} must total exactly ${SHARE_UNITS_PER_PLATE} share units (received ${plateTotal})`,
      );
    }
  }

  for (const memberId of participantIds) {
    if (memberTotalUnits[memberId] > MAX_MEMBER_SHARE_UNITS) {
      throw new Error(
        `Member '${memberId}' total allocation across plates cannot exceed 1 full plate equivalent (6 units) (received ${memberTotalUnits[memberId]})`,
      );
    }
  }

  return {
    mode,
    plates: plates.map((plate) => ({
      shares: Object.fromEntries(
        participantIds.map((id) => [id, plate.shares[id] ?? 0]),
      ),
    })),
  };
}

export function getEffectiveMealAllocation({ statuses = {}, customAllocation = null, participants = Object.keys(statuses) } = {}) {
  const participantIds = normalizeParticipantIds(participants);
  let result;
  if (customAllocation && customAllocation.mode === ALLOCATION_MODES.CUSTOM && Array.isArray(customAllocation.plates)) {
    for (const plate of customAllocation.plates) {
      for (const studentId of Object.keys(plate.shares ?? {})) {
        if (!participantIds.includes(studentId)) {
          throw new TypeError(`Unknown participant '${studentId}' in stored meal allocation`);
        }
      }
    }
    result = {
      mode: ALLOCATION_MODES.CUSTOM,
      source: 'custom',
      plates: customAllocation.plates.map((plate) => ({
        shares: Object.fromEntries(
          participantIds.map((id) => [id, plate.shares?.[id] ?? 0]),
        ),
      })),
    };
  } else {
    const plates = [];
    for (const memberId of participantIds) {
      if (statuses[memberId] === 'taking') {
        const shares = Object.fromEntries(participantIds.map((id) => [id, 0]));
        shares[memberId] = SHARE_UNITS_PER_PLATE;
        plates.push({ shares });
      }
    }

    result = {
      mode: ALLOCATION_MODES.DEFAULT,
      source: 'default',
      plates,
    };
  }

  result.shareUnits = calculateMemberShareUnits(result, { participants: participantIds });
  return result;
}

export function calculateMemberShareUnits(effectiveAllocation, { participants = participantsFromAllocation(effectiveAllocation) } = {}) {
  const participantIds = normalizeParticipantIds(participants);
  const units = Object.fromEntries(participantIds.map((id) => [id, 0]));
  const plates = effectiveAllocation?.plates ?? [];

  for (const plate of plates) {
    for (const memberId of participantIds) {
      units[memberId] += plate.shares?.[memberId] ?? 0;
    }
  }

  const totalUnits = Object.values(units).reduce((sum, u) => sum + u, 0);
  return { ...units, totalUnits };
}

export function deriveParticipationStatuses(effectiveAllocation, { participants = participantsFromAllocation(effectiveAllocation) } = {}) {
  const participantIds = normalizeParticipantIds(participants);
  const units = calculateMemberShareUnits(effectiveAllocation, { participants: participantIds });
  return Object.fromEntries(
    participantIds.map((id) => [id, units[id] > 0 ? 'taking' : 'skip']),
  );
}

function getDeterministicRotation(date, mealType, participantIds) {
  if (!date || participantIds.length === 0) return [...participantIds];

  const dateParts = date.split('-').map((p) => Number.parseInt(p, 10));
  const numericSum = dateParts.reduce((acc, n) => acc + (Number.isNaN(n) ? 0 : n), 0);
  const offset = (numericSum + (mealType === 'night' ? 1 : 0)) % participantIds.length;

  return [...participantIds.slice(offset), ...participantIds.slice(0, offset)];
}

export function resolveMealPricePaise({ day, mealType, fallbackPricePaise }) {
  const override = day?.priceOverrides?.[mealType];
  if (
    override &&
    typeof override.pricePaise === 'number' &&
    Number.isInteger(override.pricePaise) &&
    override.pricePaise >= 0
  ) {
    return override.pricePaise;
  }
  if (day?.pricing?.[mealType]?.isOverridden && typeof day.pricing[mealType].overridePricePaise === 'number') {
    return day.pricing[mealType].overridePricePaise;
  }
  return fallbackPricePaise ?? MEAL_PRICES[mealType] ?? 0;
}

export const getEffectiveMealPricePaise = resolveMealPricePaise;

export function splitMealCost({
  date = '',
  mealType = 'morning',
  effectiveAllocation,
  allocation,
  pricePaise = MEAL_PRICES[mealType] ?? 0,
  participants = participantsFromAllocation(effectiveAllocation || allocation),
}) {
  const participantIds = normalizeParticipantIds(participants);
  const targetAllocation = effectiveAllocation || allocation;
  const plates = targetAllocation?.plates ?? [];
  const physicalPlates = plates.length;
  const totalCostPaise = physicalPlates * pricePaise;

  if (!Number.isSafeInteger(pricePaise) || pricePaise < 0 || !Number.isSafeInteger(totalCostPaise)) {
    throw new TypeError('Meal price and total cost must be safe non-negative integer paise');
  }
  for (const plate of plates) {
    const entries = Object.entries(plate.shares ?? {});
    let units = 0;
    for (const [studentId, shareUnits] of entries) {
      if (!participantIds.includes(studentId)) throw new TypeError(`Unknown participant '${studentId}' in meal allocation`);
      if (!Number.isInteger(shareUnits) || shareUnits < 0 || shareUnits > SHARE_UNITS_PER_PLATE) {
        throw new TypeError('Meal share units must be integers from 0 to 6');
      }
      units += shareUnits;
    }
    if (units !== SHARE_UNITS_PER_PLATE) throw new TypeError('Each physical plate must have exactly six share units');
  }

  if (physicalPlates === 0) {
    return {
      physicalPlates: 0,
      physicalPlateCount: 0,
      pricePaise,
      totalCostPaise: 0,
      members: Object.fromEntries(
        participantIds.map((id) => [
          id,
          {
            shareUnits: 0,
            amountPaise: 0,
            plateEquivalent: 0,
          },
        ]),
      ),
      memberAmountsPaise: Object.fromEntries(participantIds.map((id) => [id, 0])),
      roomAmountPaise: 0,
    };
  }

  const memberUnits = calculateMemberShareUnits(targetAllocation, { participants: participantIds });
  const totalWeight = physicalPlates * SHARE_UNITS_PER_PLATE;
  if (memberUnits.totalUnits !== totalWeight
    || participantIds.some((studentId) => memberUnits[studentId] > MAX_MEMBER_SHARE_UNITS)) {
    throw new TypeError('Meal shares must conserve plates and cannot exceed six units per participant');
  }

  const baseAmounts = {};
  const remainders = {};
  let allocatedBaseSum = 0;

  for (const memberId of participantIds) {
    const units = memberUnits[memberId] ?? 0;
    const numerator = totalCostPaise * units;
    if (!Number.isSafeInteger(numerator)) {
      throw new TypeError('Meal cost multiplication exceeds safe integer paise');
    }
    const base = Math.floor(numerator / totalWeight);
    const remainder = numerator % totalWeight;

    baseAmounts[memberId] = base;
    remainders[memberId] = remainder;
    allocatedBaseSum += base;
  }

  const leftoverPaise = totalCostPaise - allocatedBaseSum;
  if (leftoverPaise < 0 || leftoverPaise > participantIds.length) {
    throw new TypeError('Meal allocation cannot conserve the exact plate cost');
  }
  const priorityOrder = getDeterministicRotation(date, mealType, participantIds);

  const sortedMembers = [...participantIds].sort((a, b) => {
    const remDiff = remainders[b] - remainders[a];
    if (remDiff !== 0) return remDiff;
    return priorityOrder.indexOf(a) - priorityOrder.indexOf(b);
  });

  const finalAmounts = { ...baseAmounts };
  for (let i = 0; i < leftoverPaise; i += 1) {
    const memberId = sortedMembers[i % sortedMembers.length];
    finalAmounts[memberId] += 1;
  }

  const membersResult = Object.fromEntries(
    participantIds.map((memberId) => {
      const units = memberUnits[memberId] ?? 0;
      return [
        memberId,
        {
          shareUnits: units,
          amountPaise: finalAmounts[memberId],
          plateEquivalent: units / SHARE_UNITS_PER_PLATE,
        },
      ];
    }),
  );

  return {
    physicalPlates,
    physicalPlateCount: physicalPlates,
    pricePaise,
    totalCostPaise,
    members: membersResult,
    memberAmountsPaise: Object.fromEntries(
      participantIds.map((memberId) => [memberId, finalAmounts[memberId]]),
    ),
    roomAmountPaise: totalCostPaise,
  };
}

export function formatPlateFraction(shareUnits) {
  if (shareUnits === 0 || !shareUnits) return '0';

  const FRACTIONS = {
    1: '⅙',
    2: '⅓',
    3: '½',
    4: '⅔',
    5: '⅚',
  };

  const whole = Math.floor(shareUnits / SHARE_UNITS_PER_PLATE);
  const remainder = shareUnits % SHARE_UNITS_PER_PLATE;

  if (remainder === 0) {
    return String(whole);
  }

  const frac = FRACTIONS[remainder] ?? `${remainder}/6`;
  if (whole === 0) {
    return frac;
  }

  return `${whole}${frac}`;
}

export function formatPlateFractionAccessible(shareUnits) {
  if (!shareUnits) return '0 plates';
  const labels = { 1: 'one-sixth plate', 2: 'one-third plate', 3: 'half plate',
    4: 'two-thirds plate', 5: 'five-sixths plate', 6: 'one plate' };
  if (shareUnits <= 6) return labels[shareUnits];
  const whole = Math.floor(shareUnits / 6);
  const remainder = shareUnits % 6;
  return remainder ? `${whole} and ${labels[remainder]}` : `${whole} plates`;
}

export function createPresetAllocation(presetName, { participants = [], members = participants, fullMemberId = null } = {}) {
  const participantIds = normalizeParticipantIds(participants);
  const selected = normalizeParticipantIds(members);
  if (selected.some((id) => !participantIds.includes(id))) throw new Error('Preset contains an ineligible student');
  switch (presetName) {
    case PRESET_NAMES.INDIVIDUAL: {
      const plates = selected.map((m) => {
        const shares = Object.fromEntries(participantIds.map((id) => [id, 0]));
        shares[m] = SHARE_UNITS_PER_PLATE;
        return { shares };
      });
      return { mode: ALLOCATION_MODES.DEFAULT, plates };
    }

    case PRESET_NAMES.ONE_PLATE_TWO_SHARED: {
      if (selected.length !== 2) {
        throw new Error('1 Plate / 2 People preset requires exactly 2 members');
      }
      const shares = Object.fromEntries(participantIds.map((id) => [id, 0]));
      shares[selected[0]] = 3;
      shares[selected[1]] = 3;
      return {
        mode: ALLOCATION_MODES.CUSTOM,
        plates: [{ shares }],
      };
    }

    case PRESET_NAMES.ONE_PLATE_THREE_SHARED: {
      if (selected.length !== 3) throw new Error('1 Plate / 3 People preset requires exactly 3 members');
      const shares = Object.fromEntries(participantIds.map((id) => [id, selected.includes(id) ? 2 : 0]));
      return {
        mode: ALLOCATION_MODES.CUSTOM,
        plates: [{ shares }],
      };
    }

    case PRESET_NAMES.TWO_PLATES_THREE_EQUAL: {
      if (selected.length !== 3) throw new Error('2 Plates / 3 People preset requires exactly 3 members');
      const plate1 = { shares: Object.fromEntries(participantIds.map((id) => [id, selected.includes(id) ? 2 : 0])) };
      const plate2 = { shares: Object.fromEntries(participantIds.map((id) => [id, selected.includes(id) ? 2 : 0])) };
      return {
        mode: ALLOCATION_MODES.CUSTOM,
        plates: [plate1, plate2],
      };
    }

    case PRESET_NAMES.TWO_PLATES_ONE_FULL_TWO_HALF: {
      if (selected.length !== 3) throw new Error('2 Plates / 3 People preset requires exactly 3 members');
      const targetFull = fullMemberId && selected.includes(fullMemberId) ? fullMemberId : selected[0];
      const otherTwo = selected.filter((id) => id !== targetFull);

      const plate1Shares = Object.fromEntries(participantIds.map((id) => [id, 0]));
      plate1Shares[targetFull] = SHARE_UNITS_PER_PLATE;

      const plate2Shares = Object.fromEntries(participantIds.map((id) => [id, 0]));
      plate2Shares[otherTwo[0]] = 3;
      plate2Shares[otherTwo[1]] = 3;

      return {
        mode: ALLOCATION_MODES.CUSTOM,
        plates: [{ shares: plate1Shares }, { shares: plate2Shares }],
      };
    }

    case PRESET_NAMES.THREE_PLATES_THREE_FULL: {
      if (selected.length !== 3) throw new Error('3 Plates / 3 People preset requires exactly 3 members');
      const plates = selected.map((m) => {
        const shares = Object.fromEntries(participantIds.map((id) => [id, 0]));
        shares[m] = SHARE_UNITS_PER_PLATE;
        return { shares };
      });
      return {
        mode: ALLOCATION_MODES.CUSTOM,
        plates,
      };
    }

    default:
      throw new Error(`Unsupported preset: ${presetName}`);
  }
}
