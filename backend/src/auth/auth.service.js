import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { HttpError } from '../utils/HttpError.js';
import { ROLES } from './permissions.js';

const DUMMY_PASSWORD_HASH = '$2b$12$l0S7RDy0wYtH6EosWHIG/OuYdTzp5PToO/zJ8awk/kPeA9UmsI9AS';

const principals = Object.freeze([
  Object.freeze({
    email: env.adminEmail,
    passwordHash: env.adminPasswordHash,
    role: ROLES.ADMIN,
  }),
  Object.freeze({
    email: env.superAdminEmail,
    passwordHash: env.superAdminPasswordHash,
    role: ROLES.SUPERADMIN,
  }),
]);

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

export async function authenticateCredentials({ email, password }) {
  const principal = principals.find((candidate) => candidate.email === email);
  const passwordMatches = await bcrypt.compare(
    password,
    principal?.passwordHash || DUMMY_PASSWORD_HASH,
  );

  if (!principal || !passwordMatches) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  return {
    authenticated: true,
    role: principal.role,
  };
}
