import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';
import { SignJWT } from 'jose';
import request from 'supertest';
import { app } from '../src/app.js';
import { validateLoginInput } from '../src/auth/auth.service.js';
import { ROLES } from '../src/auth/permissions.js';
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '../src/auth/token.service.js';
import { authenticateSession } from '../src/middleware/authenticate.js';
import { requireAuthenticated, requireSuperAdmin } from '../src/middleware/authorize.js';
import { LOGIN_RATE_LIMIT } from '../src/middleware/rateLimiters.js';
import { TEST_CREDENTIALS } from './setup-env.js';
import { env } from '../src/config/env.js';

const APP_ORIGIN = 'http://localhost:5173';

function postLogin(credentials, origin = APP_ORIGIN) {
  return request(app).post('/api/auth/login').set('Origin', origin).send(credentials);
}

function createAuthorizationTestApp() {
  const testApp = express();
  testApp.use(cookieParser());
  testApp.use(authenticateSession);
  testApp.get('/authenticated', requireAuthenticated, (req, res) => res.json({ role: req.auth.role }));
  testApp.get('/superadmin', requireSuperAdmin, (req, res) => res.json({ role: req.auth.role }));
  return testApp;
}

describe('authentication API', () => {
  test('unknown email and incorrect Admin password use the same 401 response', async () => {
    const unknown = await postLogin({ email: 'unknown@example.com', password: 'anything' });
    const incorrect = await postLogin({
      email: TEST_CREDENTIALS.admin.email,
      password: 'incorrect password',
    });

    assert.equal(unknown.status, 401);
    assert.equal(incorrect.status, 401);
    assert.deepEqual(unknown.body, incorrect.body);
    assert.equal(unknown.body.message, 'Invalid email or password.');
  });

  test('rejects invalid input before bcrypt comparison', async () => {
    for (const body of [
      {},
      { email: [], password: 'password' },
      { email: TEST_CREDENTIALS.admin.email, password: {} },
      { email: '', password: '' },
      { email: 'a'.repeat(255), password: 'password' },
      { email: TEST_CREDENTIALS.admin.email, password: 'p'.repeat(257) },
    ]) {
      assert.throws(() => validateLoginInput(body));
    }
  });

  test('Admin login sets a protected cookie and returns only safe session data', async () => {
    const response = await postLogin(TEST_CREDENTIALS.admin);
    const responseText = JSON.stringify(response.body);
    const cookie = response.headers['set-cookie']?.[0] ?? '';

    assert.equal(response.status, 200);
    assert.equal(response.body.session.role, ROLES.ADMIN);
    assert.equal(response.body.session.capabilities.canEditToday, true);
    assert.equal(response.body.session.capabilities.canEditPast, false);
    assert.equal('token' in response.body, false);
    assert.doesNotMatch(responseText, /password|hash|jwt/i);
    assert.match(cookie, /^mk_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Max-Age=604800/i);
  });

  test('Super Admin login returns the server-determined role and full date capabilities', async () => {
    const response = await postLogin(TEST_CREDENTIALS.superadmin);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.session.capabilities, {
      canEditToday: true,
      canEditPast: true,
      canEditFuture: true,
    });
    assert.equal(response.body.session.role, ROLES.SUPERADMIN);
  });

  test('production session cookie configuration is Secure and HttpOnly with 7-day Admin policy', () => {
    const adminOptions = getSessionCookieOptions({ production: true, role: ROLES.ADMIN });
    assert.equal(adminOptions.secure, true);
    assert.equal(adminOptions.httpOnly, true);
    assert.equal(adminOptions.sameSite, 'lax');
    assert.equal(adminOptions.path, '/');
    assert.equal(adminOptions.maxAge, 604_800_000);

    const memberOptions = getSessionCookieOptions({ production: true, role: ROLES.MEMBER });
    assert.equal(memberOptions.maxAge, 43_200_000);
  });

  test('session endpoint restores viewer, Admin, and Super Admin states', async () => {
    const viewer = await request(app).get('/api/auth/session');
    assert.deepEqual(viewer.body.session, { authenticated: false, role: ROLES.VIEWER });

    for (const [credentials, expectedRole] of [
      [TEST_CREDENTIALS.admin, ROLES.ADMIN],
      [TEST_CREDENTIALS.superadmin, ROLES.SUPERADMIN],
    ]) {
      const agent = request.agent(app);
      await agent.post('/api/auth/login').set('Origin', APP_ORIGIN).send(credentials).expect(200);
      const session = await agent.get('/api/auth/session').expect(200);
      assert.equal(session.body.session.authenticated, true);
      assert.equal(session.body.session.role, expectedRole);
    }
  });

  test('invalid and expired JWTs safely restore the viewer session', async () => {
    const invalid = await request(app)
      .get('/api/auth/session')
      .set('Cookie', `${SESSION_COOKIE_NAME}=not-a-valid-jwt`);
    assert.equal(invalid.status, 200);
    assert.equal(invalid.body.session.role, ROLES.VIEWER);

    const expiredToken = await createSessionToken(ROLES.ADMIN, { expiresIn: '-1s' });
    const expired = await request(app)
      .get('/api/auth/session')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${expiredToken}`);
    assert.equal(expired.status, 200);
    assert.equal(expired.body.session.authenticated, false);

    const invalidRoleToken = await new SignJWT({ role: 'owner' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('meal-khata-owner')
      .setIssuedAt()
      .setIssuer('meal-khata')
      .setAudience('meal-khata-web')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(env.authJwtSecret));
    const invalidRole = await request(app)
      .get('/api/auth/session')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${invalidRoleToken}`);
    assert.equal(invalidRole.status, 200);
    assert.equal(invalidRole.body.session.role, ROLES.VIEWER);
  });

  test('logout clears the cookie and is idempotent', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('Origin', APP_ORIGIN)
      .send(TEST_CREDENTIALS.admin)
      .expect(200);

    const logout = await agent.post('/api/auth/logout').set('Origin', APP_ORIGIN).expect(200);
    const clearedCookie = logout.headers['set-cookie']?.[0] ?? '';
    assert.match(clearedCookie, /^mk_session=;/);
    assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970/i);

    const session = await agent.get('/api/auth/session').expect(200);
    assert.equal(session.body.session.role, ROLES.VIEWER);

    await request(app).post('/api/auth/logout').set('Origin', APP_ORIGIN).expect(200);
  });
});

