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

  test('28. constants and schema enforce exactly the Phase 3 domain', async () => {
    const document = new MealDay(createDefaultMealDay(DATES.today));
    await document.validate();
    const indexes = MealDay.schema.indexes();
    assert.deepEqual(MEMBERS.map(({ id }) => id), ['gaurav', 'nikhil', 'devansh']);
    assert.ok(indexes.some(([fields, options]) => fields.date === 1 && options.unique === true));
    assert.throws(() => new MealDay({ ...createDefaultMealDay(DATES.today), unexpected: true }), /strict/i);
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

