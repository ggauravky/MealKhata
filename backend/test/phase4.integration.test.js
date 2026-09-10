import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { MonthlyMealRate } from '../src/billing/monthlyRate.model.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { createDefaultMealDay } from '../src/meals/meal.defaults.js';
import { createReportService } from '../src/reports/report.service.js';
import { createBillingRouter } from '../src/routes/billing.routes.js';
import { createCalendarRouter } from '../src/routes/calendar.routes.js';
import { createReportRouter } from '../src/routes/report.routes.js';
import {
  compareLogicalMonths,
  daysInLogicalMonth,
  firstDateOfMonth,
  isValidLogicalMonth,
  lastDateOfMonth,
  listDatesInMonth,
} from '../src/utils/month.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { InMemoryMonthlyRateRepository } from './helpers/inMemoryMonthlyRateRepository.js';

const ORIGIN = 'http://localhost:5173';
const NOW = new Date('2026-09-09T20:00:00.000Z');
const TODAY = '2026-09-10';
const MONTH = '2026-09';

const mealRepository = new InMemoryMealRepository();
const rateRepository = new InMemoryMonthlyRateRepository();
const rateService = createMonthlyRateService({ repository: rateRepository });
const monthService = createMonthMealService({ repository: mealRepository, timezone: 'Asia/Kolkata' });
const reportService = createReportService({
  meals: monthService,
  rates: rateService,
  now: () => NOW,
  timezone: 'Asia/Kolkata',
});
const rateEvents = [];
const billing = createBillingRouter({
  service: rateService,
  broadcast: (payload) => rateEvents.push(payload),
});
const calendar = createCalendarRouter({
  service: monthService,
  now: () => NOW,
  timezone: 'Asia/Kolkata',
});
const reports = createReportRouter({ service: reportService });
const testApp = createApp({ billing, calendar, reports });

