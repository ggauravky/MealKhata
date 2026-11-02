import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, beforeEach, describe, test } from 'node:test';
import { io as createSocketClient } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { MEMBERS } from '../src/config/members.js';
import { createDefaultMealDay } from '../src/meals/meal.defaults.js';
import { MealDay } from '../src/meals/meal.model.js';
import { serializeHistory, serializeMealDay } from '../src/meals/meal.serializer.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { createSocketServer } from '../src/socket.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';

const ORIGIN = 'http://localhost:5173';
const NOW = new Date('2026-09-09T20:00:00.000Z');
const DATES = Object.freeze({
  yesterday: '2026-09-09',
  today: '2026-09-10',
  tomorrow: '2026-09-11',
});
const FOURTH_STUDENT_ID = 'student_0123456789abcdef0123456789abcdef';

const repository = new InMemoryMealRepository();
const broadcasts = [];
const service = createMealService({ repository, timezone: 'Asia/Kolkata' });
const meals = createMealRouter({
  service,
  broadcast: (payload) => broadcasts.push(payload),
  now: () => NOW,
  timezone: 'Asia/Kolkata',
});
const testApp = createApp({ meals });

async function cookieFor(role) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role)}`;
}

async function patchMeal(role, date, body, app = testApp) {
  let call = request(app).patch(`/api/meals/${date}`).set('Origin', ORIGIN).send(body);

  if (role) {
    call = call.set('Cookie', await cookieFor(role));
  }

  return call;
}

function assertAllNotSet(data) {
  for (const mealType of ['morning', 'night']) {
    for (const member of MEMBERS) {
      assert.equal(data.meals[mealType][member.id], 'not_set');
    }
  }
}

beforeEach(() => {
  repository.reset();
  broadcasts.length = 0;
});

describe('public meal reads', () => {
  test('1. GET /api/meals/today is public and uses the backend India date', async () => {
    const response = await request(testApp).get('/api/meals/today').expect(200);
    assert.equal(response.body.data.date, DATES.today);
    assert.equal(response.body.data.timezone, 'Asia/Kolkata');
  });

  test('2. GET /api/meals/:date is public', async () => {
    const response = await request(testApp).get(`/api/meals/${DATES.yesterday}`).expect(200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.date, DATES.yesterday);
  });

  test('3. a missing day returns six Not Set slots without writing', async () => {
    const response = await request(testApp).get(`/api/meals/${DATES.tomorrow}`).expect(200);
    assertAllNotSet(response.body.data);
    assert.equal(response.body.data.saved, false);
    assert.equal(response.body.data.revision, 0);
    assert.equal(repository.count(), 0);
  });

  test('3a. a missing day uses the date-eligible dynamic roster without persisting defaults', async () => {
    const dynamicRepository = new InMemoryMealRepository();
    const requestedDates = [];
    const students = {
      async listEligibleOn(date) {
        requestedDates.push(date);
        return [
          { studentId: 'gaurav' },
          { studentId: FOURTH_STUDENT_ID },
        ];
      },
    };
    const dynamicService = createMealService({
      repository: dynamicRepository,
      students,
      timezone: 'Asia/Kolkata',
    });

    const day = await dynamicService.getDay(DATES.tomorrow);

    assert.deepEqual(Object.keys(day.meals.morning), ['gaurav', FOURTH_STUDENT_ID]);
    assert.deepEqual(Object.keys(day.meals.night), ['gaurav', FOURTH_STUDENT_ID]);
    assert.deepEqual(requestedDates, [DATES.tomorrow]);
    assert.equal(day.saved, false);
    assert.equal(dynamicRepository.count(), 0);
  });

  test('3b. zero date-eligible students produces a valid empty unsaved day', async () => {
    const dynamicRepository = new InMemoryMealRepository();
    const dynamicService = createMealService({
      repository: dynamicRepository,
      students: { listEligibleOn: async () => [] },
      timezone: 'Asia/Kolkata',
    });

    const day = await dynamicService.getDay(DATES.tomorrow);

    assert.deepEqual(day.meals, { morning: {}, night: {} });
    assert.equal(day.saved, false);
    assert.equal(dynamicRepository.count(), 0);
  });

  test('3c. a new day cannot reintroduce a date-ineligible student', async () => {
    const dynamicRepository = new InMemoryMealRepository();
    const dynamicService = createMealService({
      repository: dynamicRepository,
      students: { listEligibleOn: async () => [] },
      timezone: 'Asia/Kolkata',
    });

    await assert.rejects(dynamicService.changeStatus({
      date: DATES.tomorrow,
      mealType: 'morning',
      memberId: 'gaurav',
      status: 'taking',
      actorRole: ROLES.SUPERADMIN,
    }), /eligible|eligibility/i);
    assert.equal(dynamicRepository.count(), 0);
  });

  test('4. malformed logical dates return 400', async () => {
    const response = await request(testApp).get('/api/meals/2026-9-10').expect(400);
    assert.match(response.body.message, /valid calendar date/i);
  });

  test('5. impossible calendar dates return 400', async () => {
    await request(testApp).get('/api/meals/2026-02-30').expect(400);
  });

  test('6. edit permission metadata is role-aware but does not expose internals', async () => {
    const viewer = await request(testApp).get(`/api/meals/${DATES.today}`).expect(200);
    const admin = await request(testApp)
      .get(`/api/meals/${DATES.today}`)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .expect(200);
    const text = JSON.stringify(admin.body);

    assert.equal(viewer.body.data.permissions.canEdit, false);
    assert.equal(admin.body.data.permissions.canEdit, true);
    assert.doesNotMatch(text, /_id|__v|password|email|principal/i);
  });
});

describe('meal mutation authorization and validation', () => {
  test('a generated fourth student can be edited by Super Admin through the meal route', async () => {
    const dynamicRepository = new InMemoryMealRepository();
    const dynamicService = createMealService({
      repository: dynamicRepository,
      students: { listEligibleOn: async () => [
        { studentId: 'gaurav' }, { studentId: FOURTH_STUDENT_ID },
      ] },
      timezone: 'Asia/Kolkata',
    });
    const dynamicApp = createApp({ meals: createMealRouter({
      service: dynamicService,
      now: () => NOW,
      timezone: 'Asia/Kolkata',
      broadcast: () => {},
      settlements: null,
    }) });
    const response = await patchMeal(ROLES.SUPERADMIN, DATES.today, {
      mealType: 'morning', memberId: FOURTH_STUDENT_ID, status: 'taking',
    }, dynamicApp);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.meals.morning[FOURTH_STUDENT_ID], 'taking');
    assert.ok(response.body.data.permissions.editableMemberIds.includes(FOURTH_STUDENT_ID));
  });

  test('allocation API rejects a stale expected revision for a fourth student', async () => {
    const dynamicRepository = new InMemoryMealRepository();
    const dynamicService = createMealService({
      repository: dynamicRepository,
      students: { listEligibleOn: async () => [
        { studentId: 'gaurav' }, { studentId: FOURTH_STUDENT_ID },
      ] },
    });
    const app = createApp({ meals: createMealRouter({
      service: dynamicService, settlements: null, broadcast: () => {},
      now: () => NOW, timezone: 'Asia/Kolkata',
    }) });
    const allocation = { mode: 'custom', plates: [{ shares: { [FOURTH_STUDENT_ID]: 6 } }], expectedRevision: 0 };
    const endpoint = `/api/meals/${DATES.today}/morning/allocation`;
    await request(app).put(endpoint).set('Origin', ORIGIN).set('Cookie', await cookieFor(ROLES.SUPERADMIN))
      .send(allocation).expect(200);
    const stale = await request(app).put(endpoint).set('Origin', ORIGIN).set('Cookie', await cookieFor(ROLES.SUPERADMIN))
      .send(allocation).expect(409);
    assert.match(stale.body.message, /revision|refresh/i);
    assert.equal((await dynamicRepository.findByDate(DATES.today)).revision, 1);
  });
  const validChange = { mealType: 'night', memberId: 'nikhil', status: 'skip' };

  test('7. Viewer PATCH returns 401', async () => {
    await patchMeal(null, DATES.today, validChange).then((response) => assert.equal(response.status, 401));
  });

  test('8. Admin PATCH today succeeds', async () => {
    const response = await patchMeal(ROLES.ADMIN, DATES.today, validChange);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.meals.night.nikhil, 'skip');
  });

  test('9. Admin PATCH yesterday returns 403', async () => {
    assert.equal((await patchMeal(ROLES.ADMIN, DATES.yesterday, validChange)).status, 403);
  });

  test('10. Admin PATCH tomorrow returns 403', async () => {
    assert.equal((await patchMeal(ROLES.ADMIN, DATES.tomorrow, validChange)).status, 403);
  });

  test('11. Super Admin PATCH past succeeds', async () => {
    assert.equal((await patchMeal(ROLES.SUPERADMIN, DATES.yesterday, validChange)).status, 200);
  });

  test('12. Super Admin PATCH today succeeds', async () => {
    assert.equal((await patchMeal(ROLES.SUPERADMIN, DATES.today, validChange)).status, 200);
  });

  test('13. Super Admin PATCH future succeeds', async () => {
    assert.equal((await patchMeal(ROLES.SUPERADMIN, DATES.tomorrow, validChange)).status, 200);
  });

  test('14. invalid mealType returns 400', async () => {
    const response = await patchMeal(ROLES.ADMIN, DATES.today, { ...validChange, mealType: 'lunch' });
    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Invalid meal type.');
  });

  test('15. invalid memberId returns 400', async () => {
    const response = await patchMeal(ROLES.ADMIN, DATES.today, { ...validChange, memberId: 'intruder' });
    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Invalid member.');
  });

  test('16. invalid status returns 400', async () => {
    const response = await patchMeal(ROLES.ADMIN, DATES.today, { ...validChange, status: 'pending' });
    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Invalid meal status.');
  });

  test('17. browser actorRole is ignored in favor of the authenticated role', async () => {
    await patchMeal(ROLES.ADMIN, DATES.today, { ...validChange, actorRole: 'superadmin' });
    const history = await service.getHistory(DATES.today, 50);
    assert.equal(history.items[0].actorRole, ROLES.ADMIN);
  });
});

describe('revision, history, no-op, and concurrency behavior', () => {
  test('18. Not Set to Skip creates revision one and one history entry', async () => {
    const response = await patchMeal(ROLES.ADMIN, DATES.today, {
      mealType: 'morning', memberId: 'gaurav', status: 'skip',
    });
    const history = await service.getHistory(DATES.today, 50);
    assert.equal(response.body.changed, true);
    assert.equal(response.body.data.revision, 1);
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].from, 'not_set');
    assert.equal(history.items[0].to, 'skip');
  });

  test('19. Skip to Taking increments revision and appends history', async () => {
    const change = { mealType: 'morning', memberId: 'gaurav' };
    await patchMeal(ROLES.ADMIN, DATES.today, { ...change, status: 'skip' });
    const response = await patchMeal(ROLES.ADMIN, DATES.today, { ...change, status: 'taking' });
    const history = await service.getHistory(DATES.today, 50);
    assert.equal(response.body.changed, true);
    assert.equal(response.body.data.revision, 2);
    assert.equal(history.items.length, 2);
    assert.equal(history.items[0].from, 'skip');
    assert.equal(history.items[0].to, 'taking');
  });

  test('20. Taking to Taking is a saved no-op', async () => {
    const change = { mealType: 'night', memberId: 'devansh', status: 'taking' };
    await patchMeal(ROLES.ADMIN, DATES.today, change);
    const response = await patchMeal(ROLES.ADMIN, DATES.today, change);
    assert.equal(response.body.changed, false);
    assert.equal(response.body.data.saved, true);
    assert.equal(response.body.data.revision, 1);
    assert.equal(repository.count(), 1);
  });

  test('21. Skip to Skip is a no-op with no revision or history increase', async () => {
    const change = { mealType: 'night', memberId: 'devansh', status: 'skip' };
    await patchMeal(ROLES.ADMIN, DATES.today, change);
    const response = await patchMeal(ROLES.ADMIN, DATES.today, change);
    const history = await service.getHistory(DATES.today, 50);
    assert.equal(response.body.changed, false);
    assert.equal(response.body.data.revision, 1);
    assert.equal(history.items.length, 1);
  });

  test('22. repeated writes keep only one document per date', async () => {
    await patchMeal(ROLES.ADMIN, DATES.today, { mealType: 'night', memberId: 'nikhil', status: 'skip' });
    await patchMeal(ROLES.ADMIN, DATES.today, { mealType: 'morning', memberId: 'gaurav', status: 'skip' });
    assert.equal(repository.count(), 1);
  });

  test('23. concurrent changes to different slots preserve both results', async () => {
    const [first, second] = await Promise.all([
      service.changeStatus({ date: DATES.today, mealType: 'night', memberId: 'nikhil', status: 'skip', actorRole: ROLES.ADMIN }),
      service.changeStatus({ date: DATES.today, mealType: 'morning', memberId: 'devansh', status: 'skip', actorRole: ROLES.ADMIN }),
    ]);
    const final = await service.getDay(DATES.today);
    assert.equal(first.changed, true);
    assert.equal(second.changed, true);
    assert.equal(final.meals.night.nikhil, 'skip');
    assert.equal(final.meals.morning.devansh, 'skip');
    assert.equal(final.revision, 2);
  });

  test('24. history is protected, newest first, and strictly limited', async () => {
    await service.changeStatus({ date: DATES.today, mealType: 'night', memberId: 'nikhil', status: 'skip', actorRole: ROLES.ADMIN, changedAt: new Date('2026-09-09T18:00:00Z') });
    await service.changeStatus({ date: DATES.today, mealType: 'night', memberId: 'nikhil', status: 'taking', actorRole: ROLES.SUPERADMIN, changedAt: new Date('2026-09-09T19:00:00Z') });

    await request(testApp).get(`/api/meals/${DATES.today}/history`).expect(401);
    const response = await request(testApp)
      .get(`/api/meals/${DATES.today}/history?limit=1`)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .expect(200);
    assert.equal(response.body.data.items.length, 1);
    assert.equal(response.body.data.items[0].actorRole, ROLES.SUPERADMIN);
    await request(testApp)
      .get(`/api/meals/${DATES.today}/history?limit=101`)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .expect(400);
  });
});

describe('broadcast and model safety', () => {
  const change = { mealType: 'night', memberId: 'nikhil', status: 'skip' };

  test('25. a failed database mutation does not broadcast and returns a sanitized 5xx', async () => {
    repository.failWrites = true;
    const response = await patchMeal(ROLES.ADMIN, DATES.today, change);
    assert.equal(response.status, 503);
    assert.equal(response.body.message, 'Unable to save the meal change. Please try again.');
    assert.equal(broadcasts.length, 0);
    assert.doesNotMatch(JSON.stringify(response.body), /simulated|database outage|stack/i);
  });

  test('26. a successful real mutation broadcasts exactly one sanitized payload', async () => {
    const response = await patchMeal(ROLES.ADMIN, DATES.today, change);
    assert.equal(response.status, 200);
    assert.equal(broadcasts.length, 1);
    assert.deepEqual(Object.keys(broadcasts[0]).sort(), ['date', 'mealType', 'memberId', 'revision', 'status', 'updatedAt'].sort());
    assert.deepEqual(broadcasts[0], {
      date: DATES.today,
      mealType: 'night',
      memberId: 'nikhil',
      status: 'skip',
      revision: 1,
      updatedAt: response.body.data.updatedAt,
    });
  });

  test('27. a no-op mutation does not broadcast', async () => {
    const change = { mealType: 'night', memberId: 'nikhil', status: 'taking' };
    await patchMeal(ROLES.ADMIN, DATES.today, change);
    broadcasts.length = 0;

    const response = await patchMeal(ROLES.ADMIN, DATES.today, change);
    assert.equal(response.body.changed, false);
    assert.equal(broadcasts.length, 0);
  });

  test('28. schema stores validated dynamic status and plate-share maps', async () => {
    const document = new MealDay({
      ...createDefaultMealDay(DATES.today, ['gaurav', 'nikhil', 'devansh', FOURTH_STUDENT_ID]),
      allocations: {
        morning: {
          mode: 'custom',
          plates: [{ shares: { gaurav: 3, [FOURTH_STUDENT_ID]: 3 } }],
        },
        night: null,
      },
    });
    await document.validate();
    const indexes = MealDay.schema.indexes();
    assert.equal(document.schemaVersion, 3);
    assert.equal(document.meals.morning instanceof Map, true);
    assert.equal(document.meals.morning.get(FOURTH_STUDENT_ID), 'not_set');
    assert.equal(document.allocations.morning.plates[0].shares instanceof Map, true);
    assert.equal(document.allocations.morning.plates[0].shares.get(FOURTH_STUDENT_ID), 3);
    assert.ok(indexes.some(([fields, options]) => fields.date === 1 && options.unique === true));
    assert.throws(() => new MealDay({ ...createDefaultMealDay(DATES.today), unexpected: true }), /strict/i);
  });

  test('29. defaults support zero, one, four, and many eligible students without a static roster', () => {
    const cases = [
      [],
      ['gaurav'],
      ['gaurav', 'nikhil', 'devansh', FOURTH_STUDENT_ID],
      ['gaurav', 'nikhil', 'devansh', FOURTH_STUDENT_ID, 'student_fifth', 'student_sixth'],
    ];

    for (const studentIds of cases) {
      const day = createDefaultMealDay(DATES.today, studentIds);
      assert.equal(day.schemaVersion, 3);
      assert.deepEqual(Object.keys(day.meals.morning), studentIds);
      assert.deepEqual(Object.keys(day.meals.night), studentIds);
      assert.ok(Object.values(day.meals.morning).every((status) => status === 'not_set'));
    }
  });

  test('30. serializer flattens Map data and preserves every stored dynamic participant and share', async () => {
    const document = new MealDay({
      ...createDefaultMealDay(DATES.today, ['gaurav', FOURTH_STUDENT_ID]),
      meals: {
        morning: { gaurav: 'taking', [FOURTH_STUDENT_ID]: 'taking' },
        night: { gaurav: 'skip', [FOURTH_STUDENT_ID]: 'taking' },
      },
      allocations: {
        morning: {
          mode: 'custom',
          plates: [{ shares: { gaurav: 3, [FOURTH_STUDENT_ID]: 3 } }],
        },
        night: null,
      },
    });
    await document.validate();

    const serialized = serializeMealDay(document, DATES.today);

    assert.equal(serialized.schemaVersion, 3);
    assert.deepEqual(serialized.meals.morning, { gaurav: 'taking', [FOURTH_STUDENT_ID]: 'taking' });
    assert.deepEqual(serialized.allocations.morning.plates[0].shares, {
      gaurav: 3,
      [FOURTH_STUDENT_ID]: 3,
    });
    assert.deepEqual(serialized.allocations.morning.shareUnits, {
      gaurav: 3,
      [FOURTH_STUDENT_ID]: 3,
      totalUnits: 6,
    });
    assert.equal(serialized.meals.morning instanceof Map, false);
  });

  test('31. legacy hydration preserves archived participants, audits, overrides, revisions, and timestamps', () => {
    const archivedStudentId = 'student_archived';
    const createdAt = new Date('2026-09-10T03:00:00.000Z');
    const updatedAt = new Date('2026-09-10T05:00:00.000Z');
    const legacy = MealDay.hydrate({
      date: DATES.today,
      meals: {
        morning: { gaurav: 'taking', [archivedStudentId]: 'taking' },
        night: { gaurav: 'skip', [archivedStudentId]: 'skip' },
      },
      allocations: {
        morning: {
          mode: 'custom',
          plates: [{ shares: { gaurav: 3, [archivedStudentId]: 3 } }],
        },
        night: null,
      },
      priceOverrides: {
        morning: { pricePaise: 4321, reason: 'Historical receipt' },
        night: null,
      },
      revision: 9,
      changes: [{
        changedAt: new Date('2026-09-10T04:00:00.000Z'),
        actorRole: 'member',
        actorMemberId: archivedStudentId,
        mealType: 'morning',
        memberId: archivedStudentId,
        from: 'not_set',
        to: 'taking',
      }],
      allocationChanges: [],
      priceChanges: [],
      createdAt,
      updatedAt,
    });

    const serialized = serializeMealDay(legacy, DATES.today);
    const history = serializeHistory(legacy, DATES.today, 10);

    assert.equal(Object.hasOwn(serialized, 'schemaVersion'), false);
    assert.equal(serialized.meals.morning[archivedStudentId], 'taking');
    assert.equal(serialized.allocations.morning.plates[0].shares[archivedStudentId], 3);
    assert.equal(serialized.pricing.morning.overridePricePaise, 4321);
    assert.equal(serialized.revision, 9);
    assert.equal(serialized.createdAt, createdAt.toISOString());
    assert.equal(serialized.updatedAt, updatedAt.toISOString());
    assert.equal(history.items[0].actorMemberId, archivedStudentId);
    assert.equal(history.items[0].memberId, archivedStudentId);
  });

  test('32. unsafe dynamic student keys are rejected instead of becoming MongoDB paths', async () => {
    const unsafeMeals = Object.fromEntries([['student.invalid', 'taking']]);
    const document = new MealDay({
      ...createDefaultMealDay(DATES.today, []),
      meals: { morning: unsafeMeals, night: {} },
    });

    await assert.rejects(document.validate(), /safe|key|map|student/i);
  });

  test('33. dynamic allocations retain the six-unit, per-student, and plate-count invariants', async () => {
    const invalidAllocations = [
      [{ shares: { gaurav: 5 } }],
      [
        { shares: { gaurav: 6 } },
        { shares: { gaurav: 6 } },
      ],
      [
        { shares: { gaurav: 6 } },
        { shares: { nikhil: 6 } },
        { shares: { devansh: 6 } },
        { shares: { [FOURTH_STUDENT_ID]: 6 } },
        { shares: { gaurav: 6 } },
      ],
    ];

    for (const plates of invalidAllocations) {
      const document = new MealDay({
        ...createDefaultMealDay(DATES.today, ['gaurav', 'nikhil', 'devansh', FOURTH_STUDENT_ID]),
        allocations: { morning: { mode: 'custom', plates }, night: null },
      });
      await assert.rejects(document.validate(), /six|6|plate|share/i);
    }
  });
});

describe('Socket.IO end-to-end delivery', () => {
  let httpServer;
  let io;
  const clients = [];

  after(async () => {
    for (const client of clients) {
      client.close();
    }

    if (io) {
      await new Promise((resolve) => io.close(resolve));
    }

    if (httpServer?.listening) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  test('29. Client B receives Client A REST mutation and reconnect refresh is authoritative', async () => {
    const socketRepository = new InMemoryMealRepository();
    const socketService = createMealService({ repository: socketRepository, timezone: 'Asia/Kolkata' });
    let broadcaster = () => {};
    const socketRouter = createMealRouter({
      service: socketService,
      broadcast: (payload) => broadcaster(payload),
      now: () => NOW,
      timezone: 'Asia/Kolkata',
    });
    httpServer = createServer(createApp({ meals: socketRouter }));
    io = createSocketServer(httpServer);
    broadcaster = (payload) => io.emit('meal:updated', payload);

    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    const url = `http://127.0.0.1:${address.port}`;
    const createClient = () => createSocketClient(url, { path: '/socket.io', forceNew: true });
    const clientA = createClient();
    const clientB = createClient();
    clients.push(clientA, clientB);

    await Promise.all([clientA, clientB].map((client) => new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    })));

    const eventPromise = new Promise((resolve) => clientB.once('meal:updated', resolve));
    const response = await request(url)
      .patch(`/api/meals/${DATES.today}`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send({ mealType: 'night', memberId: 'nikhil', status: 'skip' })
      .expect(200);
    const event = await eventPromise;

    assert.equal(event.date, DATES.today);
    assert.equal(event.mealType, 'night');
    assert.equal(event.memberId, 'nikhil');
    assert.equal(event.status, 'skip');
    assert.equal(event.revision, 1);
    assert.equal(response.body.data.revision, 1);

    clientB.disconnect();
    const reconnected = new Promise((resolve, reject) => {
      clientB.once('connect', resolve);
      clientB.once('connect_error', reject);
    });
    clientB.connect();
    await reconnected;

    const refreshed = await request(url).get(`/api/meals/${DATES.today}`).expect(200);
    assert.equal(refreshed.body.data.meals.night.nikhil, 'skip');
    assert.equal(refreshed.body.data.revision, 1);
  });
});

