import {
  getEffectiveMealAllocation,
  resolveMealPricePaise,
  splitMealCost,
} from '../meals/plateAllocation.service.js';
import { MEAL_PRICES } from '../meals/plateAllocation.constants.js';
import { assertSafeStudentId } from '../students/studentId.js';

function emptyMemberAccumulator() {
  return {
    morningParticipationCount: 0,
    nightParticipationCount: 0,
    morningShareUnits: 0,
    nightShareUnits: 0,
    morningAmountPaise: 0,
    nightAmountPaise: 0,
  };
}

export function calculateBillingSummary(days, rates = {}, { startDate, endDate } = {}) {
  const morningPrice = rates.morningPricePaise ?? MEAL_PRICES.morning;
  const nightPrice = rates.nightPricePaise ?? MEAL_PRICES.night;

  const memberAcc = Object.create(null);

  let roomMorningPlates = 0;
  let roomNightPlates = 0;
  let roomMorningParticipants = 0;
  let roomNightParticipants = 0;
  let roomMorningAmountPaise = 0;
  let roomNightAmountPaise = 0;

  for (const day of days) {
    const participants = day.participantOrder?.length
      ? day.participantOrder
      : [...new Set([
        ...Object.keys(day.meals?.morning ?? {}),
        ...Object.keys(day.meals?.night ?? {}),
        ...Object.keys(day.dailyCostSummary?.members ?? {}),
      ])];
    for (const id of participants) {
      try {
        assertSafeStudentId(id);
      } catch {
        throw new Error(`Unsafe student reference for ${day.date}`);
      }
      memberAcc[id] ??= emptyMemberAccumulator();
    }
    const historical = day.calculationVersion?.startsWith('legacy-');
    if (historical && (!day.dailyCostSummary || !day.allocations?.morning?.cost || !day.allocations?.night?.cost)) {
      throw new Error(`Missing verified historical cost for ${day.date}`);
    }
    const morningAllocation = historical ? null : getEffectiveMealAllocation({
      statuses: day.meals?.morning,
      customAllocation: day.allocations?.morning,
      participants,
    });

    const nightAllocation = historical ? null : getEffectiveMealAllocation({
      statuses: day.meals?.night,
      customAllocation: day.allocations?.night,
      participants,
    });

    const morningPriceForDay = resolveMealPricePaise({
      day,
      mealType: 'morning',
      fallbackPricePaise: morningPrice,
    });

    const nightPriceForDay = resolveMealPricePaise({
      day,
      mealType: 'night',
      fallbackPricePaise: nightPrice,
    });

    const morningSplit = historical ? day.allocations.morning.cost : splitMealCost({
      date: day.date,
      mealType: 'morning',
      effectiveAllocation: morningAllocation,
      pricePaise: morningPriceForDay,
      participants,
    });

    const nightSplit = historical ? day.allocations.night.cost : splitMealCost({
      date: day.date,
      mealType: 'night',
      effectiveAllocation: nightAllocation,
      pricePaise: nightPriceForDay,
      participants,
    });

    if (historical) {
      const expected = day.dailyCostSummary;
      const roomTotal = morningSplit.roomAmountPaise + nightSplit.roomAmountPaise;
      const memberTotal = participants.reduce((sum, id) => sum
        + (morningSplit.members?.[id]?.amountPaise ?? 0)
        + (nightSplit.members?.[id]?.amountPaise ?? 0), 0);
      if (roomTotal !== expected.room?.totalAmountPaise || memberTotal !== roomTotal ||
          participants.some((id) =>
            (morningSplit.members?.[id]?.amountPaise ?? 0) !== expected.members?.[id]?.morningAmountPaise ||
            (nightSplit.members?.[id]?.amountPaise ?? 0) !== expected.members?.[id]?.nightAmountPaise ||
            (morningSplit.members?.[id]?.amountPaise ?? 0) +
            (nightSplit.members?.[id]?.amountPaise ?? 0) !== expected.members?.[id]?.totalAmountPaise)) {
        throw new Error(`Historical cost mismatch for ${day.date}`);
      }
    }

    roomMorningPlates += morningSplit.physicalPlates;
    roomNightPlates += nightSplit.physicalPlates;
    roomMorningAmountPaise += morningSplit.roomAmountPaise;
    roomNightAmountPaise += nightSplit.roomAmountPaise;

    for (const memberId of participants) {
      if (day.meals?.morning?.[memberId] === 'taking') {
        memberAcc[memberId].morningParticipationCount += 1;
        roomMorningParticipants += 1;
      }
      if (day.meals?.night?.[memberId] === 'taking') {
        memberAcc[memberId].nightParticipationCount += 1;
        roomNightParticipants += 1;
      }

      memberAcc[memberId].morningShareUnits += morningSplit.members?.[memberId]?.shareUnits ?? 0;
      memberAcc[memberId].nightShareUnits += nightSplit.members?.[memberId]?.shareUnits ?? 0;
      memberAcc[memberId].morningAmountPaise += morningSplit.members?.[memberId]?.amountPaise ?? 0;
      memberAcc[memberId].nightAmountPaise += nightSplit.members?.[memberId]?.amountPaise ?? 0;
    }
  }

  const members = Object.fromEntries(
    Object.keys(memberAcc).map((memberId) => {
      const acc = memberAcc[memberId];
      const totalShareUnits = acc.morningShareUnits + acc.nightShareUnits;
      const totalAmountPaise = acc.morningAmountPaise + acc.nightAmountPaise;
      const totalParticipations = acc.morningParticipationCount + acc.nightParticipationCount;

      return [
        memberId,
        {
          morningParticipationCount: acc.morningParticipationCount,
          nightParticipationCount: acc.nightParticipationCount,
          totalParticipationCount: totalParticipations,
          morningShareUnits: acc.morningShareUnits,
          nightShareUnits: acc.nightShareUnits,
          totalShareUnits,
          morningPlateEquivalent: acc.morningShareUnits / 6,
          nightPlateEquivalent: acc.nightShareUnits / 6,
          totalPlateEquivalent: totalShareUnits / 6,
          morningAmountPaise: acc.morningAmountPaise,
          nightAmountPaise: acc.nightAmountPaise,
          amountPaise: totalAmountPaise,
          // Backward-compatible properties
          morningCount: acc.morningParticipationCount,
          nightCount: acc.nightParticipationCount,
          totalMeals: totalParticipations,
          totalPlates: totalShareUnits / 6,
        },
      ];
    }),
  );

  const totalRoomPhysicalPlates = roomMorningPlates + roomNightPlates;
  const totalRoomAmountPaise = roomMorningAmountPaise + roomNightAmountPaise;

  const room = {
    morningPhysicalPlates: roomMorningPlates,
    nightPhysicalPlates: roomNightPlates,
    totalPhysicalPlates: totalRoomPhysicalPlates,
    morningParticipants: roomMorningParticipants,
    nightParticipants: roomNightParticipants,
    morningAmountPaise: roomMorningAmountPaise,
    nightAmountPaise: roomNightAmountPaise,
    amountPaise: totalRoomAmountPaise,
    // Backward-compatible properties
    morningCount: roomMorningPlates,
    nightCount: roomNightPlates,
    totalPlates: totalRoomPhysicalPlates,
    totalMeals: roomMorningParticipants + roomNightParticipants,
  };

  return {
    startDate,
    endDate,
    amountsAvailable: true,
    members,
    room,
  };
}
