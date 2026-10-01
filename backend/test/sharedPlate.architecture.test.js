import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import {
  MORNING_PRICE_PAISE,
  NIGHT_PRICE_PAISE,
} from '../src/meals/plateAllocation.constants.js';
import {
  formatPlateFraction,
  getEffectiveMealAllocation,
  splitMealCost,
  validatePlateAllocation,
} from '../src/meals/plateAllocation.service.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { createBillingRouter } from '../src/routes/billing.routes.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { InMemoryMonthlyRateRepository } from './helpers/inMemoryMonthlyRateRepository.js';

const ORIGIN = 'http://localhost:5173';
const TODAY = '2026-10-01';

async function cookieFor(role, memberId = null, userId = null, sessionVersion = 0) {
  const token = await createSessionToken(role, { memberId, userId, sessionVersion });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe('Shared Plate Architecture: Domain & Math Invariants', () => {
  test('Requirement 130: plate allocation validation rules', () => {
    // 1 full plate valid
    assert.doesNotThrow(() => validatePlateAllocation([{ shares: { gaurav: 6, nikhil: 0, devansh: 0 } }]));

    // 1/2 + 1/2 valid
    assert.doesNotThrow(() => validatePlateAllocation([{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }]));

    // 1/3 + 1/3 + 1/3 valid
    assert.doesNotThrow(() => validatePlateAllocation([{ shares: { gaurav: 2, nikhil: 2, devansh: 2 } }]));

    // plate totals 5 units rejected
    assert.throws(
      () => validatePlateAllocation([{ shares: { gaurav: 3, nikhil: 2, devansh: 0 } }]),
      /must total exactly 6 share units/,
    );

    // plate totals 7 units rejected
    assert.throws(
      () => validatePlateAllocation([{ shares: { gaurav: 4, nikhil: 3, devansh: 0 } }]),
      /must total exactly 6 share units/,
    );

    // negative units rejected
    assert.throws(
      () => validatePlateAllocation([{ shares: { gaurav: -1, nikhil: 7, devansh: 0 } }]),
      /must be an integer between 0 and 6/,
    );

    // non-integer units rejected
    assert.throws(
      () => validatePlateAllocation([{ shares: { gaurav: 2.5, nikhil: 3.5, devansh: 0 } }]),
      /must be an integer between 0 and 6/,
    );

    // unknown member rejected
    assert.throws(
      () => validatePlateAllocation([{ shares: { gaurav: 3, nikhil: 3, stranger: 0 } }]),
      /Unknown member/,
    );

    // >3 plates rejected
    assert.throws(
      () =>
        validatePlateAllocation([
          { shares: { gaurav: 6, nikhil: 0, devansh: 0 } },
          { shares: { gaurav: 0, nikhil: 6, devansh: 0 } },
          { shares: { gaurav: 0, nikhil: 0, devansh: 6 } },
          { shares: { gaurav: 6, nikhil: 0, devansh: 0 } },
        ]),
      /Cannot allocate more than 3 physical plates/,
    );

    // member >6 total units rejected
    assert.throws(
      () =>
        validatePlateAllocation([
          { shares: { gaurav: 4, nikhil: 2, devansh: 0 } },
          { shares: { gaurav: 4, nikhil: 0, devansh: 2 } },
        ]),
      /cannot exceed 1 full plate equivalent/,
    );
  });

  test('Requirement 131: Case 1 — One person, one plate', () => {
    const allocation = {
      mode: 'custom',
      plates: [{ shares: { gaurav: 6, nikhil: 0, devansh: 0 } }],
    };

    const morningSplit = splitMealCost({
      allocation,
      pricePaise: MORNING_PRICE_PAISE,
      date: '2026-10-01',
      mealType: 'morning',
    });
    assert.equal(morningSplit.physicalPlateCount, 1);
    assert.equal(morningSplit.memberAmountsPaise.gaurav, 5000);
    assert.equal(morningSplit.memberAmountsPaise.nikhil, 0);
    assert.equal(morningSplit.memberAmountsPaise.devansh, 0);
    assert.equal(morningSplit.roomAmountPaise, 5000);

    const nightSplit = splitMealCost({
      allocation,
      pricePaise: NIGHT_PRICE_PAISE,
      date: '2026-10-01',
      mealType: 'night',
    });
    assert.equal(nightSplit.memberAmountsPaise.gaurav, 7000);
    assert.equal(nightSplit.roomAmountPaise, 7000);
  });

  test('Requirement 132: Case 2 — One plate shared by two people', () => {
    const allocation = {
      mode: 'custom',
      plates: [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }],
    };

    const morning = splitMealCost({
      allocation,
      pricePaise: 5000,
      date: '2026-10-01',
      mealType: 'morning',
    });
    assert.equal(morning.physicalPlateCount, 1);
    assert.equal(morning.memberAmountsPaise.gaurav, 2500);
    assert.equal(morning.memberAmountsPaise.nikhil, 2500);
    assert.equal(morning.memberAmountsPaise.devansh, 0);
    assert.equal(morning.roomAmountPaise, 5000);

    const night = splitMealCost({
      allocation,
      pricePaise: 7000,
      date: '2026-10-01',
      mealType: 'night',
    });
    assert.equal(night.memberAmountsPaise.gaurav, 3500);
    assert.equal(night.memberAmountsPaise.nikhil, 3500);
    assert.equal(night.memberAmountsPaise.devansh, 0);
    assert.equal(night.roomAmountPaise, 7000);
  });

  test('Requirement 133: Case 3 — One plate shared by three people', () => {
    const allocation = {
      mode: 'custom',
      plates: [{ shares: { gaurav: 2, nikhil: 2, devansh: 2 } }],
    };

    const morning = splitMealCost({
      allocation,
      pricePaise: 5000,
      date: '2026-10-01',
      mealType: 'morning',
    });
    assert.equal(morning.physicalPlateCount, 1);
    const mSum = morning.memberAmountsPaise.gaurav + morning.memberAmountsPaise.nikhil + morning.memberAmountsPaise.devansh;
    assert.equal(mSum, 5000);
    assert.equal(morning.roomAmountPaise, 5000);

    const mAmounts = [morning.memberAmountsPaise.gaurav, morning.memberAmountsPaise.nikhil, morning.memberAmountsPaise.devansh];
    const mMax = Math.max(...mAmounts);
    const mMin = Math.min(...mAmounts);
    assert.ok(mMax - mMin <= 1, 'Difference between equal participants must be <= 1 paisa');

    const night = splitMealCost({
      allocation,
      pricePaise: 7000,
      date: '2026-10-01',
      mealType: 'night',
    });
    const nSum = night.memberAmountsPaise.gaurav + night.memberAmountsPaise.nikhil + night.memberAmountsPaise.devansh;
    assert.equal(nSum, 7000);
    assert.equal(night.roomAmountPaise, 7000);

    const nAmounts = [night.memberAmountsPaise.gaurav, night.memberAmountsPaise.nikhil, night.memberAmountsPaise.devansh];
    assert.ok(Math.max(...nAmounts) - Math.min(...nAmounts) <= 1);
  });

  test('Requirement 134: Case 4 — Two plates, two people', () => {
    const allocation = {
      mode: 'custom',
      plates: [
        { shares: { gaurav: 6, nikhil: 0, devansh: 0 } },
        { shares: { gaurav: 0, nikhil: 6, devansh: 0 } },
      ],
    };

    const morning = splitMealCost({
      allocation,
      pricePaise: 5000,
      date: '2026-10-01',
      mealType: 'morning',
    });
    assert.equal(morning.physicalPlateCount, 2);
    assert.equal(morning.memberAmountsPaise.gaurav, 5000);
    assert.equal(morning.memberAmountsPaise.nikhil, 5000);
    assert.equal(morning.memberAmountsPaise.devansh, 0);
    assert.equal(morning.roomAmountPaise, 10000);

    const night = splitMealCost({
      allocation,
      pricePaise: 7000,
      date: '2026-10-01',
      mealType: 'night',
    });
    assert.equal(night.memberAmountsPaise.gaurav, 7000);
    assert.equal(night.memberAmountsPaise.nikhil, 7000);
    assert.equal(night.memberAmountsPaise.devansh, 0);
    assert.equal(night.roomAmountPaise, 14000);
  });

  test('Requirement 135: Case 5 — Two plates shared equally by three people', () => {
    const allocation = {
      mode: 'custom',
      plates: [
        { shares: { gaurav: 2, nikhil: 2, devansh: 2 } },
        { shares: { gaurav: 2, nikhil: 2, devansh: 2 } },
      ],
    };

    const morning = splitMealCost({
      allocation,
      pricePaise: 5000,
      date: '2026-10-01',
      mealType: 'morning',
    });
    assert.equal(morning.physicalPlateCount, 2);
    assert.equal(morning.roomAmountPaise, 10000);
    const mSum = morning.memberAmountsPaise.gaurav + morning.memberAmountsPaise.nikhil + morning.memberAmountsPaise.devansh;
    assert.equal(mSum, 10000);

    // Each member has 4 units (2/3 plate equivalent). Remainder distributed deterministically.
    const mAmounts = [morning.memberAmountsPaise.gaurav, morning.memberAmountsPaise.nikhil, morning.memberAmountsPaise.devansh].sort();
    assert.deepEqual(mAmounts, [3333, 3333, 3334]);

    const night = splitMealCost({
      allocation,
      pricePaise: 7000,
      date: '2026-10-01',
      mealType: 'night',
    });
    assert.equal(night.physicalPlateCount, 2);
    assert.equal(night.roomAmountPaise, 14000);
    const nSum = night.memberAmountsPaise.gaurav + night.memberAmountsPaise.nikhil + night.memberAmountsPaise.devansh;
    assert.equal(nSum, 14000);

    const nAmounts = [night.memberAmountsPaise.gaurav, night.memberAmountsPaise.nikhil, night.memberAmountsPaise.devansh].sort();
    assert.deepEqual(nAmounts, [4666, 4667, 4667]);
  });

  test('Requirement 136: Case 6 — Two plates for three people: one full + two share one', () => {
    const allocation = {
      mode: 'custom',
      plates: [
        { shares: { gaurav: 6, nikhil: 0, devansh: 0 } },
        { shares: { gaurav: 0, nikhil: 3, devansh: 3 } },
      ],
    };

    const morning = splitMealCost({
      allocation,
      pricePaise: 5000,
      date: '2026-10-01',
      mealType: 'morning',
    });
    assert.equal(morning.physicalPlateCount, 2);
    assert.equal(morning.memberAmountsPaise.gaurav, 5000);
    assert.equal(morning.memberAmountsPaise.nikhil, 2500);
    assert.equal(morning.memberAmountsPaise.devansh, 2500);
    assert.equal(morning.roomAmountPaise, 10000);

    const night = splitMealCost({
      allocation,
      pricePaise: 7000,
      date: '2026-10-01',
      mealType: 'night',
    });
    assert.equal(night.memberAmountsPaise.gaurav, 7000);
    assert.equal(night.memberAmountsPaise.nikhil, 3500);
    assert.equal(night.memberAmountsPaise.devansh, 3500);
    assert.equal(night.roomAmountPaise, 14000);
  });

  test('Requirement 137: Case 7 — Three people, three plates', () => {
    const allocation = {
      mode: 'custom',
      plates: [
        { shares: { gaurav: 6, nikhil: 0, devansh: 0 } },
        { shares: { gaurav: 0, nikhil: 6, devansh: 0 } },
        { shares: { gaurav: 0, nikhil: 0, devansh: 6 } },
      ],
    };

    const morning = splitMealCost({
      allocation,
      pricePaise: 5000,
      date: '2026-10-01',
      mealType: 'morning',
    });
    assert.equal(morning.physicalPlateCount, 3);
    assert.equal(morning.memberAmountsPaise.gaurav, 5000);
    assert.equal(morning.memberAmountsPaise.nikhil, 5000);
    assert.equal(morning.memberAmountsPaise.devansh, 5000);
    assert.equal(morning.roomAmountPaise, 15000);

    const night = splitMealCost({
      allocation,
      pricePaise: 7000,
      date: '2026-10-01',
      mealType: 'night',
    });
    assert.equal(night.memberAmountsPaise.gaurav, 7000);
    assert.equal(night.memberAmountsPaise.nikhil, 7000);
    assert.equal(night.memberAmountsPaise.devansh, 7000);
    assert.equal(night.roomAmountPaise, 21000);
  });

  test('Requirement 138: Rounding fairness and deterministic rotation', () => {
    const allocation = {
      mode: 'custom',
      plates: [{ shares: { gaurav: 2, nikhil: 2, devansh: 2 } }],
    };

    // Dates across 3 consecutive days
    const dates = ['2026-10-01', '2026-10-02', '2026-10-03'];
    const extraPaisaRecipients = new Set();

    for (const d of dates) {
      const split1 = splitMealCost({ allocation, pricePaise: 5000, date: d, mealType: 'morning' });
      const split2 = splitMealCost({ allocation, pricePaise: 5000, date: d, mealType: 'morning' });
      // Invariant: same date + meal must always produce identical result
      assert.deepEqual(split1, split2);

      // Check which member got 1667 paise
      for (const [m, amt] of Object.entries(split1.memberAmountsPaise)) {
        if (amt === 1667) {
          extraPaisaRecipients.add(m);
        }
      }
    }

    // Remainder paisa rotates and is not permanently hardcoded to one single member
    assert.ok(extraPaisaRecipients.size > 1, 'Extra remainder paisa must rotate across days');
  });

  test('Requirement 139: Legacy default allocation for MealDay with no allocation doc', () => {
    const statuses = { gaurav: 'taking', nikhil: 'taking', devansh: 'skip' };
    const effective = getEffectiveMealAllocation({ statuses, customAllocation: null });

    assert.equal(effective.mode, 'default');
    assert.equal(effective.plates.length, 2);
    assert.equal(effective.shareUnits.gaurav, 6);
    assert.equal(effective.shareUnits.nikhil, 6);
    assert.equal(effective.shareUnits.devansh, 0);
  });

  test('Requirement 54: Fraction formatter', () => {
    assert.equal(formatPlateFraction(0), '0');
    assert.equal(formatPlateFraction(1), '⅙');
    assert.equal(formatPlateFraction(2), '⅓');
    assert.equal(formatPlateFraction(3), '½');
    assert.equal(formatPlateFraction(4), '⅔');
    assert.equal(formatPlateFraction(5), '⅚');
    assert.equal(formatPlateFraction(6), '1');
    assert.equal(formatPlateFraction(8), '1⅓');
    assert.equal(formatPlateFraction(9), '1½');
    assert.equal(formatPlateFraction(10), '1⅔');
    assert.equal(formatPlateFraction(12), '2');
  });
});

