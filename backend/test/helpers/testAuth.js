import { createApp } from '../../src/app.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../../src/auth/token.service.js';
import { createAuthenticateSession } from '../../src/middleware/authenticate.js';
import { InMemoryUserAccountRepository } from './inMemoryUserAccountRepository.js';

/**
 * Test-only authentication fixtures. Sessions are always canonical: every token is backed
 * by an account in this in-memory repository, exactly as production sessions are backed
 * by `user_accounts`.
 */
export const testAccounts = new InMemoryUserAccountRepository();

export const permissiveStudentResolver = Object.freeze({
  async assertKnown(studentId) { return { studentId, displayName: studentId }; },
  async listAll() { return []; },
  async listCurrent() { return []; },
  async listEligibleOn() { return []; },
});

export const testAuthenticate = createAuthenticateSession({
  accounts: testAccounts,
  resolver: permissiveStudentResolver,
});

export const openInitializationGate = (_req, _res, next) => next();

async function ensureAccount(role, { memberId: requestedMemberId = null, displayName = null } = {}) {
  // Only member accounts are linked to a student, exactly as in user_accounts.
  const memberId = role === 'member' ? requestedMemberId : null;
  const userId = `test-${role}-${memberId ?? 'staff'}`;
  const existing = await testAccounts.findByUserId(userId);
  if (existing) return existing;
  return testAccounts.create({
    userId,
    email: `${role}.${memberId ?? 'staff'}@mealkhata.test`,
    passwordHash: null,
    role,
    memberId,
    displayName: displayName ?? memberId ?? role,
    active: true,
    sessionVersion: 0,
  });
}

/** Mints a canonical session token for a role, creating its backing account on demand. */
export async function testSessionToken(role, { memberId = null, displayName = null, expiresIn } = {}) {
  const account = await ensureAccount(role, { memberId, displayName });
  return createSessionToken(role, {
    memberId: account.memberId,
    displayName,
    userId: account.userId,
    sessionVersion: account.sessionVersion ?? 0,
    ...(expiresIn ? { expiresIn } : {}),
  });
}

export async function testSessionCookie(role, options) {
  return `${SESSION_COOKIE_NAME}=${await testSessionToken(role, options)}`;
}

/** createApp with test authentication and an open initialization gate. */
export function createTestApp(options = {}) {
  return createApp({ authenticate: testAuthenticate, gate: openInitializationGate, ...options });
}
