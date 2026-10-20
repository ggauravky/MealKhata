import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import { ROLES } from '../auth/permissions.js';
import { userAccountRepository } from '../auth/userAccount.repository.js';
import { env } from '../config/env.js';
import { MEMBER_IDS, MEMBER_NAMES } from '../config/members.js';
import { HttpError } from '../utils/HttpError.js';
import { memberAccountRepository } from '../auth/memberAccount.repository.js';
import { memberAccountAuditRepository } from './memberAccount.repository.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,256}$/;
const DUMMY_PASSWORD_HASH = '$2b$12$l0S7RDy0wYtH6EosWHIG/OuYdTzp5PToO/zJ8awk/kPeA9UmsI9AS';

function requireCanonicalMember(memberId) {
  if (!MEMBER_IDS.includes(memberId)) {
    throw new HttpError(404, 'Member not found.');
  }
}

function normalizeEmail(email) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new HttpError(400, 'A valid email address is required.');
  }
  return normalized;
}

function validateNewPassword(password) {
  if (typeof password !== 'string' || !STRONG_PASSWORD_PATTERN.test(password)) {
    throw new HttpError(
      400,
      'Password must be 12-256 characters and include uppercase, lowercase, number, and symbol.',
    );
  }
  return password;
}

function serializeAccount(account) {
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

function translatePersistenceError(error) {
  if (error?.code === 11000) {
    throw new HttpError(409, 'That email address is already assigned to another account.');
  }
  throw error;
}

async function runAtomically(operation) {
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

async function defaultVerifyActorPassword({ actor, password, accounts, config }) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 256) {
    throw new HttpError(401, 'Recent Super Admin authentication is required.');
  }

  let passwordHash = config.superAdminPasswordHash || DUMMY_PASSWORD_HASH;
  if (actor.userId) {
    const account = await accounts.findByUserId(actor.userId, { includePasswordHash: true });
    if (!account || account.role !== ROLES.SUPERADMIN || account.active === false) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw new HttpError(401, 'Recent Super Admin authentication is required.');
    }
    passwordHash = account.passwordHash || DUMMY_PASSWORD_HASH;
  }

  if (!await bcrypt.compare(password, passwordHash)) {
    throw new HttpError(401, 'Recent Super Admin authentication is required.');
  }
}

