import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

import {
  normalizeEmail,
  runAtomically,
  serializeAccount,
  translatePersistenceError,
  validateNewPassword,
  verifySuperAdminPassword,
} from '../auth/accountSecurity.js';
import { ROLES } from '../auth/permissions.js';
import { userAccountRepository } from '../auth/userAccount.repository.js';
import { HttpError } from '../utils/HttpError.js';
import { studentResolver } from '../students/studentResolver.service.js';
import { memberAccountAuditRepository } from './memberAccount.repository.js';

export function createMemberAccountService({
  accounts = userAccountRepository,
  audits = memberAccountAuditRepository,
  resolver = studentResolver,
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
    await verifySuperAdminPassword({ actor, password: currentPassword, accounts });
  };

  const assertEmailAvailable = async (email, memberId, session = null) => {
    const canonical = await accounts.findByEmail(email, { session });
    if (canonical && canonical.memberId !== memberId) {
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
      const student = await resolver.assertKnown(memberId);
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
            displayName: student.displayName,
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
      await resolver.assertKnown(memberId);
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
      await resolver.assertKnown(memberId);
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
      await resolver.assertKnown(memberId);
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
  });
}

export const memberAccountService = createMemberAccountService();
