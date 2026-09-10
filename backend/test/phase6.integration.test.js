import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import request from 'supertest';
import {
  API_RATE_LIMIT,
  createApp,
  createHelmetOptions,
  PRODUCTION_TRUST_PROXY_HOPS,
} from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { ReminderSettings } from '../src/settings/reminderSettings.model.js';
import { createReminderSettingsService } from '../src/settings/reminderSettings.service.js';
import { createReminderSettingsRouter } from '../src/routes/reminderSettings.routes.js';
import { createHealthRouter } from '../src/routes/health.routes.js';
import { InMemoryReminderSettingsRepository } from './helpers/inMemoryReminderSettingsRepository.js';

const ORIGIN = 'http://localhost:5173';
const repository = new InMemoryReminderSettingsRepository();
const broadcasts = [];
const service = createReminderSettingsService({ repository });
const reminders = createReminderSettingsRouter({
  service,
  broadcast: (payload) => broadcasts.push(payload),
});
const testApp = createApp({ reminderSettings: reminders });

async function cookieFor(role) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role)}`;
}

async function update(role, body) {
  let operation = request(testApp).put('/api/settings/reminders').set('Origin', ORIGIN).send(body);
  if (role) operation = operation.set('Cookie', await cookieFor(role));
  return operation;
}

const changedSchedule = {
  reminders: {
    morning: { enabled: true, time: '09:30' },
    night: { enabled: false, time: '20:30' },
  },
};

beforeEach(() => {
  repository.reset();
  broadcasts.length = 0;
});

describe('reminder settings', () => {
  test('public GET returns safe defaults without audit history', async () => {
    const response = await request(testApp).get('/api/settings/reminders').expect(200);
    assert.deepEqual(response.body.data.reminders, {
      morning: { enabled: true, time: '09:00' },
      night: { enabled: true, time: '20:00' },
    });
    assert.equal(response.body.data.configured, false);
    assert.equal('changes' in response.body.data, false);
    assert.doesNotMatch(JSON.stringify(response.body), /actorRole|_id|__v/i);
  });

  test('Viewer and Admin cannot update while Super Admin can', async () => {
    assert.equal((await update(null, changedSchedule)).status, 401);
    assert.equal((await update(ROLES.ADMIN, changedSchedule)).status, 403);
    const response = await update(ROLES.SUPERADMIN, changedSchedule);
    assert.equal(response.status, 200);
    assert.equal(response.body.changed, true);
    assert.equal(response.body.data.revision, 1);
  });

  test('strictly validates HH:mm, booleans, shape, and mass assignment', async () => {
    for (const time of ['9:00', '25:00', '12:99', 'abc']) {
      const response = await update(ROLES.SUPERADMIN, {
        reminders: { ...changedSchedule.reminders, morning: { enabled: true, time } },
      });
      assert.equal(response.status, 400, time);
    }

    assert.equal((await update(ROLES.SUPERADMIN, {
      reminders: { ...changedSchedule.reminders, morning: { enabled: 'yes', time: '09:00' } },
    })).status, 400);
    assert.equal((await update(ROLES.SUPERADMIN, { ...changedSchedule, actorRole: 'superadmin' })).status, 400);
    assert.equal((await update(ROLES.SUPERADMIN, {
      reminders: { ...changedSchedule.reminders, morning: { enabled: true, time: '09:00', secret: true } },
    })).status, 400);
  });

  test('accepts boundary times and stores the authenticated actor', async () => {
    const response = await update(ROLES.SUPERADMIN, {
      reminders: {
        morning: { enabled: true, time: '00:00' },
        night: { enabled: true, time: '23:59' },
      },
    });
    assert.equal(response.status, 200);
    const document = await repository.findPrimary();
    assert.equal(document.changes[0].actorRole, ROLES.SUPERADMIN);
  });

  test('a no-op does not persist, increment, append history, or broadcast', async () => {
    const defaults = {
      reminders: {
        morning: { enabled: true, time: '09:00' },
        night: { enabled: true, time: '20:00' },
      },
    };
    const initial = await update(ROLES.SUPERADMIN, defaults);
    assert.equal(initial.body.changed, false);
    assert.equal(await repository.findPrimary(), null);
    assert.equal(broadcasts.length, 0);

    await update(ROLES.SUPERADMIN, changedSchedule);
    const repeated = await update(ROLES.SUPERADMIN, changedSchedule);
    assert.equal(repeated.body.changed, false);
    assert.equal(repeated.body.data.revision, 1);
    assert.equal((await repository.findPrimary()).changes.length, 1);
    assert.equal(broadcasts.length, 1);
  });

  test('a real change broadcasts one complete safe schedule', async () => {
    const response = await update(ROLES.SUPERADMIN, changedSchedule);
    assert.equal(response.status, 200);
    assert.equal(broadcasts.length, 1);
    assert.deepEqual(Object.keys(broadcasts[0]).sort(), ['reminders', 'revision', 'updatedAt']);
    assert.deepEqual(broadcasts[0].reminders, changedSchedule.reminders);
  });

  test('schema has a unique immutable singleton key and strict fields', async () => {
    const indexes = ReminderSettings.schema.indexes();
    assert.ok(indexes.some(([fields, options]) => fields.key === 1 && options.unique === true));
    assert.equal(ReminderSettings.schema.path('key').options.immutable, true);
    assert.throws(() => new ReminderSettings({
      key: 'primary',
      reminders: changedSchedule.reminders,
      unexpected: true,
    }), /strict/i);
  });
});

describe('health, readiness, and response hardening', () => {
  test('liveness is lightweight while readiness reflects database availability', async () => {
    const readyApp = createApp({ health: createHealthRouter({ readiness: async () => true }) });
    const unavailableApp = createApp({ health: createHealthRouter({ readiness: async () => false }) });
    await request(readyApp).get('/api/health').expect(200);
    assert.equal((await request(readyApp).get('/api/ready').expect(200)).body.status, 'ready');
    const unavailable = await request(unavailableApp).get('/api/ready').expect(503);
    assert.deepEqual(unavailable.body, { success: false, status: 'unavailable' });
  });

  test('API responses are no-store and carry hardened browser headers', async () => {
    const response = await request(testApp).get('/api/health').expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['content-security-policy'], /default-src 'self'/);
    assert.doesNotMatch(response.headers['content-security-policy'], /unsafe-eval|script-src \*/);
    assert.equal(response.headers['permissions-policy'], 'camera=(), geolocation=(), microphone=()');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-powered-by'], undefined);
  });

  test('production Helmet options enable HSTS without broad script or connect sources', () => {
    const options = createHelmetOptions({ production: true });
    assert.equal(options.strictTransportSecurity.maxAge, 31_536_000);
    assert.deepEqual(options.contentSecurityPolicy.directives.scriptSrc, ["'self'"]);
    assert.deepEqual(options.contentSecurityPolicy.directives.connectSrc, ["'self'"]);
    assert.deepEqual(options.contentSecurityPolicy.directives.upgradeInsecureRequests, []);
  });

  test('production proxy and generic API limits remain intentionally bounded', () => {
    assert.equal(PRODUCTION_TRUST_PROXY_HOPS, 1);
    assert.equal(API_RATE_LIMIT.windowMs, 15 * 60 * 1_000);
    assert.equal(API_RATE_LIMIT.productionLimit, 300);
    assert.equal(API_RATE_LIMIT.developmentLimit, 1_000);
  });
});
