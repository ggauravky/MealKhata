import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';
import {
  DEFAULT_DUE_DAY,
  MAX_DUE_DAY,
  MAX_REASON_LENGTH,
  MAX_ROOM_FEE_PAISE,
  MIN_DUE_DAY,
} from './roomFee.constants.js';

export const roomFeePlanSchema = new mongoose.Schema(
  {
    feePlanId: {
      type: String,
      required: true,
      unique: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      index: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_ROOM_FEE_PAISE,
      validate: {
        validator(v) {
          return Number.isSafeInteger(v);
        },
        message: 'amountPaise must be a safe integer',
      },
    },
    effectiveFromMonth: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/,
    },
    effectiveUntilMonth: {
      type: String,
      default: null,
      validate: {
        validator(v) {
          return v === null || /^\d{4}-\d{2}$/.test(v);
        },
        message: 'effectiveUntilMonth must be in YYYY-MM format or null',
      },
    },
    dueDay: {
      type: Number,
      required: true,
      min: MIN_DUE_DAY,
      max: MAX_DUE_DAY,
      default: DEFAULT_DUE_DAY,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: MAX_REASON_LENGTH,
      default: null,
    },
    createdByRole: {
      type: String,
      required: true,
    },
    supersededAt: {
      type: Date,
      default: null,
    },
    supersededBy: {
      type: String,
      default: null,
    },
  },
  {
    collection: 'room_fee_plans',
    timestamps: true,
    strict: 'throw',
  },
);

roomFeePlanSchema.index({ memberId: 1, effectiveFromMonth: 1 });

export const RoomFeePlan =
  mongoose.models.RoomFeePlan || mongoose.model('RoomFeePlan', roomFeePlanSchema);
