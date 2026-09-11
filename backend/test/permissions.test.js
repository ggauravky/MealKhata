import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ROLES } from '../src/auth/permissions.js';
import { normalizeAppOrigin, validateEnvironment, env } from '../src/config/env.js';
import { authorizeLogicalDate } from '../src/middleware/dateAuthorization.js';
import { canEditDate, getLogicalDateInTimeZone, isValidLogicalDate } from '../src/utils/date.js';

const NOW = new Date('2026-09-09T12:00:00.000Z');

describe('logical date validation', () => {
  test('accepts canonical calendar dates and rejects malformed or impossible dates', () => {
    assert.equal(isValidLogicalDate('2026-09-09'), true);

    for (const value of [
      '2026-9-9',
      '2026/09/09',
      '09-09-2026',
      '2026-02-30',
      '2026-13-01',
      'abc',
    ]) {
      assert.equal(isValidLogicalDate(value), false, value);
    }
  });

  test('date middleware returns 400 before permission checks for invalid dates', () => {
    let statusCode;
    let payload;
    const req = { body: { date: '2026-02-30' }, auth: { role: ROLES.ADMIN } };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
    };

    authorizeLogicalDate()(req, res, () => assert.fail('next should not run'));
    assert.equal(statusCode, 400);
    assert.equal(payload.success, false);
  });
});

describe('role date permissions', () => {
  test('enforces Viewer, Admin, and Super Admin date rules', () => {
    const dates = {
      past: '2026-09-08',
      today: '2026-09-09',
      future: '2026-09-10',
    };

    for (const targetDate of Object.values(dates)) {
      assert.equal(canEditDate({ role: ROLES.VIEWER, targetDate, now: NOW }), false);
      assert.equal(canEditDate({ role: ROLES.SUPERADMIN, targetDate, now: NOW }), true);
    }

    assert.equal(canEditDate({ role: ROLES.ADMIN, targetDate: dates.past, now: NOW }), false);
    assert.equal(canEditDate({ role: ROLES.ADMIN, targetDate: dates.today, now: NOW }), true);
    assert.equal(canEditDate({ role: ROLES.ADMIN, targetDate: dates.future, now: NOW }), false);
  });

  test('uses the India date across the UTC midnight boundary', () => {
    const indiaMidnightScenario = new Date('2026-09-09T20:00:00.000Z');

    assert.equal(getLogicalDateInTimeZone(indiaMidnightScenario, 'Asia/Kolkata'), '2026-09-10');
    assert.equal(
      canEditDate({ role: ROLES.ADMIN, targetDate: '2026-09-09', now: indiaMidnightScenario }),
      false,
    );
    assert.equal(
      canEditDate({ role: ROLES.ADMIN, targetDate: '2026-09-10', now: indiaMidnightScenario }),
      true,
    );
    assert.equal(
      canEditDate({ role: ROLES.ADMIN, targetDate: '2026-09-11', now: indiaMidnightScenario }),
      false,
    );
  });
});

describe('environment validation', () => {
  test('normalizes whitespace and one conventional trailing slash from APP_ORIGIN', () => {
    assert.equal(
      normalizeAppOrigin('  https://meal-khata.onrender.com/  '),
      'https://meal-khata.onrender.com',
    );
    assert.equal(
      normalizeAppOrigin('https://meal-khata.onrender.com/path/'),
      'https://meal-khata.onrender.com/path',
    );
  });

  test('requires a sufficiently long JWT secret and distinct configured principals', () => {
    assert.throws(
      () => validateEnvironment({ ...env, authJwtSecret: 'too-short' }),
      /at least 32 bytes/,
    );
    assert.throws(
      () => validateEnvironment({ ...env, superAdminEmail: env.adminEmail }),
      /must be different/,
    );
    assert.doesNotThrow(() => validateEnvironment(env));
  });

  test('enforces production HTTPS, stronger secrets, fixed timezone, email, port, and MongoDB scheme', () => {
    const production = {
      ...env,
      nodeEnv: 'production',
      appOrigin: 'https://meal-khata.example',
    };

    assert.doesNotThrow(() => validateEnvironment(production));
    assert.throws(
      () => validateEnvironment({ ...production, appOrigin: 'http://meal-khata.example' }),
      /HTTPS in production/,
    );
    assert.throws(
      () => validateEnvironment({ ...production, authJwtSecret: 'x'.repeat(47) }),
      /at least 48 bytes/,
    );
    assert.throws(
      () => validateEnvironment({ ...production, appTimezone: 'UTC' }),
      /must remain Asia\/Kolkata/,
    );
    assert.throws(
      () => validateEnvironment({ ...production, adminEmail: 'not-an-email' }),
      /valid email addresses/,
    );
    assert.throws(
      () => validateEnvironment({ ...production, port: 0 }),
      /PORT/,
    );
    assert.throws(
      () => validateEnvironment({ ...production, mongoUri: 'https://database.example' }),
      /MONGODB_URI/,
    );
  });
});
