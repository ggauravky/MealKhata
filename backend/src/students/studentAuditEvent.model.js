import mongoose from 'mongoose';

import {
  MAX_STUDENT_REASON_LENGTH,
  STUDENT_AUDIT_EVENT_TYPES,
} from './student.constants.js';
import { assertSafeStudentId } from './studentId.js';

function isSafeNullableStudentId(value) {
  if (value === null || value === undefined) return true;
  try {
    assertSafeStudentId(value);
    return true;
  } catch {
    return false;
  }
}

const studentAuditEventSchema = new mongoose.Schema(
  {
    auditId: { type: String, required: true, unique: true, immutable: true },
    studentId: {
      type: String,
      required: true,
      immutable: true,
      index: true,
      validate: {
        validator: isSafeNullableStudentId,
        message: 'studentId must be a safe lowercase Mongo key identifier',
      },
    },
    eventType: {
      type: String,
      required: true,
      enum: Object.values(STUDENT_AUDIT_EVENT_TYPES),
      index: true,
    },
    actorUserId: { type: String, default: null },
    actorRole: { type: String, required: true },
    actorStudentId: {
      type: String,
      default: null,
      validate: {
        validator: isSafeNullableStudentId,
        message: 'actorStudentId must be null or a safe studentId',
      },
    },
    occurredAt: { type: Date, required: true, index: true },
    reason: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_STUDENT_REASON_LENGTH,
    },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    collection: 'student_audit_events',
    strict: 'throw',
    timestamps: false,
    versionKey: false,
  },
);

studentAuditEventSchema.index({ studentId: 1, occurredAt: -1 });

export const StudentAuditEvent = mongoose.models.StudentAuditEvent
  || mongoose.model('StudentAuditEvent', studentAuditEventSchema);
