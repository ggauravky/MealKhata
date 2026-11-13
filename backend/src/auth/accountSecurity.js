import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { HttpError } from '../utils/HttpError.js';
import { DUMMY_PASSWORD_HASH } from './auth.service.js';
import { ROLES } from './permissions.js';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const STRONG_PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,256}$/;

export function normalizeEmail(email) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new HttpError(400, 'A valid email address is required.');
  }
  return normalized;
}

export function validateNewPassword(password) {
  if (typeof password !== 'string' || !STRONG_PASSWORD_PATTERN.test(password)) {
    throw new HttpError(
      400,
      'Password must be 12-256 characters and include uppercase, lowercase, number, and symbol.',
    );
  }
  return password;
}

export function serializeAccount(account) {
  if (!account) return null;
  return {
    userId: account.userId,
    memberId: account.memberId,
    displayName: account.displayName,
    email: account.email,
    role: account.role,
    active: account.active !== false,
    sessionVersion: account.sessionVersion ?? 0,
    passwordChangedAt: account.passwordChangedAt ?? null,
    lastLoginAt: account.lastLoginAt ?? null,
    createdAt: account.createdAt ?? null,
    updatedAt: account.updatedAt ?? null,
  };
}

export function translatePersistenceError(error) {
  if (error?.code === 11000) {
    throw new HttpError(409, 'That email address is already assigned to another account.');
  }
  throw error;
}

export async function runAtomically(operation) {
  if (mongoose.connection?.readyState !== 1) {
    return operation(null);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Re-authenticates the acting account against its stored password hash. */
export async function verifyAccountPassword({ actor, password, accounts, requiredRole = null,
  message = 'Your current password is required to confirm this change.' }) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 256 || !actor?.userId) {
    await bcrypt.compare(typeof password === 'string' ? password.slice(0, 256) : '', DUMMY_PASSWORD_HASH);
    throw new HttpError(401, message);
  }
  const account = await accounts.findByUserId(actor.userId, { includePasswordHash: true });
  if (!account || account.active === false || (requiredRole && account.role !== requiredRole)) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    throw new HttpError(401, message);
  }
  if (!await bcrypt.compare(password, account.passwordHash || DUMMY_PASSWORD_HASH)) {
    throw new HttpError(401, message);
  }
  return account;
}

export function verifySuperAdminPassword({ actor, password, accounts }) {
  return verifyAccountPassword({ actor, password, accounts, requiredRole: ROLES.SUPERADMIN,
    message: 'Recent Super Admin authentication is required.' });
}
