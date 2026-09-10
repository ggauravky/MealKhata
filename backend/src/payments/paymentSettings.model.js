import mongoose from 'mongoose';
import { ROLES } from '../auth/permissions.js';
import {
  MAX_RECEIVER_NAME_LENGTH,
  MAX_UPI_ID_LENGTH,
  PAYMENT_SETTINGS_KEY,
} from './payment.constants.js';

const receiverSchema = new mongoose.Schema(
  {
    receiverName: { type: String, required: true, maxlength: MAX_RECEIVER_NAME_LENGTH },
    upiId: { type: String, required: false, default: null, maxlength: MAX_UPI_ID_LENGTH },
    receiverMobile: { type: String, required: false, default: null },
  },
  { _id: false, strict: 'throw' },
);

const settingsChangeSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, required: true },
    actorRole: { type: String, enum: [ROLES.SUPERADMIN], required: true },
    from: { type: receiverSchema, required: false, default: null },
    to: { type: receiverSchema, required: true },
  },
  { _id: false, strict: 'throw' },
);

const paymentSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: [PAYMENT_SETTINGS_KEY],
      immutable: true,
      unique: true,
    },
    receiverName: { type: String, required: true, maxlength: MAX_RECEIVER_NAME_LENGTH },
    upiId: { type: String, required: false, default: null, maxlength: MAX_UPI_ID_LENGTH },
    receiverMobile: { type: String, required: false, default: null },
    revision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'revision must be an integer' },
    },
    changes: { type: [settingsChangeSchema], required: true, default: () => [] },
  },
  {
    collection: 'payment_settings',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

export const PaymentSettings =
  mongoose.models.PaymentSettings ?? mongoose.model('PaymentSettings', paymentSettingsSchema);
