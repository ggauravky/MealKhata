import mongoose from 'mongoose';
import {
  DEFAULT_DUE_DAY,
  MAX_DUE_DAY,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_RECIPIENT_NAME_LENGTH,
  MAX_UPI_ID_LENGTH,
  MIN_DUE_DAY,
  RECIPIENT_MODES,
  ROOM_SETTINGS_KEY,
} from './roomFee.constants.js';

export const roomPaymentSettingsSchema = new mongoose.Schema(
  {
    settingsId: {
      type: String,
      required: true,
      unique: true,
      default: ROOM_SETTINGS_KEY,
    },
    recipientMode: {
      type: String,
      enum: Object.values(RECIPIENT_MODES),
      default: RECIPIENT_MODES.ADMIN_COLLECTOR,
      required: true,
    },
    recipientName: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_RECIPIENT_NAME_LENGTH,
      default: 'Hostel Room Admin',
    },
    upiId: {
      type: String,
      trim: true,
      maxlength: MAX_UPI_ID_LENGTH,
      default: null,
    },
    paymentInstructions: {
      type: String,
      trim: true,
      maxlength: MAX_INSTRUCTIONS_LENGTH,
      default: null,
    },
    defaultDueDay: {
      type: Number,
      required: true,
      min: MIN_DUE_DAY,
      max: MAX_DUE_DAY,
      default: DEFAULT_DUE_DAY,
    },
    updatedByRole: {
      type: String,
      required: true,
      default: 'system',
    },
  },
  {
    collection: 'room_payment_settings',
    timestamps: true,
    strict: 'throw',
  },
);

export const RoomPaymentSettings =
  mongoose.models.RoomPaymentSettings ||
  mongoose.model('RoomPaymentSettings', roomPaymentSettingsSchema);
