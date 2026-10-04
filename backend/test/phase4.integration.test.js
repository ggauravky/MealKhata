import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { MonthlyMealRate } from '../src/billing/monthlyRate.model.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
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

  test('public GET rates returns fixed configured prices and creates nothing', async () => {
    const response = await request(testApp).get(`/api/billing/rates/${MONTH}`).expect(200);
    assert.deepEqual(response.body.data, {
      month: MONTH,
      configured: true,
      fixed: true,
      source: 'fixed',
      morningPricePaise: 5000,
      nightPricePaise: 7000,
      revision: 1,
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

  test('Super Admin PUT is rejected with 405 Method Not Allowed because prices are permanently fixed', async () => {
    const response = await putRate(ROLES.SUPERADMIN, valid);
    assert.equal(response.status, 405);
    assert.equal(response.body.message, 'Meal prices are fixed at ₹50 for Morning and ₹70 for Night.');
  });

  test('invalid logical month returns 400', async () => {
    assert.equal((await putRate(ROLES.SUPERADMIN, valid, '2026-13')).status, 400);
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

  test('missing dates are not_set with 0 eating and saved overrides have correct counts', async () => {
    await mealRepository.create({
      date: '2026-09-10',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
        night: { gaurav: 'taking', nikhil: 'skip', devansh: 'taking' },
      },
    });
    const response = await request(testApp).get(`/api/calendar/${MONTH}`).expect(200);
    const defaultDay = response.body.data.days[0];
    const savedDay = response.body.data.days[9];
    assert.equal(defaultDay.saved, false);
    assert.equal(defaultDay.counts.morningTaking, 0);
    assert.equal(defaultDay.counts.nightTaking, 0);
    assert.equal(defaultDay.counts.morningNotSet, 3);
    assert.equal(defaultDay.counts.nightNotSet, 3);
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
  test('untouched past 30-day month totals 0 meals per member and 0 for room without writes', async () => {
    const report = await reportService.getMonthlyReport('2026-04');
    assert.equal(report.periodType, 'past');
    assert.equal(report.toDate.members.gaurav.morningCount, 0);
    assert.equal(report.toDate.members.gaurav.nightCount, 0);
    assert.equal(report.toDate.members.gaurav.totalMeals, 0);
    assert.equal(report.toDate.room.totalMeals, 0);
    assert.equal(report.toDate.room.totalPhysicalPlates, 0);
    assert.equal(report.toDate.room.amountPaise, 0);
    assert.deepEqual(report.toDate, report.projection);
    assert.equal(mealRepository.count(), 0);
  });

  test('current to-date includes saved dates up to today and excludes future dates while projection includes them', async () => {
    await mealRepository.create({
      date: '2026-09-05',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'not_set', nikhil: 'taking', devansh: 'not_set' },
        night: { gaurav: 'not_set', nikhil: 'skip', devansh: 'not_set' },
      },
    });
    await mealRepository.create({
      date: '2026-09-25',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'not_set', nikhil: 'taking', devansh: 'not_set' },
        night: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
      },
    });
    const report = await reportService.getMonthlyReport(MONTH);
    assert.equal(report.periodType, 'current');
    assert.equal(report.toDate.endDate, TODAY);
    assert.equal(report.toDate.members.nikhil.morningCount, 1);
    assert.equal(report.toDate.members.nikhil.nightCount, 0);
    assert.equal(report.toDate.members.nikhil.totalMeals, 1);
    assert.equal(report.toDate.members.nikhil.amountPaise, 5000);
    assert.equal(report.projection.members.nikhil.morningCount, 2);
    assert.equal(report.projection.members.nikhil.nightCount, 0);
    assert.equal(report.projection.members.nikhil.totalMeals, 2);
    assert.equal(report.projection.members.nikhil.amountPaise, 10000);
  });

  test('future month has no to-date and unsaved future dates project 0 meals', async () => {
    const report = await reportService.getMonthlyReport('2026-10');
    assert.equal(report.periodType, 'future');
    assert.equal(report.toDate, null);
    assert.equal(report.projection.endDate, '2026-10-31');
    assert.equal(report.projection.room.totalMeals, 0);
    assert.equal(report.projection.room.totalPhysicalPlates, 0);
    assert.equal(report.projection.room.amountPaise, 0);
  });

  test('past month uses full month for both total and projection', async () => {
    const report = await reportService.getMonthlyReport('2026-08');
    assert.equal(report.periodType, 'past');
    assert.equal(report.toDate.endDate, '2026-08-31');
    assert.deepEqual(report.toDate, report.projection);
  });

  test('rates are permanently fixed at ₹50 for Morning and ₹70 for Night', async () => {
    await mealRepository.create({
      date: '2026-09-02',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'not_set', devansh: 'not_set' },
        night: { gaurav: 'taking', nikhil: 'not_set', devansh: 'not_set' },
      },
    });
    const report = await reportService.getMonthlyReport(MONTH);
    assert.equal(report.rates.configured, true);
    assert.equal(report.rates.fixed, true);
    assert.equal(report.rates.morningPricePaise, 5000);
    assert.equal(report.rates.nightPricePaise, 7000);
    assert.equal(report.toDate.amountsAvailable, true);
    assert.equal(report.toDate.members.gaurav.totalMeals, 2);
    assert.equal(report.toDate.members.gaurav.amountPaise, 12_000);
  });

  test('report endpoint is public, safe, and uses one meal bulk query plus one rate lookup', async () => {
    const response = await request(testApp).get(`/api/reports/monthly/${MONTH}`).expect(200);
    assert.equal(response.body.data.periodType, 'current');
    assert.equal(mealRepository.bulkFindCalls, 1);
    assert.doesNotMatch(JSON.stringify(response.body), /changes|_id|__v/);
    await request(testApp).get('/api/reports/monthly/2026-13').expect(400);
  });
});

