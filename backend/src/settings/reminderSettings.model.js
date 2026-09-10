import mongoose from 'mongoose';
import { ROLES } from '../auth/permissions.js';
import {
  DEFAULT_REMINDERS,
  isValidLogicalTime,
  REMINDER_SETTINGS_KEY,
} from './reminder.constants.js';

const reminderEntrySchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, required: true },
    time: {
      type: String,
      required: true,
      validate: { validator: isValidLogicalTime, message: 'reminder time must use HH:mm' },
    },
  },
  { _id: false, strict: 'throw' },
);

const remindersSchema = new mongoose.Schema(
  {
    morning: { type: reminderEntrySchema, required: true },
    night: { type: reminderEntrySchema, required: true },
  },
  { _id: false, strict: 'throw' },
);

const reminderChangeSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, required: true },
    actorRole: { type: String, enum: [ROLES.SUPERADMIN], required: true },
    from: { type: remindersSchema, required: true },
    to: { type: remindersSchema, required: true },
  },
  { _id: false, strict: 'throw' },
);

const reminderSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: [REMINDER_SETTINGS_KEY],
      immutable: true,
      unique: true,
    },
    reminders: {
      type: remindersSchema,
      required: true,
      default: () => DEFAULT_REMINDERS,
    },
    revision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'revision must be an integer' },
    },
    changes: { type: [reminderChangeSchema], required: true, default: () => [] },
  },
  {
    collection: 'reminder_settings',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

export const ReminderSettings =
  mongoose.models.ReminderSettings ?? mongoose.model('ReminderSettings', reminderSettingsSchema);
