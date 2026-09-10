import { SignJWT, jwtVerify } from 'jose';
import { env, isProduction } from '../config/env.js';
import { getPrincipalForRole, isAuthenticatedRole } from './permissions.js';

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

export async function createSessionToken(role, { expiresIn = `${SESSION_DURATION_SECONDS}s` } = {}) {
  const principal = getPrincipalForRole(role);

  if (!principal) {
    throw new Error('Cannot create a session for an unsupported role');
  }

  return new SignJWT({ role })
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

  const principal = getPrincipalForRole(payload.role);

  if (payload.sub !== principal) {
    throw new Error('Session principal does not match role');
  }

  return {
    authenticated: true,
    role: payload.role,
    principal,
  };
}
