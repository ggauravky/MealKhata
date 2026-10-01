import { MEMBER_IDS } from '../config/members.js';
import {
  ALLOCATION_MODES,
  MAX_MEMBER_SHARE_UNITS,
  MAX_PHYSICAL_PLATES,
  MEAL_PRICES,
  PRESET_NAMES,
  SHARE_UNITS_PER_PLATE,
} from './plateAllocation.constants.js';

export function validatePlateAllocation(allocation) {
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

  if (plates.length > MAX_PHYSICAL_PLATES) {
    throw new Error(`Cannot allocate more than ${MAX_PHYSICAL_PLATES} physical plates per meal`);
  }

  const memberTotalUnits = Object.fromEntries(MEMBER_IDS.map((id) => [id, 0]));

  for (let i = 0; i < plates.length; i += 1) {
    const plate = plates[i];
    if (!plate || typeof plate !== 'object' || typeof plate.shares !== 'object' || Array.isArray(plate.shares)) {
      throw new Error(`Plate #${i + 1} must contain a valid shares object`);
    }

    const { shares } = plate;
    let plateTotal = 0;

    for (const key of Object.keys(shares)) {
      if (!MEMBER_IDS.includes(key)) {
        throw new Error(`Unknown member '${key}' on plate #${i + 1}`);
      }
    }

    for (const memberId of MEMBER_IDS) {
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

  for (const memberId of MEMBER_IDS) {
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
        MEMBER_IDS.map((id) => [id, plate.shares[id] ?? 0]),
      ),
    })),
  };
}