describe('authentication authorization', () => {
  test('uses 401 for viewers, 403 for insufficient roles, and allows Super Admin', async () => {
    const testApp = createAuthorizationTestApp();
    await request(testApp).get('/authenticated').expect(401);

    const adminToken = await createSessionToken(ROLES.ADMIN);
    await request(testApp)
      .get('/superadmin')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${adminToken}`)
      .expect(403);

    const superAdminToken = await createSessionToken(ROLES.SUPERADMIN);
    const allowed = await request(testApp)
      .get('/superadmin')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${superAdminToken}`)
      .expect(200);
    assert.equal(allowed.body.role, ROLES.SUPERADMIN);
  });
});

describe('origin and rate-limit security', () => {
  test('allows the configured Origin and rejects foreign or absent origins for mutations', async () => {
    await request(app).post('/api/auth/logout').set('Origin', APP_ORIGIN).expect(200);
    await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example').expect(403);
    await request(app).post('/api/auth/logout').expect(403);
  });

  test('does not block safe GET requests based on Origin', async () => {
    await request(app)
      .get('/api/auth/session')
      .set('Origin', 'https://evil.example')
      .expect(200);
  });

  test('login limiter is configured for ten attempts per fifteen minutes', async () => {
    assert.equal(LOGIN_RATE_LIMIT.limit, 10);
    assert.equal(LOGIN_RATE_LIMIT.windowMs, 15 * 60 * 1_000);

    const response = await postLogin(TEST_CREDENTIALS.admin);
    assert.ok(response.headers['ratelimit-policy']);
  });
});
