import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';
import {
  MAX_REASON_LENGTH,
  MAX_RECIPIENT_NAME_LENGTH,
  MAX_REFERENCE_LENGTH,
  MAX_ROOM_PAYMENT_PAISE,
  MAX_UPI_ID_LENGTH,
  RECIPIENT_MODES,
  ROOM_PAYMENT_METHODS,
  ROOM_PAYMENT_STATUSES,
} from './roomFee.constants.js';

export const recipientSnapshotSchema = new mongoose.Schema(
  {
    recipientMode: {
      type: String,
      enum: Object.values(RECIPIENT_MODES),
      required: true,
    },
    recipientName: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_RECIPIENT_NAME_LENGTH,
    },
    upiId: {
      type: String,
      trim: true,
      maxlength: MAX_UPI_ID_LENGTH,
      default: null,
    },
  },
  {
    _id: false,
    strict: 'throw',
  },
);

export const roomPaymentSchema = new mongoose.Schema(
  {
    roomPaymentId: {
      type: String,
      required: true,
      unique: true,
    },
    chargeId: {
      type: String,
      required: true,
      index: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      index: true,
    },
    month: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/,
      index: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_ROOM_PAYMENT_PAISE,
      validate: {
        validator(v) {
          return Number.isSafeInteger(v) && v > 0;
        },
        message: 'amountPaise must be a positive safe integer',
      },
    },
    method: {
      type: String,
      enum: ROOM_PAYMENT_METHODS,
      required: true,
    },
    reference: {
      type: String,
      trim: true,
      maxlength: MAX_REFERENCE_LENGTH,
      default: null,
    },
    recipientSnapshot: {
      type: recipientSnapshotSchema,
      required: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: Object.values(ROOM_PAYMENT_STATUSES),
      default: ROOM_PAYMENT_STATUSES.VERIFIED,
      required: true,
    },
    recordedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    recordedByRole: {
      type: String,
      required: true,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    voidedByRole: {
      type: String,
      default: null,
    },
    voidReason: {
      type: String,
      trim: true,
      maxlength: MAX_REASON_LENGTH,
      default: null,
    },
  },
  {
    collection: 'room_payments',
    timestamps: true,
    strict: 'throw',
  },
);

roomPaymentSchema.index({ memberId: 1, month: 1 });

export const RoomPayment =
  mongoose.models.RoomPayment || mongoose.model('RoomPayment', roomPaymentSchema);
