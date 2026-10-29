import mongoose from 'mongoose';

import { isValidLogicalDate } from '../utils/date.js';
import {
  MAX_STUDENT_EMAIL_LENGTH,
  MAX_STUDENT_NAME_LENGTH,
  MAX_STUDENT_PHONE_LENGTH,
  MAX_STUDENT_REASON_LENGTH,
  STUDENT_STATUSES,
} from './student.constants.js';
import { assertSafeStudentId } from './studentId.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9][0-9 ()-]{5,31}$/;

function isNullableLogicalDate(value) {
  return value === null || value === undefined || isValidLogicalDate(value);
}

const studentSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      validate: {
        validator(value) {
          try {
            assertSafeStudentId(value);
            return true;
          } catch {
            return false;
          }
        },
        message: 'studentId must be a safe lowercase Mongo key identifier',
      },
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_STUDENT_NAME_LENGTH,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(STUDENT_STATUSES),
      default: STUDENT_STATUSES.ACTIVE,
      index: true,
    },
    email: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
      maxlength: MAX_STUDENT_EMAIL_LENGTH,
      validate: {
        validator: (value) => value === null || emailPattern.test(value),
        message: 'email must be null or a valid email address',
      },
    },
    phone: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_STUDENT_PHONE_LENGTH,
      validate: {
        validator: (value) => value === null || phonePattern.test(value),
        message: 'phone must be null or a valid contact number',
      },
    },
    mealEligibilityFrom: {
      type: String,
      default: null,
      validate: {
        validator: isNullableLogicalDate,
        message: 'mealEligibilityFrom must be null or a valid YYYY-MM-DD date',
      },
    },
    mealEligibilityUntil: {
      type: String,
      default: null,
      validate: {
        validator: isNullableLogicalDate,
        message: 'mealEligibilityUntil must be null or a valid YYYY-MM-DD date',
      },
    },
    rosterOrder: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: 'rosterOrder must be a non-negative safe integer',
      },
      index: true,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    archivedReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_STUDENT_REASON_LENGTH,
    },
  },
  {
    collection: 'students',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

studentSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { email: { $type: 'string' } },
  },
);
studentSchema.index(
  { phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: 'string' } },
  },
);
studentSchema.index({ status: 1, rosterOrder: 1, studentId: 1 });

export const Student = mongoose.models.Student || mongoose.model('Student', studentSchema);