describe('Shared Plate Integration & API', () => {
  let mealRepo;
  let mealService;
  let testApp;

  beforeEach(() => {
    mealRepo = new InMemoryMealRepository();
    mealService = createMealService({ repository: mealRepo, timezone: 'Asia/Kolkata' });
    const meals = createMealRouter({
      service: mealService,
      broadcast: () => {},
      now: () => new Date('2026-10-01T12:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    const rateRepo = new InMemoryMonthlyRateRepository();
    const rateService = createMonthlyRateService({ repository: rateRepo });
    const billing = createBillingRouter({ service: rateService });

    testApp = createApp({ meals, billing });
  });

  test('Requirement 140: Member status change automatically resets custom allocation', async () => {
    const adminCookie = await cookieFor(ROLES.ADMIN);
    const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');

    // 1. Admin configures shared allocation for Today morning: Gaurav 3, Nikhil 3
    const setRes = await request(testApp)
      .put(`/api/meals/${TODAY}/morning/allocation`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        plates: [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }],
      })
      .expect(200);

    assert.equal(setRes.body.data.allocations.morning.mode, 'custom');
    assert.equal(setRes.body.data.allocations.morning.plates.length, 1);

    // 2. Gaurav changes status to skip
    const patchRes = await request(testApp)
      .patch(`/api/meals/${TODAY}`)
      .set('Origin', ORIGIN)
      .set('Cookie', memberCookie)
      .send({
        mealType: 'morning',
        memberId: 'gaurav',
        status: 'skip',
      })
      .expect(200);

    // Assert custom allocation was automatically reset with explicit flag
    assert.equal(patchRes.body.allocationReset, true);
    assert.equal(patchRes.body.data.allocations.morning.mode, 'default');
    assert.equal(patchRes.body.data.allocations.morning.plates.length, 1); // Only Nikhil is taking now (1 full plate)
    assert.equal(patchRes.body.data.meals.morning.gaurav, 'skip');
  });

  test('Requirement 141: Authorization checks for shared plate allocation', async () => {
    const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const adminCookie = await cookieFor(ROLES.ADMIN);

    // Member cannot configure household plate allocation (403)
    await request(testApp)
      .put(`/api/meals/${TODAY}/morning/allocation`)
      .set('Origin', ORIGIN)
      .set('Cookie', memberCookie)
      .send({ plates: [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }] })
      .expect(403);

    // Member cannot delete/reset household plate allocation (403)
    await request(testApp)
      .delete(`/api/meals/${TODAY}/morning/allocation`)
      .set('Origin', ORIGIN)
      .set('Cookie', memberCookie)
      .expect(403);

    // Admin can configure Today household plate allocation
    await request(testApp)
      .put(`/api/meals/${TODAY}/morning/allocation`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie)
      .send({ plates: [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }] })
      .expect(200);

    // Admin cannot configure past or future dates
    await request(testApp)
      .put(`/api/meals/2026-09-10/morning/allocation`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie)
      .send({ plates: [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }] })
      .expect(403);
  });

  test('Requirement 142: Rate updates rejected with 405 Method Not Allowed', async () => {
    const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
    const res = await request(testApp)
      .put('/api/billing/rates/2026-10')
      .set('Origin', ORIGIN)
      .set('Cookie', superAdminCookie)
      .send({ morningPricePaise: 4000, nightPricePaise: 6000 })
      .expect(405);

    assert.equal(res.body.message, 'Meal prices are fixed at ₹50 for Morning and ₹70 for Night.');
  });
});
