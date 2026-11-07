import mongoose from 'mongoose';
import { isValidLogicalDate } from '../utils/date.js';

const systemSettingsSchema = new mongoose.Schema({
  settingsId: { type: String, required: true, enum: ['system'], immutable: true, unique: true },
  financialStartDate: {
    type: String,
    default: null,
    validate: { validator: (value) => value === null || isValidLogicalDate(value), message: 'financialStartDate must use YYYY-MM-DD' },
  },
  timezone: { type: String, required: true, enum: ['Asia/Kolkata'], default: 'Asia/Kolkata' },
  revision: { type: Number, required: true, min: 0, default: 0,
    validate: { validator: Number.isInteger, message: 'revision must be an integer' } },
  configuredAt: { type: Date, default: null },
  configuredBy: { type: String, default: null },
}, { collection: 'system_settings', strict: 'throw', versionKey: false, timestamps: true });

export const SystemSettings = mongoose.models.SystemSettings
  ?? mongoose.model('SystemSettings', systemSettingsSchema);
