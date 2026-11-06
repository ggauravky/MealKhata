import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { studentResolver } from '../students/studentResolver.service.js';
import { ROLES, isAuthenticatedRole } from './permissions.js';
import { userAccountRepository } from './userAccount.repository.js';

const ISSUER = 'meal-khata';
const AUDIENCE = 'meal-khata-socket';
const DURATION_SECONDS = 60;

function key(secret) { return new TextEncoder().encode(secret); }

export async function createSocketTicket(auth, { secret = env.authJwtSecret } = {}) {
  if (!auth?.authenticated || !isAuthenticatedRole(auth.role)
    || typeof auth.userId !== 'string' || !auth.userId
    || !Number.isSafeInteger(auth.sessionVersion) || auth.sessionVersion < 0) {
    throw new Error('A canonical account session is required for a socket ticket');
  }
  return new SignJWT({ purpose: 'socket', role: auth.role,
    memberId: auth.memberId ?? null, sessionVersion: auth.sessionVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(auth.userId).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime(`${DURATION_SECONDS}s`).sign(key(secret));
}

export async function verifySocketTicket(ticket, { secret = env.authJwtSecret,
  accounts = userAccountRepository, resolver = studentResolver } = {}) {
  try {
    if (typeof ticket !== 'string' || ticket.length > 2_048) throw new Error('Invalid ticket');
    const { payload } = await jwtVerify(ticket, key(secret), {
      algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
      maxTokenAge: `${DURATION_SECONDS}s`,
    });
    if (payload.purpose !== 'socket' || !isAuthenticatedRole(payload.role)
      || typeof payload.sub !== 'string' || !payload.sub
      || !Number.isSafeInteger(payload.sessionVersion) || payload.sessionVersion < 0) {
      throw new Error('Invalid claims');
    }
    const account = await accounts.findByUserId(payload.sub);
    if (!account || account.active !== true || account.userId !== payload.sub
      || account.role !== payload.role || account.sessionVersion !== payload.sessionVersion
      || (account.memberId ?? null) !== payload.memberId) throw new Error('Revoked account');
    if (account.role === ROLES.MEMBER) await resolver.assertKnown(account.memberId);
    return { userId: account.userId, role: account.role, memberId: account.memberId ?? null,
      sessionVersion: account.sessionVersion };
  } catch {
    throw new Error('Invalid socket ticket');
  }
}

export async function verifyActiveSocketIdentity(identity, { accounts = userAccountRepository } = {}) {
  try {
    const account = await accounts.findByUserId(identity?.userId);
    return Boolean(account?.active === true && account.userId === identity.userId
      && account.role === identity.role && account.sessionVersion === identity.sessionVersion
      && (account.memberId ?? null) === (identity.memberId ?? null));
  } catch { return false; }
}
