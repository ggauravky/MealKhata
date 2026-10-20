import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';
import {
  MAX_REASON_LENGTH,
  MAX_ROOM_FEE_PAISE,
  MAX_ROOM_NUMBER_LENGTH,
  ROOM_CHARGE_STATUSES,
} from './roomFee.constants.js';

export const roomChargeAdjustmentSchema = new mongoose.Schema(
  {
    adjustmentId: {
      type: String,
      required: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      validate: {
        validator(v) {
          return Number.isSafeInteger(v);
        },
        message: 'adjustment amountPaise must be a safe integer',
      },
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_REASON_LENGTH,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    createdByRole: {
      type: String,
      required: true,
    },
  },
  {
    _id: false,
    strict: 'throw',
  },
);

export const roomChargeSchema = new mongoose.Schema(
  {
    chargeId: {
      type: String,
      required: true,
      unique: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
    },
    roomId: {
      type: String,
      required: true,
    },
    roomNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_ROOM_NUMBER_LENGTH,
    },
    month: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/,
    },
    feePlanId: {
      type: String,
      required: true,
    },
    baseAmountPaise: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_ROOM_FEE_PAISE,
      validate: {
        validator(v) {
          return Number.isSafeInteger(v);
        },
        message: 'baseAmountPaise must be a safe integer',
      },
    },
    dueDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    status: {
      type: String,
      enum: Object.values(ROOM_CHARGE_STATUSES),
      default: ROOM_CHARGE_STATUSES.ISSUED,
      required: true,
    },
    adjustments: {
      type: [roomChargeAdjustmentSchema],
      default: () => [],
    },
    issuedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    issuedByRole: {
      type: String,
      required: true,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelReason: {
      type: String,
      trim: true,
      maxlength: MAX_REASON_LENGTH,
      default: null,
    },
  },
  {
    collection: 'room_charges',
    timestamps: true,
    strict: 'throw',
  },
);

roomChargeSchema.index({ memberId: 1, month: 1 }, { unique: true });
roomChargeSchema.index({ month: 1 });

export const RoomCharge =
  mongoose.models.RoomCharge || mongoose.model('RoomCharge', roomChargeSchema);