export function getEffectiveMealAllocation({ statuses = {}, customAllocation = null } = {}) {
  let result;
  if (customAllocation && customAllocation.mode === ALLOCATION_MODES.CUSTOM && Array.isArray(customAllocation.plates)) {
    result = {
      mode: ALLOCATION_MODES.CUSTOM,
      source: 'custom',
      plates: customAllocation.plates.map((plate) => ({
        shares: Object.fromEntries(
          MEMBER_IDS.map((id) => [id, plate.shares?.[id] ?? 0]),
        ),
      })),
    };
  } else {
    const plates = [];
    for (const memberId of MEMBER_IDS) {
      if (statuses[memberId] === 'taking') {
        const shares = Object.fromEntries(MEMBER_IDS.map((id) => [id, 0]));
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

  result.shareUnits = calculateMemberShareUnits(result);
  return result;
}

export function calculateMemberShareUnits(effectiveAllocation) {
  const units = Object.fromEntries(MEMBER_IDS.map((id) => [id, 0]));
  const plates = effectiveAllocation?.plates ?? [];

  for (const plate of plates) {
    for (const memberId of MEMBER_IDS) {
      units[memberId] += plate.shares?.[memberId] ?? 0;
    }
  }

  const totalUnits = Object.values(units).reduce((sum, u) => sum + u, 0);
  return { ...units, totalUnits };
}

export function deriveParticipationStatuses(effectiveAllocation) {
  const units = calculateMemberShareUnits(effectiveAllocation);
  return Object.fromEntries(
    MEMBER_IDS.map((id) => [id, units[id] > 0 ? 'taking' : 'skip']),
  );
}

function getDeterministicRotation(date, mealType) {
  if (!date) return [...MEMBER_IDS];

  const dateParts = date.split('-').map((p) => Number.parseInt(p, 10));
  const numericSum = dateParts.reduce((acc, n) => acc + (Number.isNaN(n) ? 0 : n), 0);
  const offset = (numericSum + (mealType === 'night' ? 1 : 0)) % MEMBER_IDS.length;

  return [...MEMBER_IDS.slice(offset), ...MEMBER_IDS.slice(0, offset)];
}

export function splitMealCost({
  date = '',
  mealType = 'morning',
  effectiveAllocation,
  allocation,
  pricePaise = MEAL_PRICES[mealType] ?? 0,
}) {
  const targetAllocation = effectiveAllocation || allocation;
  const plates = targetAllocation?.plates ?? [];
  const physicalPlates = plates.length;
  const totalCostPaise = physicalPlates * pricePaise;

  if (physicalPlates === 0) {
    return {
      physicalPlates: 0,
      physicalPlateCount: 0,
      pricePaise,
      totalCostPaise: 0,
      members: Object.fromEntries(
        MEMBER_IDS.map((id) => [
          id,
          {
            shareUnits: 0,
            amountPaise: 0,
            plateEquivalent: 0,
          },
        ]),
      ),
      memberAmountsPaise: Object.fromEntries(MEMBER_IDS.map((id) => [id, 0])),
      roomAmountPaise: 0,
    };
  }

  const memberUnits = calculateMemberShareUnits(targetAllocation);
  const totalWeight = physicalPlates * SHARE_UNITS_PER_PLATE;

  const baseAmounts = {};
  const remainders = {};
  let allocatedBaseSum = 0;

  for (const memberId of MEMBER_IDS) {
    const units = memberUnits[memberId] ?? 0;
    const numerator = totalCostPaise * units;
    const base = Math.floor(numerator / totalWeight);
    const remainder = numerator % totalWeight;

    baseAmounts[memberId] = base;
    remainders[memberId] = remainder;
    allocatedBaseSum += base;
  }

  const leftoverPaise = totalCostPaise - allocatedBaseSum;
  const priorityOrder = getDeterministicRotation(date, mealType);

  const sortedMembers = [...MEMBER_IDS].sort((a, b) => {
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
    MEMBER_IDS.map((memberId) => {
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
      MEMBER_IDS.map((memberId) => [memberId, finalAmounts[memberId]]),
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

export function createPresetAllocation(presetName, { members = MEMBER_IDS, fullMemberId = null } = {}) {
  switch (presetName) {
    case PRESET_NAMES.INDIVIDUAL: {
      const plates = members.map((m) => {
        const shares = Object.fromEntries(MEMBER_IDS.map((id) => [id, 0]));
        shares[m] = SHARE_UNITS_PER_PLATE;
        return { shares };
      });
      return { mode: ALLOCATION_MODES.DEFAULT, plates };
    }

    case PRESET_NAMES.ONE_PLATE_TWO_SHARED: {
      if (members.length !== 2) {
        throw new Error('1 Plate / 2 People preset requires exactly 2 members');
      }
      const shares = Object.fromEntries(MEMBER_IDS.map((id) => [id, 0]));
      shares[members[0]] = 3;
      shares[members[1]] = 3;
      return {
        mode: ALLOCATION_MODES.CUSTOM,
        plates: [{ shares }],
      };
    }

    case PRESET_NAMES.ONE_PLATE_THREE_SHARED: {
      const shares = Object.fromEntries(MEMBER_IDS.map((id) => [id, 2]));
      return {
        mode: ALLOCATION_MODES.CUSTOM,
        plates: [{ shares }],
      };
    }

    case PRESET_NAMES.TWO_PLATES_THREE_EQUAL: {
      const plate1 = { shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, 2])) };
      const plate2 = { shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, 2])) };
      return {
        mode: ALLOCATION_MODES.CUSTOM,
        plates: [plate1, plate2],
      };
    }

    case PRESET_NAMES.TWO_PLATES_ONE_FULL_TWO_HALF: {
      const targetFull = fullMemberId && MEMBER_IDS.includes(fullMemberId) ? fullMemberId : members[0];
      const otherTwo = MEMBER_IDS.filter((id) => id !== targetFull);

      const plate1Shares = Object.fromEntries(MEMBER_IDS.map((id) => [id, 0]));
      plate1Shares[targetFull] = SHARE_UNITS_PER_PLATE;

      const plate2Shares = Object.fromEntries(MEMBER_IDS.map((id) => [id, 0]));
      plate2Shares[otherTwo[0]] = 3;
      plate2Shares[otherTwo[1]] = 3;

      return {
        mode: ALLOCATION_MODES.CUSTOM,
        plates: [{ shares: plate1Shares }, { shares: plate2Shares }],
      };
    }

    case PRESET_NAMES.THREE_PLATES_THREE_FULL: {
      const plates = MEMBER_IDS.map((m) => {
        const shares = Object.fromEntries(MEMBER_IDS.map((id) => [id, 0]));
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
