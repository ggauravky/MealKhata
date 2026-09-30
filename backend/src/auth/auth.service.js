import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { HttpError } from '../utils/HttpError.js';
import { ROLES } from './permissions.js';
import { memberAccountRepository } from './memberAccount.repository.js';

const DUMMY_PASSWORD_HASH = '$2b$12$l0S7RDy0wYtH6EosWHIG/OuYdTzp5PToO/zJ8awk/kPeA9UmsI9AS';

export function createAuthService({
  accounts = memberAccountRepository,
  config = env,
} = {}) {
  const getPrincipals = () => Object.freeze([
    Object.freeze({
      email: config.adminEmail,
      passwordHash: config.adminPasswordHash,
      role: ROLES.ADMIN,
      memberId: null,
    }),
    Object.freeze({
      email: config.superAdminEmail,
      passwordHash: config.superAdminPasswordHash,
      role: ROLES.SUPERADMIN,
      memberId: null,
    }),
  ]);

  return Object.freeze({
    async authenticateCredentials({ email, password }) {
      const normalizedEmail = email.trim().toLowerCase();
      const adminPrincipal = getPrincipals().find((candidate) => candidate.email === normalizedEmail);

      if (adminPrincipal) {
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
        };
      }

      let memberAccount;
      try {
        memberAccount = await accounts.findByEmail(normalizedEmail);
      } catch (error) {
        throw new HttpError(503, 'Authentication service is temporarily unavailable.', { cause: error });
      }

      if (memberAccount && memberAccount.active !== false) {
        const passwordMatches = await bcrypt.compare(
          password,
          memberAccount.passwordHash || DUMMY_PASSWORD_HASH,
        );

        if (!passwordMatches) {
          throw new HttpError(401, 'Invalid email or password.');
        }

        return {
          authenticated: true,
          role: ROLES.MEMBER,
          memberId: memberAccount.memberId,
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

