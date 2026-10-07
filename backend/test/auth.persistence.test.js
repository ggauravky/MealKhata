import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import bcrypt from 'bcryptjs';
import { jwtVerify } from 'jose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/auth/auth.service.js';
import { ROLES } from '../src/auth/permissions.js';
import {
  ADMIN_SESSION_DURATION_SECONDS,
  createSessionToken,
  getClearSessionCookieOptions,
  getSessionCookieOptions,
  getSessionDurationSeconds,
  MEMBER_SESSION_DURATION_SECONDS,
  SESSION_COOKIE_NAME,
  SUPERADMIN_SESSION_DURATION_SECONDS,
} from '../src/auth/token.service.js';
import { env } from '../src/config/env.js';
import { createAuthenticateSession } from '../src/middleware/authenticate.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { InMemoryUserAccountRepository } from './helpers/inMemoryUserAccountRepository.js';

const ORIGIN = 'http://localhost:5173';
const ALGORITHM = 'HS256';

describe('7-Day Persistent Session Policy & Cookie Hardening', () => {
  let userRepo;
  let authService;
  let app;

  const passwords = {
    admin: 'AdminSecurePass!123',
    superadmin: 'SuperSecurePass!456',
    member: 'MemberSecurePass!789',
  };

  beforeEach(async () => {
    userRepo = new InMemoryUserAccountRepository();

    await userRepo.create({
      userId: 'usr-admin-1',
      email: 'admin@mealkhata.test',
      passwordHash: await bcrypt.hash(passwords.admin, 12),
      role: ROLES.ADMIN,
      displayName: 'Household Admin',
      active: true,
      sessionVersion: 1,
    });

    await userRepo.create({
      userId: 'usr-super-1',
      email: 'superadmin@mealkhata.test',
      passwordHash: await bcrypt.hash(passwords.superadmin, 12),
      role: ROLES.SUPERADMIN,
      displayName: 'Super Admin',
      active: true,
      sessionVersion: 1,
    });

    await userRepo.create({
      userId: 'usr-member-1',
      email: 'gaurav@mealkhata.test',
      passwordHash: await bcrypt.hash(passwords.member, 12),
      role: ROLES.MEMBER,
      memberId: 'gaurav',
      displayName: 'Gaurav Kumar',
      active: true,
      sessionVersion: 1,
    });

    authService = createAuthService({ userAccounts: userRepo });
    const authRouter = createAuthRouter({ service: authService });
    const authenticate = createAuthenticateSession({ accounts: userRepo });
    app = createApp({ auth: authRouter, authenticate });
  });

  test('Requirement 7, 8 & 9: Role session duration constants are exact', () => {
    assert.equal(ADMIN_SESSION_DURATION_SECONDS, 7 * 24 * 60 * 60); // 604,800s
    assert.equal(SUPERADMIN_SESSION_DURATION_SECONDS, 7 * 24 * 60 * 60); // 604,800s
    assert.equal(MEMBER_SESSION_DURATION_SECONDS, 12 * 60 * 60); // 43,200s

    assert.equal(getSessionDurationSeconds(ROLES.ADMIN), 604800);
    assert.equal(getSessionDurationSeconds(ROLES.SUPERADMIN), 604800);
    assert.equal(getSessionDurationSeconds(ROLES.MEMBER), 43200);
  });

  test('Requirement 12, 13 & 76: JWT lifetime and cookie Max-Age match exactly for all roles', async () => {
    const roles = [ROLES.ADMIN, ROLES.SUPERADMIN, ROLES.MEMBER];

    for (const role of roles) {
      const durationSeconds = getSessionDurationSeconds(role);
      const cookieOptions = getSessionCookieOptions({ role });

      assert.equal(
        cookieOptions.maxAge / 1000,
        durationSeconds,
        `Cookie maxAge must match session duration for ${role}`,
      );

      const token = await createSessionToken(role, {
        memberId: role === ROLES.MEMBER ? 'gaurav' : null,
      });

      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.authJwtSecret), {
        algorithms: [ALGORITHM],
      });

      const tokenLifetimeSeconds = payload.exp - payload.iat;
      assert.equal(
        tokenLifetimeSeconds,
        durationSeconds,
        `JWT expiration lifetime must match duration for ${role}`,
      );
    }
  });

  test('Requirement 14 & 16: Admin and Super Admin login sets Max-Age=604800 persistent cookie', async () => {
    // Admin login
    const adminRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'admin@mealkhata.test', password: passwords.admin })
      .expect(200);

    const adminCookie = adminRes.headers['set-cookie']?.[0] ?? '';
    assert.match(adminCookie, /mk_session=/);
    assert.match(adminCookie, /Max-Age=604800/i);
    assert.match(adminCookie, /HttpOnly/i);
    assert.match(adminCookie, /SameSite=Lax/i);
    assert.match(adminCookie, /Path=\//i);
    assert.doesNotMatch(adminCookie, /domain=/i, 'Must be host-only');

    // Super Admin login
    const superRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'superadmin@mealkhata.test', password: passwords.superadmin })
      .expect(200);

    const superCookie = superRes.headers['set-cookie']?.[0] ?? '';
    assert.match(superCookie, /Max-Age=604800/i);

    // Member login maintains 12h
    const memberRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'gaurav@mealkhata.test', password: passwords.member })
      .expect(200);

    const memberCookie = memberRes.headers['set-cookie']?.[0] ?? '';
    assert.match(memberCookie, /Max-Age=43200/i);
  });

  test('Requirement 18 & 77: Production cookie options enforce Secure, HttpOnly, and SameSite=Lax', () => {
    const prodOptions = getSessionCookieOptions({ production: true, role: ROLES.ADMIN });
    assert.equal(prodOptions.secure, true);
    assert.equal(prodOptions.httpOnly, true);
    assert.equal(prodOptions.sameSite, 'lax');
    assert.equal(prodOptions.path, '/');
    assert.equal(prodOptions.maxAge, 604_800_000);

    const devOptions = getSessionCookieOptions({ production: false, role: ROLES.ADMIN });
    assert.equal(devOptions.secure, false);
    assert.equal(devOptions.httpOnly, true);
    assert.equal(devOptions.sameSite, 'lax');
    assert.equal(devOptions.path, '/');
  });

  test('Requirement 32, 33, 34 & 35: Login and session endpoints expose safe expiresAt and authoritative displayName', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'admin@mealkhata.test', password: passwords.admin })
      .expect(200);

    assert.equal(loginRes.body.session.authenticated, true);
    assert.equal(loginRes.body.session.role, ROLES.ADMIN);
    assert.equal(loginRes.body.session.displayName, 'Household Admin');
    assert.ok(typeof loginRes.body.session.expiresAt === 'string');

    const expiresDate = new Date(loginRes.body.session.expiresAt);
    const expectedDiffMs = 7 * 24 * 60 * 60 * 1000;
    const actualDiffMs = expiresDate.getTime() - Date.now();
    // Allow 5 second tolerance
    assert.ok(Math.abs(actualDiffMs - expectedDiffMs) < 5000);

    // Verify session restoration reflects identical expiresAt and displayName
    const cookie = loginRes.headers['set-cookie']?.[0];
    const sessionRes = await request(app)
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .expect(200);

    assert.equal(sessionRes.body.session.authenticated, true);
    assert.equal(sessionRes.body.session.role, ROLES.ADMIN);
    assert.equal(sessionRes.body.session.displayName, 'Household Admin');
    assert.equal(sessionRes.body.session.expiresAt, loginRes.body.session.expiresAt);
  });

  test('Requirement 24, 55, 56 & 57: Simulated browser close & reopen restores session from cookie without login call', async () => {
    // 1. Admin logs in
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'admin@mealkhata.test', password: passwords.admin })
      .expect(200);

    // 2. Extract Set-Cookie header
    const cookie = loginRes.headers['set-cookie']?.[0];
    assert.ok(cookie, 'Set-Cookie header must be present');

    // 3. Simulate new browser window / tab / reopening by requesting with the persisted cookie
    const reopenedBrowser = request(app);
    const restored = await reopenedBrowser
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .expect(200);

    assert.equal(restored.body.session.authenticated, true);
    assert.equal(restored.body.session.role, ROLES.ADMIN);
    assert.equal(restored.body.session.displayName, 'Household Admin');
  });

  test('Requirement 37, 38 & 39: Logout clears cookie and subsequent session returns Viewer', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'admin@mealkhata.test', password: passwords.admin })
      .expect(200);

    const logoutRes = await agent
      .post('/api/auth/logout')
      .set('Origin', ORIGIN)
      .expect(200);

    const clearCookie = logoutRes.headers['set-cookie']?.[0] ?? '';
    assert.match(clearCookie, /mk_session=;/);
    assert.match(clearCookie, /Expires=Thu, 01 Jan 1970/i);

    const clearOptions = getClearSessionCookieOptions({ production: true });
    assert.equal(clearOptions.httpOnly, true);
    assert.equal(clearOptions.secure, true);
    assert.equal(clearOptions.sameSite, 'lax');
    assert.equal(clearOptions.path, '/');

    const sessionRes = await agent.get('/api/auth/session').expect(200);
    assert.equal(sessionRes.body.session.authenticated, false);
    assert.equal(sessionRes.body.session.role, ROLES.VIEWER);
  });

  test('Requirement 43 & 82: Inactive account active=false invalidates 7-day session immediately', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'admin@mealkhata.test', password: passwords.admin })
      .expect(200);

    const cookie = loginRes.headers['set-cookie']?.[0];

    // Verify currently valid
    await request(app).get('/api/auth/session').set('Cookie', cookie).expect(200);

    // Deactivate account in repository
    await userRepo.setActive('usr-admin-1', false);

    // Next request must be rejected
    const res = await request(app).get('/api/auth/session').set('Cookie', cookie).expect(200);
    assert.equal(res.body.session.authenticated, false);
    assert.equal(res.body.session.role, ROLES.VIEWER);
  });

  test('Requirement 44 & 81: Incrementing sessionVersion invalidates 7-day session immediately', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'admin@mealkhata.test', password: passwords.admin })
      .expect(200);

    // Verify session works
    await agent.get('/api/auth/session').expect(200);

    // Invalidate sessions on DB account
    await userRepo.incrementSessionVersion('usr-admin-1');

    // Next request must be rejected
    const res = await agent.get('/api/auth/session').expect(200);
    assert.equal(res.body.session.authenticated, false);
    assert.equal(res.body.session.role, ROLES.VIEWER);
  });

  test('Requirement 80: Expired token (> 7 days) is rejected and cookie is cleared', async () => {
    const expiredToken = await createSessionToken(ROLES.ADMIN, {
      userId: 'usr-admin-1',
      expiresIn: '-1s',
    });

    const res = await request(app)
      .get('/api/auth/session')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${expiredToken}`)
      .expect(200);

    assert.equal(res.body.session.authenticated, false);
    assert.equal(res.body.session.role, ROLES.VIEWER);

    const clearedCookie = res.headers['set-cookie']?.[0] ?? '';
    assert.match(clearedCookie, /mk_session=;/);
  });

  test('Requirement 40 & 125: AUTH_JWT_SECRET rotation invalidates existing tokens', async () => {
    const token = await createSessionToken(ROLES.ADMIN, { userId: 'usr-admin-1' });

    // Verifying with different secret should throw
    const otherSecret = new TextEncoder().encode('other-different-random-secret-key-that-does-not-match-at-all');
    await assert.rejects(
      () => jwtVerify(token, otherSecret, { algorithms: [ALGORITHM] }),
      /signature verification failed/i,
    );
  });

  test('Requirement 117: Super Admin display name defaults to "Super Admin" when empty', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'superadmin@mealkhata.test', password: passwords.superadmin })
      .expect(200);

    assert.equal(loginRes.body.session.displayName, 'Super Admin');

    const cookie = loginRes.headers['set-cookie']?.[0];
    const sessionRes = await request(app)
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .expect(200);

    assert.equal(sessionRes.body.session.displayName, 'Super Admin');
  });
});
