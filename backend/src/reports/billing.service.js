import { MEMBER_IDS } from '../config/members.js';

function emptyMember() {
  return { morningCount: 0, nightCount: 0 };
}

function withAmounts(counts, rates) {
  const totalMeals = counts.morningCount + counts.nightCount;

  if (!rates.configured) {
    return {
      ...counts,
      totalMeals,
      morningAmountPaise: null,
      nightAmountPaise: null,
      amountPaise: null,
    };
  }

  const morningAmountPaise = counts.morningCount * rates.morningPricePaise;
  const nightAmountPaise = counts.nightCount * rates.nightPricePaise;

  return {
    ...counts,
    totalMeals,
    morningAmountPaise,
    nightAmountPaise,
    amountPaise: morningAmountPaise + nightAmountPaise,
  };
}

export function calculateBillingSummary(days, rates, { startDate, endDate }) {
  const counts = Object.fromEntries(MEMBER_IDS.map((memberId) => [memberId, emptyMember()]));

  for (const day of days) {
    for (const memberId of MEMBER_IDS) {
      if (day.meals.morning[memberId] === 'taking') {
        counts[memberId].morningCount += 1;
      }

      if (day.meals.night[memberId] === 'taking') {
        counts[memberId].nightCount += 1;
      }
    }
  }

  const members = Object.fromEntries(
    MEMBER_IDS.map((memberId) => [memberId, withAmounts(counts[memberId], rates)]),
  );
  const roomCounts = Object.values(members).reduce(
    (total, member) => ({
      morningCount: total.morningCount + member.morningCount,
      nightCount: total.nightCount + member.nightCount,
    }),
    emptyMember(),
  );

  return {
    startDate,
    endDate,
    amountsAvailable: rates.configured,
    members,
    room: withAmounts(roomCounts, rates),
  };
}

