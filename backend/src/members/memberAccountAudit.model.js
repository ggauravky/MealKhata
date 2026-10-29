import mongoose from 'mongoose';
import { assertSafeStudentId } from '../students/studentId.js';

function isSafeStudentId(value) {
  try {
    assertSafeStudentId(value);
    return true;
  } catch {
    return false;
  }
}

const memberAccountAuditSchema = new mongoose.Schema({
  auditId: { type: String, required: true, unique: true, immutable: true },
  memberId: {
    type: String,
    required: true,
    index: true,
    validate: {
      validator: isSafeStudentId,
      message: 'memberId must be a safe student ID',
    },
  },
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
