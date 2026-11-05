import { SignJWT, jwtVerify } from 'jose';
import { env, isProduction } from '../config/env.js';
import { assertSafeStudentId } from '../students/studentId.js';
import { studentResolver } from '../students/studentResolver.service.js';
import { ROLES, getPrincipalForRole, isAuthenticatedRole } from './permissions.js';
import { userAccountRepository } from './userAccount.repository.js';

export const SESSION_COOKIE_NAME = 'mk_session';

export const MEMBER_SESSION_DURATION_SECONDS = 12 * 60 * 60; // 12 hours = 43,200 seconds
export const ADMIN_SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60; // 7 days = 604,800 seconds
export const SUPERADMIN_SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60; // 7 days = 604,800 seconds
export const DEFAULT_SESSION_DURATION_SECONDS = MEMBER_SESSION_DURATION_SECONDS;
export const SESSION_DURATION_SECONDS = ADMIN_SESSION_DURATION_SECONDS;

export const SESSION_DURATIONS = Object.freeze({
  [ROLES.MEMBER]: MEMBER_SESSION_DURATION_SECONDS,
  [ROLES.ADMIN]: ADMIN_SESSION_DURATION_SECONDS,
  [ROLES.SUPERADMIN]: SUPERADMIN_SESSION_DURATION_SECONDS,
});

export function getSessionDurationSeconds(role) {
  return SESSION_DURATIONS[role] ?? DEFAULT_SESSION_DURATION_SECONDS;
}

const ALGORITHM = 'HS256';
const ISSUER = 'meal-khata';
const AUDIENCE = 'meal-khata-web';

function getSecretKey() {
  return new TextEncoder().encode(env.authJwtSecret);
}

export async function decodeTokenClaims(token) {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return payload;
}

export function getSessionCookieOptions({
  production = isProduction,
  maxAgeSeconds = null,
  role = null,
} = {}) {
  const duration = maxAgeSeconds ?? (role ? getSessionDurationSeconds(role) : ADMIN_SESSION_DURATION_SECONDS);
  return {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
    maxAge: duration * 1_000,
  };
}

export function getClearSessionCookieOptions({ production = isProduction } = {}) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
  };
}

export async function createSessionToken(
  role,
  {
    memberId = null,
    userId = null,
    displayName = null,
    sessionVersion = 0,
    expiresIn = null,
  } = {},
) {
  if (role === ROLES.MEMBER) {
    try {
      assertSafeStudentId(memberId);
    } catch {
      throw new Error('A valid memberId is required to create a member session');
    }
  }

  const principal = getPrincipalForRole(role, memberId);

  if (!principal) {
    throw new Error('Cannot create a session for an unsupported role');
  }

  const payload = { role, sessionVersion };
  if (userId) {
    payload.userId = userId;
  }
  if (role === ROLES.MEMBER) {
    payload.memberId = memberId;
    if (typeof displayName === 'string' && displayName.trim()) {
      payload.displayName = displayName.trim().slice(0, 100);
    }
  }

  const durationSeconds = getSessionDurationSeconds(role);
  const expiration = expiresIn ?? `${durationSeconds}s`;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(principal)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(expiration)
    .sign(getSecretKey());
}

export async function verifySessionToken(
  token,
  { accounts = userAccountRepository, resolver = studentResolver, canonicalOnly = env.canonicalOnlyAuth } = {},
) {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  if (!isAuthenticatedRole(payload.role)) {
    throw new Error('Unsupported session role');
  }
  if (canonicalOnly && (!payload.userId || !accounts)) {
    throw new Error('Canonical session requires a userId and account repository');
  }
  if (canonicalOnly && (!Number.isSafeInteger(payload.sessionVersion) || payload.sessionVersion < 0)) {
    throw new Error('Canonical session requires a valid session version');
  }

  const expiresAt = typeof payload.exp === 'number'
    ? new Date(payload.exp * 1000).toISOString()
    : null;

  // If userId is in token and account repository is provided, verify against DB
  if (payload.userId && accounts) {
    const user = await accounts.findByUserId(payload.userId);
    if (!user) {
      throw new Error('User account not found');
    }
    if (user.active === false) {
      throw new Error('User account is inactive');
    }
    if (payload.role !== user.role || payload.memberId !== (user.memberId ?? undefined)) {
      throw new Error('Session identity does not match canonical account');
    }
    if (typeof payload.sessionVersion === 'number' && user.sessionVersion !== payload.sessionVersion) {
      throw new Error('Session has been revoked');
    }

    if (user.role === ROLES.MEMBER) {
      try {
        assertSafeStudentId(user.memberId);
      } catch {
        throw new Error('User account student identity is invalid');
      }
      await resolver.assertKnown(user.memberId);
    }

    const principal = getPrincipalForRole(user.role, user.memberId);
    if (!principal) {
      throw new Error('User account role is invalid');
    }
    if (payload.sub !== principal) throw new Error('Session principal does not match canonical account');
    return {
      authenticated: true,
      role: user.role,
      memberId: user.memberId,
      userId: user.userId,
      displayName: user.displayName,
      sessionVersion: user.sessionVersion,
      principal,
      expiresAt,
    };
  }

  // Fallback for tokens minted without userId (e.g. pure unit tests without DB)
  if (payload.role === ROLES.MEMBER) {
    const memberId = payload.memberId;
    try {
      assertSafeStudentId(memberId);
    } catch {
      throw new Error('Session memberId is invalid');
    }

    const expectedPrincipal = getPrincipalForRole(ROLES.MEMBER, memberId);
    if (payload.sub !== expectedPrincipal) {
      throw new Error('Session principal does not match member');
    }

    if (accounts && await accounts.findByMemberId(memberId)) {
      throw new Error('Legacy member session has been revoked');
    }

    return {
      authenticated: true,
      role: ROLES.MEMBER,
      memberId,
      displayName: typeof payload.displayName === 'string' && payload.displayName.trim()
        ? payload.displayName.trim().slice(0, 100)
        : memberId,
      principal: expectedPrincipal,
      expiresAt,
    };
  }

  const principal = getPrincipalForRole(payload.role);

  if (payload.sub !== principal) {
    throw new Error('Session principal does not match role');
  }

  return {
    authenticated: true,
    role: payload.role,
    memberId: null,
    principal,
    expiresAt,
  };
}