async function cookieFor(role) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role)}`;
}

async function putRate(role, body, month = MONTH) {
  let call = request(testApp)
    .put(`/api/billing/rates/${month}`)
    .set('Origin', ORIGIN)
    .send(body);

  if (role) {
    call = call.set('Cookie', await cookieFor(role));
  }

  return call;
}

async function seedSkip(date, mealType, memberId) {
  const day = createDefaultMealDay(date);
  day.meals[mealType][memberId] = 'skip';
  day.revision = 1;
  await mealRepository.create(day);
}

beforeEach(() => {
  mealRepository.reset();
  rateRepository.reset();
  rateEvents.length = 0;
});

describe('logical month utilities', () => {
  test('strictly accepts only canonical real YYYY-MM values', () => {
    for (const value of ['2026-01', '2026-09', '2026-12']) {
      assert.equal(isValidLogicalMonth(value), true);
    }
    for (const value of ['2026-00', '2026-13', '2026-1', '09-2026', '2026/09', 'abc']) {
      assert.equal(isValidLogicalMonth(value), false, value);
    }
  });

  test('calculates month boundaries and leap years without timezone drift', () => {
    assert.equal(daysInLogicalMonth('2026-04'), 30);
    assert.equal(daysInLogicalMonth('2026-01'), 31);
    assert.equal(daysInLogicalMonth('2027-02'), 28);
    assert.equal(daysInLogicalMonth('2028-02'), 29);
    assert.equal(firstDateOfMonth(MONTH), '2026-09-01');
    assert.equal(lastDateOfMonth(MONTH), '2026-09-30');
    assert.equal(listDatesInMonth('2028-02').at(-1), '2028-02-29');
  });

  test('compares valid logical months chronologically', () => {
    assert.equal(compareLogicalMonths('2026-08', MONTH), -1);
    assert.equal(compareLogicalMonths(MONTH, MONTH), 0);
    assert.equal(compareLogicalMonths('2026-10', MONTH), 1);
  });
});

describe('monthly rate API and service', () => {
  const valid = { morningPricePaise: 5000, nightPricePaise: 6000 };

  test('missing public GET returns configured false and creates nothing', async () => {
    const response = await request(testApp).get(`/api/billing/rates/${MONTH}`).expect(200);
    assert.deepEqual(response.body.data, {
      month: MONTH,
      configured: false,
      morningPricePaise: null,
      nightPricePaise: null,
      revision: 0,
      updatedAt: null,
    });
    assert.equal(rateRepository.count(), 0);
  });

  test('Viewer, Admin, and Super Admin can all GET rates', async () => {
    await request(testApp).get(`/api/billing/rates/${MONTH}`).expect(200);
    await request(testApp).get(`/api/billing/rates/${MONTH}`).set('Cookie', await cookieFor(ROLES.ADMIN)).expect(200);
    await request(testApp).get(`/api/billing/rates/${MONTH}`).set('Cookie', await cookieFor(ROLES.SUPERADMIN)).expect(200);
  });

  test('Viewer PUT is 401 and Admin PUT is 403', async () => {
    assert.equal((await putRate(null, valid)).status, 401);
    assert.equal((await putRate(ROLES.ADMIN, valid)).status, 403);
  });

  test('Super Admin first save succeeds with revision one and one event', async () => {
    const response = await putRate(ROLES.SUPERADMIN, valid);
    assert.equal(response.status, 200);
    assert.equal(response.body.changed, true);
    assert.equal(response.body.data.revision, 1);
    assert.equal(response.body.data.configured, true);
    assert.equal(rateEvents.length, 1);
    assert.deepEqual(Object.keys(rateEvents[0]).sort(), ['month', 'morningPricePaise', 'nightPricePaise', 'revision', 'updatedAt'].sort());
  });

  test('negative, floating, oversized, and unsafe paise values return 400', async () => {
    for (const body of [
      { ...valid, morningPricePaise: -1 },
      { ...valid, morningPricePaise: 62.5 },
      { ...valid, morningPricePaise: 10_000_001 },
      { ...valid, morningPricePaise: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      assert.equal((await putRate(ROLES.SUPERADMIN, body)).status, 400);
    }
  });

  test('invalid logical month returns 400', async () => {
    assert.equal((await putRate(ROLES.SUPERADMIN, valid, '2026-13')).status, 400);
  });

  test('real update increments revision and records authenticated actor', async () => {
    await putRate(ROLES.SUPERADMIN, { ...valid, actorRole: 'admin' });
    const response = await putRate(ROLES.SUPERADMIN, { morningPricePaise: 6250, nightPricePaise: 7000 });
    const stored = await rateRepository.findByMonth(MONTH);
    assert.equal(response.body.data.revision, 2);
    assert.equal(stored.changes.length, 2);
    assert.equal(stored.changes[0].actorRole, ROLES.SUPERADMIN);
    assert.deepEqual(stored.changes[1].from, valid);
  });

  test('identical update is a no-op without revision, history, or event changes', async () => {
    await putRate(ROLES.SUPERADMIN, valid);
    rateEvents.length = 0;
    const response = await putRate(ROLES.SUPERADMIN, valid);
    const stored = await rateRepository.findByMonth(MONTH);
    assert.equal(response.body.changed, false);
    assert.equal(response.body.data.revision, 1);
    assert.equal(stored.changes.length, 1);
    assert.equal(rateEvents.length, 0);
  });

  test('repeated and racing updates retain exactly one document per month', async () => {
    await Promise.all([
      rateService.updateRate({ month: MONTH, ...valid, actorRole: ROLES.SUPERADMIN }),
      rateService.updateRate({ month: MONTH, morningPricePaise: 5500, nightPricePaise: 6500, actorRole: ROLES.SUPERADMIN }),
    ]);
    assert.equal(rateRepository.count(), 1);
  });

  test('failed write returns sanitized 503 and emits nothing', async () => {
    rateRepository.failWrites = true;
    const response = await putRate(ROLES.SUPERADMIN, valid);
    assert.equal(response.status, 503);
    assert.equal(response.body.message, 'Unable to save meal rates. Please try again.');
    assert.equal(rateEvents.length, 0);
    assert.doesNotMatch(JSON.stringify(response.body), /simulated|database|stack/i);
  });

  test('explicit zero prices remain configured and distinct from missing rates', async () => {
    const response = await putRate(ROLES.SUPERADMIN, { morningPricePaise: 0, nightPricePaise: 0 });
    assert.equal(response.body.data.configured, true);
    assert.equal(response.body.data.morningPricePaise, 0);
    assert.equal(response.body.data.nightPricePaise, 0);
  });

  test('schema uses a unique month and strict integer paise validation', async () => {
    const indexes = MonthlyMealRate.schema.indexes();
    assert.ok(indexes.some(([fields, options]) => fields.month === 1 && options.unique === true));
    await assert.rejects(
      new MonthlyMealRate({ month: MONTH, ...valid, revision: 0.5 }).validate(),
      /revision must be an integer/,
    );
  });
});

describe('calendar monthly API', () => {
  test('returns the correct number of effective days using one bulk query', async () => {
    const response = await request(testApp).get('/api/calendar/2028-02').expect(200);
    assert.equal(response.body.data.days.length, 29);
    assert.equal(response.body.data.days[0].date, '2028-02-01');
    assert.equal(response.body.data.days.at(-1).date, '2028-02-29');
    assert.equal(mealRepository.bulkFindCalls, 1);
    assert.equal(mealRepository.count(), 0);
  });

  test('missing dates are all Taking and saved overrides have correct counts', async () => {
    await seedSkip('2026-09-10', 'night', 'nikhil');
    const response = await request(testApp).get(`/api/calendar/${MONTH}`).expect(200);
    const defaultDay = response.body.data.days[0];
    const savedDay = response.body.data.days[9];
    assert.equal(defaultDay.saved, false);
    assert.equal(defaultDay.counts.morningTaking, 3);
    assert.equal(defaultDay.counts.nightTaking, 3);
    assert.equal(savedDay.saved, true);
    assert.equal(savedDay.counts.nightTaking, 2);
    assert.equal(savedDay.meals.night.nikhil, 'skip');
    assert.doesNotMatch(JSON.stringify(response.body), /changes|_id|__v/);
  });

  test('permissions and backend India today are correct for every role', async () => {
    const viewer = await request(testApp).get(`/api/calendar/${MONTH}`).expect(200);
    const admin = await request(testApp).get(`/api/calendar/${MONTH}`).set('Cookie', await cookieFor(ROLES.ADMIN)).expect(200);
    const superadmin = await request(testApp).get(`/api/calendar/${MONTH}`).set('Cookie', await cookieFor(ROLES.SUPERADMIN)).expect(200);
    assert.equal(viewer.body.data.today, TODAY);
    assert.ok(viewer.body.data.days.every((day) => !day.permissions.canEdit));
    assert.deepEqual(admin.body.data.days.filter((day) => day.permissions.canEdit).map((day) => day.date), [TODAY]);
    assert.ok(superadmin.body.data.days.every((day) => day.permissions.canEdit));
  });

  test('invalid calendar month returns 400', async () => {
    await request(testApp).get('/api/calendar/2026-1').expect(400);
  });
});

describe('derived monthly reports', () => {
  test('untouched past 30-day month totals 60 meals per member and 180 for room without writes', async () => {
    const report = await reportService.getMonthlyReport('2026-04');
    assert.equal(report.periodType, 'past');
    assert.equal(report.toDate.members.gaurav.morningCount, 30);
    assert.equal(report.toDate.members.gaurav.nightCount, 30);
    assert.equal(report.toDate.members.gaurav.totalMeals, 60);
    assert.equal(report.toDate.room.totalMeals, 180);
    assert.deepEqual(report.toDate, report.projection);
    assert.equal(mealRepository.count(), 0);
  });

  test('current to-date includes Sep 1-10 and excludes future override while projection includes it', async () => {
    await seedSkip('2026-09-05', 'night', 'nikhil');
    await seedSkip('2026-09-25', 'night', 'nikhil');
    await rateService.updateRate({
      month: MONTH,
      morningPricePaise: 5000,
      nightPricePaise: 6000,
      actorRole: ROLES.SUPERADMIN,
    });
    const report = await reportService.getMonthlyReport(MONTH);
    assert.equal(report.periodType, 'current');
    assert.equal(report.toDate.endDate, TODAY);
    assert.equal(report.toDate.members.nikhil.morningCount, 10);
    assert.equal(report.toDate.members.nikhil.nightCount, 9);
    assert.equal(report.toDate.members.nikhil.totalMeals, 19);
    assert.equal(report.toDate.members.nikhil.amountPaise, 104_000);
    assert.equal(report.projection.members.nikhil.nightCount, 28);
    assert.equal(report.projection.members.nikhil.totalMeals, 58);
    assert.equal(report.projection.members.nikhil.amountPaise, 318_000);
  });

  test('future month has no to-date and projects the full month', async () => {
    const report = await reportService.getMonthlyReport('2026-10');
    assert.equal(report.periodType, 'future');
    assert.equal(report.toDate, null);
    assert.equal(report.projection.endDate, '2026-10-31');
    assert.equal(report.projection.room.totalMeals, 186);
  });

  test('past month uses full month for both total and projection', async () => {
    const report = await reportService.getMonthlyReport('2026-08');
    assert.equal(report.periodType, 'past');
    assert.equal(report.toDate.endDate, '2026-08-31');
    assert.deepEqual(report.toDate, report.projection);
  });

  test('missing rates preserve counts but return explicit null amounts', async () => {
    const report = await reportService.getMonthlyReport(MONTH);
    assert.equal(report.rates.configured, false);
    assert.equal(report.toDate.amountsAvailable, false);
    assert.equal(report.toDate.members.gaurav.totalMeals, 20);
    assert.equal(report.toDate.members.gaurav.amountPaise, null);
    assert.equal(report.toDate.room.amountPaise, null);
  });

  test('explicit zero rates make amounts available and calculate zero', async () => {
    await rateService.updateRate({ month: MONTH, morningPricePaise: 0, nightPricePaise: 0, actorRole: ROLES.SUPERADMIN });
    const report = await reportService.getMonthlyReport(MONTH);
    assert.equal(report.rates.configured, true);
    assert.equal(report.toDate.amountsAvailable, true);
    assert.equal(report.toDate.members.gaurav.amountPaise, 0);
    assert.equal(report.toDate.room.amountPaise, 0);
  });

  test('integer paise arithmetic remains exact', async () => {
    await rateService.updateRate({ month: MONTH, morningPricePaise: 6250, nightPricePaise: 0, actorRole: ROLES.SUPERADMIN });
    const report = await reportService.getMonthlyReport(MONTH);
    assert.equal(report.toDate.members.gaurav.morningAmountPaise, 62_500);
  });

  test('report endpoint is public, safe, and uses one meal bulk query plus one rate lookup', async () => {
    const response = await request(testApp).get(`/api/reports/monthly/${MONTH}`).expect(200);
    assert.equal(response.body.data.periodType, 'current');
    assert.equal(mealRepository.bulkFindCalls, 1);
    assert.doesNotMatch(JSON.stringify(response.body), /changes|_id|__v/);
    await request(testApp).get('/api/reports/monthly/2026-13').expect(400);
  });
});

