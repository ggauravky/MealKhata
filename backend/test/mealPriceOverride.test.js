import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { MEAL_PRICES } from '../src/meals/plateAllocation.constants.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';

const ORIGIN = 'http://localhost:5173';
const NOW = new Date('2026-10-19T12:00:00.000Z');
const TODAY = '2026-10-19';
const TOMORROW = '2026-10-20';
const PAST_DATE = '2026-09-15';
const CLOSED_MONTH = '2026-08';
const CLOSED_DATE = '2026-08-15';

const repository = new InMemoryMealRepository();
const broadcasts = [];
const fakeSettlementService = {
  async isMonthClosed(month) {
    return month === CLOSED_MONTH;
  },
};

const service = createMealService({
  repository,
  timezone: 'Asia/Kolkata',
  settlementService: fakeSettlementService,
});

const meals = createMealRouter({
  service,
  broadcast: (payload) => broadcasts.push(payload),
  now: () => NOW,
  timezone: 'Asia/Kolkata',
  settlements: fakeSettlementService,
});

const testApp = createApp({ meals });

async function cookieFor(role, memberId = null) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, { memberId })}`;
}

beforeEach(() => {
  repository.reset();
  broadcasts.length = 0;
});

describe('Date-Specific Meal Price Override & Daily Cost Summary', () => {
  test('Requirement 125, 126: Default prices remain standard ₹50 Morning and ₹70 Night when no override', async () => {
    const res = await request(testApp)
      .get(`/api/meals/${TODAY}`)
      .set('Cookie', await cookieFor(ROLES.ADMIN));

    assert.equal(res.status, 200);
    const { data } = res.body;

    assert.equal(data.pricing.morning.defaultPricePaise, 5000);
    assert.equal(data.pricing.morning.effectivePricePaise, 5000);
    assert.equal(data.pricing.morning.isOverridden, false);
    assert.equal(data.pricing.morning.overridePricePaise, null);

    assert.equal(data.pricing.night.defaultPricePaise, 7000);
    assert.equal(data.pricing.night.effectivePricePaise, 7000);
    assert.equal(data.pricing.night.isOverridden, false);
    assert.equal(data.pricing.night.overridePricePaise, null);
  });

  test('Requirement 127, 133, 134: Setting Night override on 19 Oct to ₹40 affects only that date and meal', async () => {
    // 1. Set 19 Oct Night price override to 4000 paise (₹40) with reason
    const res = await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ pricePaise: 4000, reason: 'Missing sabzi' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.changed, true);

    const { data } = res.body;
    assert.equal(data.pricing.night.defaultPricePaise, 7000);
    assert.equal(data.pricing.night.effectivePricePaise, 4000);
    assert.equal(data.pricing.night.overridePricePaise, 4000);
    assert.equal(data.pricing.night.isOverridden, true);
    assert.equal(data.pricing.night.reason, 'Missing sabzi');

    // Morning on 19 Oct MUST remain standard ₹50
    assert.equal(data.pricing.morning.defaultPricePaise, 5000);
    assert.equal(data.pricing.morning.effectivePricePaise, 5000);
    assert.equal(data.pricing.morning.isOverridden, false);

    // Realtime broadcast emitted
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].date, TODAY);
    assert.equal(broadcasts[0].mealType, 'night');
    assert.equal(broadcasts[0].priceChanged, true);

    // Another date (20 Oct) Night MUST remain standard ₹70
    const res2 = await request(testApp)
      .get(`/api/meals/${TOMORROW}`)
      .set('Cookie', await cookieFor(ROLES.ADMIN));

    assert.equal(res2.body.data.pricing.night.effectivePricePaise, 7000);
    assert.equal(res2.body.data.pricing.night.isOverridden, false);
  });

  test('Requirement 131, 130: 2 physical plates at override ₹40 shared equally by 3 members equals exactly ₹80 with deterministic paise rotation', async () => {
    // Initialize day with 3 taking members for night
    for (const memberId of MEMBER_IDS) {
      await request(testApp)
        .patch(`/api/meals/${TODAY}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ mealType: 'night', memberId, status: 'taking' });
    }

    // Set custom allocation: 2 physical plates shared equally (4 units each = 2/3 plate each)
    await request(testApp)
      .put(`/api/meals/${TODAY}/night/allocation`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({
        plates: [
          { shares: { gaurav: 2, nikhil: 2, devansh: 2 } },
          { shares: { gaurav: 2, nikhil: 2, devansh: 2 } },
        ],
      });

    // Set night price override to 4000 paise (₹40 / plate)
    const res = await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ pricePaise: 4000, reason: 'Reduced meal' });

    assert.equal(res.status, 200);
    const { data } = res.body;

    // Total physical plates = 2, price = 4000, total room cost = 8000 paise (₹80.00)
    const nightAlloc = data.allocations.night;
    assert.equal(nightAlloc.cost.pricePaise, 4000);
    assert.equal(nightAlloc.cost.totalCostPaise, 8000);
    assert.equal(nightAlloc.cost.roomAmountPaise, 8000);

    // Sum of member costs must equal EXACTLY 8000 paise
    const memberSum = MEMBER_IDS.reduce(
      (sum, id) => sum + nightAlloc.cost.members[id].amountPaise,
      0,
    );
    assert.equal(memberSum, 8000);

    // Each member receives exactly 2666 or 2667 paise according to largest remainder rotation
    for (const id of MEMBER_IDS) {
      const amount = nightAlloc.cost.members[id].amountPaise;
      assert.ok(amount === 2666 || amount === 2667, `Member ${id} got ${amount}`);
    }

    // DailyCostSummary must match exactly
    const summary = data.dailyCostSummary;
    assert.equal(summary.room.nightAmountPaise, 8000);
    assert.equal(summary.room.totalAmountPaise, 8000);

    const summaryMemberSum = MEMBER_IDS.reduce(
      (sum, id) => sum + summary.members[id].totalAmountPaise,
      0,
    );
    assert.equal(summaryMemberSum, summary.room.totalAmountPaise);
  });

  test('Requirement 132: Resetting price override restores default price and isOverridden: false', async () => {
    // Set override first
    await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ pricePaise: 4000, reason: 'Temporary' });

    // Reset override
    const delRes = await request(testApp)
      .delete(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN));

    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.changed, true);

    const { data } = delRes.body;
    assert.equal(data.pricing.night.defaultPricePaise, 7000);
    assert.equal(data.pricing.night.effectivePricePaise, 7000);
    assert.equal(data.pricing.night.overridePricePaise, null);
    assert.equal(data.pricing.night.isOverridden, false);
    assert.equal(data.pricing.night.reason, null);
  });

  test('Requirement 142: Price overrides generate audit entries in history endpoint', async () => {
    // Set override
    await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ pricePaise: 4000, reason: 'Special night' });

    // Clear override
    await request(testApp)
      .delete(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN));

    // Fetch history
    const histRes = await request(testApp)
      .get(`/api/meals/${TODAY}/history`)
      .set('Cookie', await cookieFor(ROLES.ADMIN));

    assert.equal(histRes.status, 200);
    const priceEvents = histRes.body.data.items.filter((h) => h.type === 'price');
    assert.equal(priceEvents.length, 2);

    // Most recent is clear
    assert.equal(priceEvents[0].changeType, 'clear');
    assert.equal(priceEvents[0].fromPricePaise, 4000);
    assert.equal(priceEvents[0].toPricePaise, 7000);

    // Initial was set
    assert.equal(priceEvents[1].changeType, 'set');
    assert.equal(priceEvents[1].fromPricePaise, 7000);
    assert.equal(priceEvents[1].toPricePaise, 4000);
    assert.equal(priceEvents[1].reason, 'Special night');
  });

  test('Requirement 135: Price override in closed month returns 409 Conflict', async () => {
    const res = await request(testApp)
      .put(`/api/meals/${CLOSED_DATE}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
      .send({ pricePaise: 4000 });

    assert.equal(res.status, 409);
    assert.match(res.body.message, /closed/i);

    const delRes = await request(testApp)
      .delete(`/api/meals/${CLOSED_DATE}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.SUPERADMIN));

    assert.equal(delRes.status, 409);
  });

  test('Requirement 136, 137: Member and Viewer cannot adjust meal price', async () => {
    // Member receives 403
    const memberRes = await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'))
      .send({ pricePaise: 4000 });

    assert.equal(memberRes.status, 403);

    // Viewer (unauthenticated) receives 401
    const viewerRes = await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .send({ pricePaise: 4000 });

    assert.equal(viewerRes.status, 401);
  });

  test('Requirement 138, 139: Admin allowed today only, Super Admin allowed historical open dates', async () => {
    // Admin on past date rejected by date authorization
    const adminPastRes = await request(testApp)
      .put(`/api/meals/${PAST_DATE}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ pricePaise: 4000 });

    assert.equal(adminPastRes.status, 403);

    // Super Admin on past open date allowed
    const superPastRes = await request(testApp)
      .put(`/api/meals/${PAST_DATE}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
      .send({ pricePaise: 4000 });

    assert.equal(superPastRes.status, 200);
    assert.equal(superPastRes.body.data.pricing.night.effectivePricePaise, 4000);
  });

  test('Requirement 140, 141: Validates integer paise and reason length', async () => {
    // Negative price
    const negRes = await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ pricePaise: -100 });
    assert.equal(negRes.status, 400);

    // Float paise
    const floatRes = await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ pricePaise: 40.5 });
    assert.equal(floatRes.status, 400);

    // Reason > 200 chars
    const longReasonRes = await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ pricePaise: 4000, reason: 'a'.repeat(201) });
    assert.equal(longReasonRes.status, 400);
  });

  test('Requirement 112, 147: DailyCostSummary reconciliation invariant holds for zero, morning, night, and both meals', async () => {
    // All skipped / zero
    const resZero = await request(testApp)
      .get(`/api/meals/${TODAY}`)
      .set('Cookie', await cookieFor(ROLES.ADMIN));

    const zeroSum = resZero.body.data.dailyCostSummary;
    assert.equal(zeroSum.room.totalAmountPaise, 0);
    for (const id of MEMBER_IDS) {
      assert.equal(zeroSum.members[id].totalAmountPaise, 0);
    }

    // Morning: Gaurav (taking), Nikhil (taking), Devansh (skip) -> 2 plates at ₹50 = ₹100 (₹50 each)
    await request(testApp)
      .patch(`/api/meals/${TODAY}`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ mealType: 'morning', memberId: 'gaurav', status: 'taking' });
    await request(testApp)
      .patch(`/api/meals/${TODAY}`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ mealType: 'morning', memberId: 'nikhil', status: 'taking' });
    await request(testApp)
      .patch(`/api/meals/${TODAY}`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ mealType: 'morning', memberId: 'devansh', status: 'skip' });

    // Night: Gaurav (taking), Nikhil (taking), Devansh (taking) with 2 plates at ₹40 override
    for (const memberId of MEMBER_IDS) {
      await request(testApp)
        .patch(`/api/meals/${TODAY}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ mealType: 'night', memberId, status: 'taking' });
    }
    await request(testApp)
      .put(`/api/meals/${TODAY}/night/allocation`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({
        plates: [
          { shares: { gaurav: 2, nikhil: 2, devansh: 2 } },
          { shares: { gaurav: 2, nikhil: 2, devansh: 2 } },
        ],
      });
    await request(testApp)
      .put(`/api/meals/${TODAY}/night/price`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ pricePaise: 4000 });

    const resFinal = await request(testApp)
      .get(`/api/meals/${TODAY}`)
      .set('Cookie', await cookieFor(ROLES.ADMIN));

    const finalSummary = resFinal.body.data.dailyCostSummary;

    // Room: Morning (10000) + Night (8000) = 18000 paise (₹180.00)
    assert.equal(finalSummary.room.morningAmountPaise, 10000);
    assert.equal(finalSummary.room.nightAmountPaise, 8000);
    assert.equal(finalSummary.room.totalAmountPaise, 18000);

    // Sum of 3 member daily totals equals room daily total exactly
    const memberTotalSum =
      finalSummary.members.gaurav.totalAmountPaise +
      finalSummary.members.nikhil.totalAmountPaise +
      finalSummary.members.devansh.totalAmountPaise;

    assert.equal(memberTotalSum, finalSummary.room.totalAmountPaise);
  });
});
