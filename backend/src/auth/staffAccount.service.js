import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { HttpError } from '../utils/HttpError.js';
import {
  normalizeEmail,
  runAtomically,
  serializeAccount,
  translatePersistenceError,
  validateNewPassword,
  verifyAccountPassword,
  verifySuperAdminPassword,
} from './accountSecurity.js';
import { AccountAuditEvent, ACCOUNT_AUDIT_EVENTS } from './accountAuditEvent.model.js';
import { ROLES } from './permissions.js';
import { userAccountRepository } from './userAccount.repository.js';

const STAFF_ROLES = [ROLES.ADMIN, ROLES.SUPERADMIN];

function normalizeDisplayName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 100) throw new HttpError(400, 'Display name must be 1-100 characters.');
  return name;
}

export function createAccountAuditRepository({ model = AccountAuditEvent } = {}) {
  return Object.freeze({
    async create(document, { session = null } = {}) {
      if (mongoose.connection?.readyState !== 1 && model === AccountAuditEvent) return document;
      const [created] = await model.create([document], session ? { session } : {});
      return created.toObject();
    },
    async listRecent(limit = 50) {
      if (mongoose.connection?.readyState !== 1 && model === AccountAuditEvent) return [];
      return model.find({}, { _id: 0 }).sort({ occurredAt: -1 }).limit(limit).lean();
    },
  });
}

export const accountAuditRepository = createAccountAuditRepository();

function serializeAudit(event) {
  return {
    auditId: event.auditId,
    event: event.event,
    targetUserId: event.targetUserId ?? null,
    actorUserId: event.actorUserId ?? null,
    actorRole: event.actorRole,
    occurredAt: new Date(event.occurredAt).toISOString(),
    metadata: event.metadata ?? {},
  };
}

/**
 * Super Admin management of administrator accounts plus self-service password change.
 * Every privileged change requires the actor's current password, revokes the target's
 * sessions (sessionVersion) and is written to the append-only audit collection.
 */
export function createStaffAccountService({
  accounts = userAccountRepository,
  audits = accountAuditRepository,
  now = () => new Date(),
} = {}) {
  const recordAudit = (event, actor, targetUserId, metadata, session) => audits.create({
    auditId: randomUUID(),
    event,
    targetUserId,
    actorUserId: actor?.userId ?? null,
    actorRole: actor?.role ?? 'unknown',
    occurredAt: now(),
    metadata,
  }, { session });

  const requireSuperAdmin = async (actor, currentPassword) => {
    if (actor?.role !== ROLES.SUPERADMIN) throw new HttpError(403, 'Only Super Admin can manage administrator accounts.');
    await verifySuperAdminPassword({ actor, password: currentPassword, accounts });
  };

  const findAdmin = async (userId, session = null) => {
    if (typeof userId !== 'string' || !userId || userId.length > 120) throw new HttpError(400, 'Invalid account ID.');
    const account = await accounts.findByUserId(userId, { session });
    if (!account || !STAFF_ROLES.includes(account.role)) throw new HttpError(404, 'Administrator account not found.');
    if (account.role === ROLES.SUPERADMIN) {
      throw new HttpError(403, 'The Super Admin account cannot be changed from this screen.');
    }
    return account;
  };

  return Object.freeze({
    async listStaff() {
      return (await accounts.listByRoles(STAFF_ROLES)).map(serializeAccount);
    },

    async listAudit(limit = 50) {
      return (await audits.listRecent(Math.min(Math.max(limit, 1), 200))).map(serializeAudit);
    },

    async createAdmin({ email, displayName, newPassword, currentPassword, actor }) {
      const normalizedEmail = normalizeEmail(email);
      const name = normalizeDisplayName(displayName);
      validateNewPassword(newPassword);
      await requireSuperAdmin(actor, currentPassword);
      try {
        return await runAtomically(async (session) => {
          if (await accounts.findByEmail(normalizedEmail, { session })) {
            throw new HttpError(409, 'That email address is already assigned to another account.');
          }
          const created = await accounts.createAccount({
            userId: randomUUID(),
            memberId: null,
            displayName: name,
            email: normalizedEmail,
            passwordHash: await bcrypt.hash(newPassword, 12),
            role: ROLES.ADMIN,
            active: true,
            sessionVersion: 0,
            passwordChangedAt: now(),
          }, { session });
          await recordAudit(ACCOUNT_AUDIT_EVENTS.ADMIN_CREATED, actor, created.userId,
            { email: normalizedEmail, displayName: name }, session);
          return serializeAccount(created);
        });
      } catch (error) {
        return translatePersistenceError(error);
      }
    },

    async updateAdminProfile({ userId, displayName, currentPassword, actor }) {
      const name = normalizeDisplayName(displayName);
      await requireSuperAdmin(actor, currentPassword);
      return runAtomically(async (session) => {
        const existing = await findAdmin(userId, session);
        const updated = await accounts.updateDisplayName(existing.userId, name, { session });
        await recordAudit(ACCOUNT_AUDIT_EVENTS.ADMIN_PROFILE_UPDATED, actor, existing.userId,
          { previousDisplayName: existing.displayName, displayName: name }, session);
        return serializeAccount(updated);
      });
    },

    async resetAdminPassword({ userId, newPassword, currentPassword, actor }) {
      validateNewPassword(newPassword);
      await requireSuperAdmin(actor, currentPassword);
      return runAtomically(async (session) => {
        const existing = await findAdmin(userId, session);
        const changedAt = now();
        const updated = await accounts.updatePassword(existing.userId, await bcrypt.hash(newPassword, 12),
          changedAt, { session });
        await recordAudit(ACCOUNT_AUDIT_EVENTS.ADMIN_PASSWORD_RESET, actor, existing.userId,
          { passwordChangedAt: changedAt.toISOString() }, session);
        return serializeAccount(updated);
      });
    },

    async setAdminActive({ userId, active, currentPassword, actor }) {
      if (typeof active !== 'boolean') throw new HttpError(400, 'active must be true or false.');
      await requireSuperAdmin(actor, currentPassword);
      return runAtomically(async (session) => {
        const existing = await findAdmin(userId, session);
        const updated = await accounts.setActive(existing.userId, active, { session });
        await recordAudit(active ? ACCOUNT_AUDIT_EVENTS.ADMIN_ACTIVATED : ACCOUNT_AUDIT_EVENTS.ADMIN_DEACTIVATED,
          actor, existing.userId, { previousActive: existing.active !== false, active }, session);
        return serializeAccount(updated);
      });
    },

    /** Any signed-in user may change their own password after re-entering the current one. */
    async changeOwnPassword({ currentPassword, newPassword, actor }) {
      if (!actor?.authenticated || !actor.userId) throw new HttpError(401, 'Authentication required.');
      validateNewPassword(newPassword);
      if (newPassword === currentPassword) {
        throw new HttpError(400, 'The new password must be different from the current password.');
      }
      await verifyAccountPassword({ actor, password: currentPassword, accounts,
        message: 'Current password is incorrect.' });
      return runAtomically(async (session) => {
        const changedAt = now();
        const updated = await accounts.updatePassword(actor.userId, await bcrypt.hash(newPassword, 12),
          changedAt, { session });
        await recordAudit(ACCOUNT_AUDIT_EVENTS.PASSWORD_CHANGED, actor, actor.userId,
          { passwordChangedAt: changedAt.toISOString() }, session);
        return updated;
      });
    },
  });
}

export const staffAccountService = createStaffAccountService();
