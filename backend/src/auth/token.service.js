import { SignJWT, jwtVerify } from 'jose';
import { env, isProduction } from '../config/env.js';
import { MEMBER_IDS } from '../config/members.js';
import { ROLES, getPrincipalForRole, isAuthenticatedRole } from './permissions.js';

export const SESSION_COOKIE_NAME = 'mk_session';
export const SESSION_DURATION_SECONDS = 12 * 60 * 60;

const ALGORITHM = 'HS256';
const ISSUER = 'meal-khata';
const AUDIENCE = 'meal-khata-web';

function getSecretKey() {
  return new TextEncoder().encode(env.authJwtSecret);
}

export function getSessionCookieOptions({ production = isProduction } = {}) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS * 1_000,
  };
}

export function getClearSessionCookieOptions({ production = isProduction } = {}) {
  const { maxAge, ...options } = getSessionCookieOptions({ production });
  void maxAge;
  return options;
}

export async function createSessionToken(
  role,
  { memberId = null, expiresIn = `${SESSION_DURATION_SECONDS}s` } = {},
) {
  if (role === ROLES.MEMBER && (!memberId || !MEMBER_IDS.includes(memberId))) {
    throw new Error('A valid memberId is required to create a member session');
  }

  const principal = getPrincipalForRole(role, memberId);

  if (!principal) {
    throw new Error('Cannot create a session for an unsupported role');
  }

  const payload = { role };
  if (role === ROLES.MEMBER) {
    payload.memberId = memberId;
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(principal)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(expiresIn)
    .sign(getSecretKey());
}

export async function verifySessionToken(token) {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  if (!isAuthenticatedRole(payload.role)) {
    throw new Error('Unsupported session role');
  }

  if (payload.role === ROLES.MEMBER) {
    const memberId = payload.memberId;
    if (typeof memberId !== 'string' || !MEMBER_IDS.includes(memberId)) {
      throw new Error('Session memberId is invalid');
    }

    const expectedPrincipal = getPrincipalForRole(ROLES.MEMBER, memberId);
    if (payload.sub !== expectedPrincipal) {
      throw new Error('Session principal does not match member');
    }

    return {
      authenticated: true,
      role: ROLES.MEMBER,
      memberId,
      principal: expectedPrincipal,
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
  };
}

