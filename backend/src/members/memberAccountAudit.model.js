import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';

const memberAccountAuditSchema = new mongoose.Schema({
  auditId: { type: String, required: true, unique: true, immutable: true },
  memberId: { type: String, required: true, enum: MEMBER_IDS, index: true },
  event: { type: String, required: true, index: true },
  actorUserId: { type: String, default: null },
  actorRole: { type: String, required: true },
  occurredAt: { type: Date, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, {
  collection: 'member_account_audits',
  strict: 'throw',
  timestamps: false,
  versionKey: false,
});

export const MemberAccountAudit = mongoose.models.MemberAccountAudit
  || mongoose.model('MemberAccountAudit', memberAccountAuditSchema);
