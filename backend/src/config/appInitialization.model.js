import mongoose from 'mongoose';
import { isValidLogicalDate } from '../utils/date.js';

export const APP_INITIALIZATION_ID = 'mealkhata';

/**
 * Durable, single-document record that the first Super Admin and system settings were
 * created. The unique initializationId makes a second initialization impossible.
 */
const appInitializationSchema = new mongoose.Schema({
  initializationId: { type: String, required: true, enum: [APP_INITIALIZATION_ID], unique: true, immutable: true },
  status: { type: String, required: true, enum: ['complete'], immutable: true },
  databaseName: { type: String, required: true, immutable: true },
  superAdminUserId: { type: String, required: true, immutable: true },
  financialStartDate: {
    type: String,
    required: true,
    immutable: true,
    validate: { validator: isValidLogicalDate, message: 'financialStartDate must use YYYY-MM-DD' },
  },
  initializedAt: { type: Date, required: true, immutable: true },
}, {
  collection: 'app_initialization',
  strict: 'throw',
  timestamps: false,
  versionKey: false,
});

export const AppInitialization = mongoose.models.AppInitialization
  || mongoose.model('AppInitialization', appInitializationSchema);
