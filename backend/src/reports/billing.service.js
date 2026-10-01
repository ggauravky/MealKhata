import { MEMBER_IDS } from '../config/members.js';
import {
  getEffectiveMealAllocation,
  splitMealCost,
} from '../meals/plateAllocation.service.js';
import { MEAL_PRICES } from '../meals/plateAllocation.constants.js';

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

  const memberAcc = Object.fromEntries(
    MEMBER_IDS.map((id) => [id, emptyMemberAccumulator()]),
  );

  let roomMorningPlates = 0;
  let roomNightPlates = 0;
  let roomMorningParticipants = 0;
  let roomNightParticipants = 0;
  let roomMorningAmountPaise = 0;
  let roomNightAmountPaise = 0;

  for (const day of days) {
    const morningAllocation = getEffectiveMealAllocation({
      statuses: day.meals?.morning,
      customAllocation: day.allocations?.morning,
    });

    const nightAllocation = getEffectiveMealAllocation({
      statuses: day.meals?.night,
      customAllocation: day.allocations?.night,
    });

    const morningSplit = splitMealCost({
      date: day.date,
      mealType: 'morning',
      effectiveAllocation: morningAllocation,
      pricePaise: morningPrice,
    });

    const nightSplit = splitMealCost({
      date: day.date,
      mealType: 'night',
      effectiveAllocation: nightAllocation,
      pricePaise: nightPrice,
    });

    roomMorningPlates += morningSplit.physicalPlates;
    roomNightPlates += nightSplit.physicalPlates;
    roomMorningAmountPaise += morningSplit.roomAmountPaise;
    roomNightAmountPaise += nightSplit.roomAmountPaise;

    for (const memberId of MEMBER_IDS) {
      if (day.meals?.morning?.[memberId] === 'taking') {
        memberAcc[memberId].morningParticipationCount += 1;
        roomMorningParticipants += 1;
      }
      if (day.meals?.night?.[memberId] === 'taking') {
        memberAcc[memberId].nightParticipationCount += 1;
        roomNightParticipants += 1;
      }

      memberAcc[memberId].morningShareUnits += morningSplit.members[memberId].shareUnits;
      memberAcc[memberId].nightShareUnits += nightSplit.members[memberId].shareUnits;
      memberAcc[memberId].morningAmountPaise += morningSplit.members[memberId].amountPaise;
      memberAcc[memberId].nightAmountPaise += nightSplit.members[memberId].amountPaise;
    }
  }

  const members = Object.fromEntries(
    MEMBER_IDS.map((memberId) => {
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
