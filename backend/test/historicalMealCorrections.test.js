import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultMealDay } from '../src/meals/meal.defaults.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { buildLegacyMealSnapshot } from '../src/migrations/legacyMealSnapshot.service.js';
import { createHistoricalMealCorrectionService, resolveHistoricalMealAuthority } from '../src/meals/mealHistoricalCorrection.service.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { createReportService } from '../src/reports/report.service.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { createApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { ROLES } from '../src/auth/permissions.js';
import request from 'supertest';

test('explicit historical correction preserves the original day and frozen snapshot with revision conflicts', async () => {
  const source = createDefaultMealDay('2026-09-09', ['gaurav', 'nikhil', 'devansh']);
  delete source.schemaVersion;
  delete source.participantOrder;
  const meals = new InMemoryMealRepository();
  await meals.create(source);
  const original = await meals.findByDate(source.date);
  const frozen = buildLegacyMealSnapshot(original);
  const snapshots = { findByDateAndVersion: async () => frozen };
  const records = [];
  const corrections = {
    listByDate: async () => structuredClone(records),
    create: async (record) => { records.push(structuredClone(record)); return record; },
  };
  const service = createHistoricalMealCorrectionService({ meals, snapshots, corrections });
  const corrected = await service.correct({
    date: source.date, expectedRevision: 0, operation: 'status', mealType: 'morning',
    memberId: 'gaurav', status: 'taking', reason: 'Verified attendance register', actorRole: 'superadmin',
  });
  assert.equal(corrected.revision, 1);
  assert.equal(corrected.dailyCostSummary.members.gaurav.morningAmountPaise, 5000);
  assert.deepEqual(await meals.findByDate(source.date), original);
  assert.equal(frozen.costs.morning.memberAmountsPaise.gaurav, 0);
  assert.equal(records.length, 1);
  const repriced = await service.correct({
    date: source.date, expectedRevision: 1, operation: 'price', mealType: 'morning',
    pricePaise: 101, reason: 'Corrected archived receipt', actorRole: 'superadmin',
  });
  assert.equal(repriced.revision, 2);
  assert.equal(repriced.dailyCostSummary.members.gaurav.morningAmountPaise, 101);
  await assert.rejects(service.correct({
    date: source.date, expectedRevision: 0, operation: 'status', mealType: 'morning',
    memberId: 'nikhil', status: 'taking', reason: 'Stale correction', actorRole: 'superadmin',
  }), /revision|refresh/i);
  const authority = await resolveHistoricalMealAuthority(original, { snapshots, corrections });
  assert.equal(authority.sourceRevision, 2);
  const students = { listEligibleOn: async () => [] };
  const calendar = await createMonthMealService({ repository: meals, snapshots, corrections, students, runtimeProfile: 'v3' }).getMonth('2026-09');
  assert.equal(calendar.days[8].pricing.morning.effectivePricePaise, 101);
  assert.equal(calendar.days[8].priceOverrides.morning.pricePaise, 101);
  const report = await createReportService({
    meals: createMonthMealService({ repository: meals, snapshots, corrections, students, runtimeProfile: 'v3' }),
    rates: { getRate: async () => ({ configured: true, morningPricePaise: 5000, nightPricePaise: 7000 }) },
    now: () => new Date('2026-10-01T12:00:00Z'),
  }).getMonthlyReport('2026-09');
  assert.equal(report.toDate.room.amountPaise, 101);
  assert.equal(report.toDate.members.gaurav.amountPaise, 101);
  assert.equal(frozen.costs.morning.roomAmountPaise, 0);
  const blocked = createHistoricalMealCorrectionService({
    meals, snapshots, corrections,
    stays: {
      getActiveStayForMember: async () => null,
      listStaysForMember: async () => [{ status: 'CHECKED_OUT', actualLeftOn: '2026-09-08' }],
    },
  });
  await assert.rejects(blocked.correct({
    date: source.date, expectedRevision: 2, operation: 'status', mealType: 'night',
    memberId: 'nikhil', status: 'taking', reason: 'Invalid late meal', actorRole: 'superadmin',
  }), /checkout/i);
  assert.equal(records.length, 2);
  records[1].snapshot.costs.morning.memberAmountsPaise.gaurav += 1;
  await assert.rejects(resolveHistoricalMealAuthority(original, { snapshots, corrections }), /correction snapshot mismatch/i);
});

test('historical correction API is Super Admin only and ordinary PATCH cannot invalidate frozen authority', async () => {
  const source = createDefaultMealDay('2026-09-09', ['gaurav', 'nikhil', 'devansh']);
  delete source.schemaVersion;
  delete source.participantOrder;
  const meals = new InMemoryMealRepository();
  await meals.create(source);
  const original = await meals.findByDate(source.date);
  const frozen = buildLegacyMealSnapshot(original);
  const snapshots = { findByDateAndVersion: async () => frozen };
  const records = [];
  const corrections = {
    listByDate: async () => structuredClone(records),
    create: async (record) => { records.push(structuredClone(record)); return record; },
  };
  const correctionService = createHistoricalMealCorrectionService({ meals, snapshots, corrections });
  const service = createMealService({ repository: meals, snapshots, corrections, runtimeProfile: 'v3' });
  const app = createApp({ meals: createMealRouter({
    service, correctionService, settlements: null, broadcast: () => {},
    now: () => new Date('2026-09-09T20:00:00.000Z'),
  }) });
  const cookie = async (role) => `${SESSION_COOKIE_NAME}=${await createSessionToken(role)}`;
  const payload = { expectedRevision: 0, operation: 'status', mealType: 'morning', memberId: 'gaurav', status: 'taking', reason: 'Verified attendance register' };
  await request(app).post('/api/meals/2026-09-09/corrections').set('Origin', 'http://localhost:5173').set('Cookie', await cookie(ROLES.ADMIN)).send(payload).expect(403);
  const ordinary = await request(app).patch('/api/meals/2026-09-09').set('Origin', 'http://localhost:5173').set('Cookie', await cookie(ROLES.SUPERADMIN))
    .send({ mealType: 'morning', memberId: 'gaurav', status: 'taking' });
  assert.equal(ordinary.status, 409, JSON.stringify(ordinary.body));
  const response = await request(app).post('/api/meals/2026-09-09/corrections')
    .set('Origin', 'http://localhost:5173').set('Cookie', await cookie(ROLES.SUPERADMIN)).send(payload).expect(200);
  assert.equal(response.body.data.revision, 1);
  assert.equal(response.body.data.permissions.canEdit, false);
  assert.equal(response.body.data.permissions.canCorrectHistorical, true);
  const read = await request(app).get('/api/meals/2026-09-09').expect(200);
  assert.equal(read.body.data.dailyCostSummary.members.gaurav.morningAmountPaise, 5000);
  assert.deepEqual(await meals.findByDate(source.date), original);
});
