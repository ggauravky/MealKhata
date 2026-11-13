import bcrypt from 'bcryptjs';
import { studentResolver } from '../students/studentResolver.service.js';
import { HttpError } from '../utils/HttpError.js';
import { ROLES } from './permissions.js';
import { userAccountRepository } from './userAccount.repository.js';

export const DUMMY_PASSWORD_HASH = '$2b$12$l0S7RDy0wYtH6EosWHIG/OuYdTzp5PToO/zJ8awk/kPeA9UmsI9AS';

/** Database-backed credential verification; there are no environment or legacy fallbacks. */
export function createAuthService({
  userAccounts = userAccountRepository,
  resolver = studentResolver,
} = {}) {
  return Object.freeze({
    async authenticateCredentials({ email, password }) {
      const normalizedEmail = email.trim().toLowerCase();

      let userAccount;
      try {
        userAccount = await userAccounts.findByEmail(normalizedEmail, { includePasswordHash: true });
      } catch (error) {
        throw new HttpError(503, 'Authentication service is temporarily unavailable.', { cause: error });
      }

      if (!userAccount || userAccount.active === false) {
        // Equalize timing for unknown and disabled accounts.
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

      let student = null;
      if (userAccount.role === ROLES.MEMBER) {
        try {
          student = await resolver.assertKnown(userAccount.memberId);
        } catch {
          throw new HttpError(401, 'Invalid email or password.');
        }
      }

      userAccounts.updateLastLogin(userAccount.userId).catch(() => {});

      return {
        authenticated: true,
        role: userAccount.role,
        memberId: userAccount.memberId ?? null,
        userId: userAccount.userId,
        displayName: student?.displayName ?? userAccount.displayName,
        sessionVersion: userAccount.sessionVersion ?? 0,
      };
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

