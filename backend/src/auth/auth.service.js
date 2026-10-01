import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { MEMBER_NAMES } from '../config/members.js';
import { HttpError } from '../utils/HttpError.js';
import { ROLES } from './permissions.js';
import { memberAccountRepository } from './memberAccount.repository.js';
import { userAccountRepository } from './userAccount.repository.js';

const DUMMY_PASSWORD_HASH = '$2b$12$l0S7RDy0wYtH6EosWHIG/OuYdTzp5PToO/zJ8awk/kPeA9UmsI9AS';

export function createAuthService({
  userAccounts = userAccountRepository,
  accounts = memberAccountRepository,
  config = env,
} = {}) {
  const getPrincipals = () => Object.freeze([
    Object.freeze({
      email: config.adminEmail,
      passwordHash: config.adminPasswordHash,
      role: ROLES.ADMIN,
      memberId: null,
      displayName: 'Household Admin',
    }),
    Object.freeze({
      email: config.superAdminEmail,
      passwordHash: config.superAdminPasswordHash,
      role: ROLES.SUPERADMIN,
      memberId: null,
      displayName: 'Super Admin',
    }),
  ]);

  return Object.freeze({
    async authenticateCredentials({ email, password }) {
      const normalizedEmail = email.trim().toLowerCase();

      // 1. Primary: Look up in user_accounts database collection
      let userAccount = null;
      try {
        if (userAccounts) {
          userAccount = await userAccounts.findByEmail(normalizedEmail, { includePasswordHash: true });
        }
      } catch (error) {
        throw new HttpError(503, 'Authentication service is temporarily unavailable.', { cause: error });
      }

      if (userAccount) {
        if (userAccount.active === false) {
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
          throw new HttpError(401, 'Invalid email or password.');
        }

        const passwordMatches = await bcrypt.compare(
          password,
          userAccount.passwordHash || DUMMY_PASSWORD_HASH,
        );

        if (!passwordMatches) {
          throw new HttpError(401, 'Invalid email or password.');
        }

        // Record last login timestamp asynchronously
        userAccounts.updateLastLogin(userAccount.userId).catch(() => {});

        return {
          authenticated: true,
          role: userAccount.role,
          memberId: userAccount.memberId ?? null,
          userId: userAccount.userId,
          displayName: userAccount.displayName,
          sessionVersion: userAccount.sessionVersion ?? 0,
        };
      }

      // 2. Fallback: Legacy member_accounts collection (pre-migration / test mocks)
      let legacyMemberAccount = null;
      try {
        if (accounts) {
          legacyMemberAccount = await accounts.findByEmail(normalizedEmail);
        }
      } catch (error) {
        throw new HttpError(503, 'Authentication service is temporarily unavailable.', { cause: error });
      }

      if (legacyMemberAccount && legacyMemberAccount.active !== false) {
        const passwordMatches = await bcrypt.compare(
          password,
          legacyMemberAccount.passwordHash || DUMMY_PASSWORD_HASH,
        );

        if (!passwordMatches) {
          throw new HttpError(401, 'Invalid email or password.');
        }

        return {
          authenticated: true,
          role: ROLES.MEMBER,
          memberId: legacyMemberAccount.memberId,
          userId: null,
          displayName: MEMBER_NAMES[legacyMemberAccount.memberId] || legacyMemberAccount.memberId,
          sessionVersion: 0,
        };
      }

      // 3. Fallback: Environment principals (for testing without DB or before migration)
      const adminPrincipal = getPrincipals().find((candidate) => candidate.email === normalizedEmail);
      if (adminPrincipal && adminPrincipal.passwordHash) {
        const passwordMatches = await bcrypt.compare(
          password,
          adminPrincipal.passwordHash || DUMMY_PASSWORD_HASH,
        );

        if (!passwordMatches) {
          throw new HttpError(401, 'Invalid email or password.');
        }

        return {
          authenticated: true,
          role: adminPrincipal.role,
          memberId: null,
          userId: null,
          displayName: adminPrincipal.displayName,
          sessionVersion: 0,
        };
      }

      // Mitigate timing attack for non-existent account
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw new HttpError(401, 'Invalid email or password.');
    },
  });
}

export function validateLoginInput(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    throw new HttpError(400, 'Email and password are required.');
  }

  const { email, password } = body;

  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    email.trim().length === 0 ||
    password.length === 0 ||
    email.length > 254 ||
    password.length > 256
  ) {
    throw new HttpError(400, 'Email and password are required.');
  }

  return {
    email: email.trim().toLowerCase(),
    password,
  };
}

export const authService = createAuthService();

export async function authenticateCredentials(credentials) {
  return authService.authenticateCredentials(credentials);
}

