import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { runAtomically, verifySuperAdminPassword } from '../auth/accountSecurity.js';
import { AccountAuditEvent, ACCOUNT_AUDIT_EVENTS } from '../auth/accountAuditEvent.model.js';
import { ROLES } from '../auth/permissions.js';
import { userAccountRepository } from '../auth/userAccount.repository.js';
import { isValidLogicalDate } from '../utils/date.js';
import { HttpError } from '../utils/HttpError.js';
import { SystemSettings } from './systemSettings.model.js';

// Any document here means money or attendance was already recorded against the boundary.
export const FINANCIAL_COLLECTIONS = Object.freeze([
  'meal_days', 'payments', 'room_charges', 'room_payments', 'expenses',
  'expense_reimbursements', 'hostel_stays', 'hostel_deposit_transactions',
  'monthly_settlements', 'unallocated_credits', 'credit_allocations',
]);

function serializeSettings(settings) {
  return {
    financialStartDate: settings?.financialStartDate ?? null,
    timezone: settings?.timezone ?? 'Asia/Kolkata',
    revision: settings?.revision ?? 0,
    configuredAt: settings?.configuredAt ? new Date(settings.configuredAt).toISOString() : null,
  };
}

export function createSystemSettingsService({
  model = SystemSettings,
  accounts = userAccountRepository,
  hasFinancialRecords = async (session) => {
    for (const name of FINANCIAL_COLLECTIONS) {
      if (await mongoose.connection.db.collection(name).countDocuments({}, { limit: 1, session })) return true;
    }
    return false;
  },
  now = () => new Date(),
} = {}) {
  return Object.freeze({
    async getSettings() {
      const [settings, locked] = await Promise.all([
        model.findOne({ settingsId: 'system' }).lean(),
        hasFinancialRecords(null),
      ]);
      return { ...serializeSettings(settings), financialStartDateLocked: locked };
    },

    /**
     * The financial start date may only move while nothing has been recorded yet, so
     * existing balances can never be silently reclassified.
     */
    async updateSettings({ financialStartDate, expectedRevision, currentPassword, actor }) {
      if (actor?.role !== ROLES.SUPERADMIN) throw new HttpError(403, 'Only Super Admin can change system settings.');
      if (!isValidLogicalDate(financialStartDate)) {
        throw new HttpError(400, 'Financial start date must be a valid date (YYYY-MM-DD).');
      }
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new HttpError(400, 'expectedRevision is required.');
      }
      await verifySuperAdminPassword({ actor, password: currentPassword, accounts });
      return runAtomically(async (session) => {
        if (await hasFinancialRecords(session)) {
          throw new HttpError(409, 'The financial start date is locked because records already exist.');
        }
        const previous = await model.findOne({ settingsId: 'system' }).session(session).lean();
        if (!previous) throw new HttpError(503, 'System settings have not been initialized.');
        const updated = await model.findOneAndUpdate(
          { settingsId: 'system', revision: expectedRevision },
          { $set: { financialStartDate, configuredAt: now(), configuredBy: actor.userId },
            $inc: { revision: 1 } },
          { new: true, runValidators: true, session },
        ).lean();
        if (!updated) throw new HttpError(409, 'Settings changed in the meantime. Refresh and retry.');
        await AccountAuditEvent.create([{
          auditId: randomUUID(),
          event: ACCOUNT_AUDIT_EVENTS.SYSTEM_SETTINGS_UPDATED,
          targetUserId: null,
          actorUserId: actor.userId,
          actorRole: actor.role,
          occurredAt: now(),
          metadata: { previousFinancialStartDate: previous.financialStartDate, financialStartDate },
        }], session ? { session } : {});
        return { ...serializeSettings(updated), financialStartDateLocked: false };
      });
    },
  });
}

export const systemSettingsService = createSystemSettingsService();
