import mongoose from 'mongoose';

export const ACCOUNT_AUDIT_EVENTS = Object.freeze({
  SUPERADMIN_INITIALIZED: 'SUPERADMIN_INITIALIZED',
  ADMIN_CREATED: 'ADMIN_CREATED',
  ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
  ADMIN_ACTIVATED: 'ADMIN_ACTIVATED',
  ADMIN_DEACTIVATED: 'ADMIN_DEACTIVATED',
  ADMIN_PROFILE_UPDATED: 'ADMIN_PROFILE_UPDATED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  SYSTEM_SETTINGS_UPDATED: 'SYSTEM_SETTINGS_UPDATED',
});

/** Append-only record of staff-account, self-service credential and system-setting changes. */
const accountAuditEventSchema = new mongoose.Schema({
  auditId: { type: String, required: true, unique: true, immutable: true },
  event: { type: String, required: true, enum: Object.values(ACCOUNT_AUDIT_EVENTS), immutable: true },
  targetUserId: { type: String, default: null, immutable: true },
  actorUserId: { type: String, default: null, immutable: true },
  actorRole: { type: String, required: true, immutable: true },
  occurredAt: { type: Date, required: true, immutable: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
}, {
  collection: 'account_audit_events',
  strict: 'throw',
  timestamps: false,
  versionKey: false,
});

accountAuditEventSchema.index({ occurredAt: -1 });
accountAuditEventSchema.index({ targetUserId: 1, occurredAt: -1 });

export const AccountAuditEvent = mongoose.models.AccountAuditEvent
  || mongoose.model('AccountAuditEvent', accountAuditEventSchema);