export function createMemberAccountService({
  accounts = userAccountRepository,
  legacyAccounts = memberAccountRepository,
  audits = memberAccountAuditRepository,
  config = env,
  now = () => new Date(),
  verifyActorPassword = null,
} = {}) {
  const reauthenticate = async ({ actor, currentPassword }) => {
    if (actor?.role !== ROLES.SUPERADMIN) {
      throw new HttpError(403, 'Only Super Admin can manage member accounts.');
    }
    if (verifyActorPassword) {
      await verifyActorPassword({ actor, password: currentPassword });
      return;
    }
    await defaultVerifyActorPassword({ actor, password: currentPassword, accounts, config });
  };

  const assertEmailAvailable = async (email, memberId, session = null) => {
    const [canonical, legacy] = await Promise.all([
      accounts.findByEmail(email, { session }),
      legacyAccounts.findByEmail(email),
    ]);
    if ((canonical && canonical.memberId !== memberId) || (legacy && legacy.memberId !== memberId)) {
      throw new HttpError(409, 'That email address is already assigned to another account.');
    }
  };

  const recordAudit = (event, memberId, actor, metadata, session) => audits.create({
    auditId: randomUUID(),
    memberId,
    event,
    actorUserId: actor.userId ?? null,
    actorRole: actor.role,
    occurredAt: now(),
    metadata,
  }, { session });

  return Object.freeze({
    async provisionAccount({ memberId, email, newPassword, currentPassword, actor }) {
      requireCanonicalMember(memberId);
      const normalizedEmail = normalizeEmail(email);
      validateNewPassword(newPassword);
      await reauthenticate({ actor, currentPassword });

      try {
        return await runAtomically(async (session) => {
          if (await accounts.findByMemberId(memberId, { session })) {
            throw new HttpError(409, 'This member already has a canonical account.');
          }
          await assertEmailAvailable(normalizedEmail, memberId, session);
          const passwordHash = await bcrypt.hash(newPassword, 12);
          const created = await accounts.createMemberAccount({
            userId: randomUUID(),
            memberId,
            displayName: MEMBER_NAMES[memberId],
            email: normalizedEmail,
            passwordHash,
            role: ROLES.MEMBER,
            active: true,
            sessionVersion: 0,
            passwordChangedAt: now(),
          }, { session });
          await recordAudit('MEMBER_ACCOUNT_PROVISIONED', memberId, actor, {
            email: normalizedEmail,
            active: true,
          }, session);
          return serializeAccount(created);
        });
      } catch (error) {
        return translatePersistenceError(error);
      }
    },

    async changeEmail({ memberId, email, currentPassword, actor }) {
      requireCanonicalMember(memberId);
      const normalizedEmail = normalizeEmail(email);
      await reauthenticate({ actor, currentPassword });

      try {
        return await runAtomically(async (session) => {
          const existing = await accounts.findByMemberId(memberId, { session });
          if (!existing) throw new HttpError(404, 'Member account has not been provisioned.');
          await assertEmailAvailable(normalizedEmail, memberId, session);
          const updated = await accounts.updateEmail(existing.userId, normalizedEmail, { session });
          await recordAudit('MEMBER_EMAIL_CHANGED', memberId, actor, {
            previousEmail: existing.email,
            email: normalizedEmail,
          }, session);
          return serializeAccount(updated);
        });
      } catch (error) {
        return translatePersistenceError(error);
      }
    },

    async resetPassword({ memberId, newPassword, currentPassword, actor }) {
      requireCanonicalMember(memberId);
      validateNewPassword(newPassword);
      await reauthenticate({ actor, currentPassword });

      try {
        return await runAtomically(async (session) => {
          const existing = await accounts.findByMemberId(memberId, { session });
          if (!existing) throw new HttpError(404, 'Member account has not been provisioned.');
          const changedAt = now();
          const passwordHash = await bcrypt.hash(newPassword, 12);
          const updated = await accounts.updatePassword(
            existing.userId,
            passwordHash,
            changedAt,
            { session },
          );
          await recordAudit('MEMBER_PASSWORD_RESET', memberId, actor, {
            passwordChangedAt: changedAt,
          }, session);
          return serializeAccount(updated);
        });
      } catch (error) {
        return translatePersistenceError(error);
      }
    },

    async setAccountActive({ memberId, active, currentPassword, actor }) {
      requireCanonicalMember(memberId);
      await reauthenticate({ actor, currentPassword });
      const targetActive = Boolean(active);

      return runAtomically(async (session) => {
        const existing = await accounts.findByMemberId(memberId, { session });
        if (!existing) throw new HttpError(404, 'Member account has not been provisioned.');
        const updated = await accounts.setActive(existing.userId, targetActive, { session });
        await recordAudit(
          targetActive ? 'MEMBER_ACCOUNT_ACTIVATED' : 'MEMBER_ACCOUNT_DEACTIVATED',
          memberId,
          actor,
          { previousActive: existing.active !== false, active: targetActive },
          session,
        );
        return serializeAccount(updated);
      });
    },

    async auditLegacyConflicts() {
      const [canonicalRows, legacyRows] = await Promise.all([
        accounts.listAll(),
        legacyAccounts.findAll(),
      ]);
      return legacyRows.map((legacy) => {
        const memberConflict = canonicalRows.find((account) => account.memberId === legacy.memberId);
        const emailConflict = canonicalRows.find((account) => account.email === legacy.email);
        return {
          memberId: legacy.memberId,
          legacyEmail: legacy.email,
          canonicalUserId: memberConflict?.userId ?? null,
          canonicalEmail: memberConflict?.email ?? null,
          emailOwnedByMemberId: emailConflict?.memberId ?? null,
          conflict: Boolean(memberConflict || emailConflict),
        };
      }).sort((a, b) => a.memberId.localeCompare(b.memberId));
    },
  });
}

export const memberAccountService = createMemberAccountService();
