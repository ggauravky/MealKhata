import mongoose from 'mongoose';
import { isValidLogicalDate } from '../utils/date.js';

const correctionSchema = new mongoose.Schema({
  date: { type: String, required: true, immutable: true, validate: isValidLogicalDate },
  revision: { type: Number, required: true, immutable: true, min: 1 },
  previousRevision: { type: Number, required: true, immutable: true, min: 0 },
  originalSourceChecksum: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  snapshotChecksum: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  sourceState: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  operation: { type: String, required: true, immutable: true, enum: ['status', 'allocation', 'clearAllocation', 'price', 'clearPrice'] },
  mealType: { type: String, required: true, immutable: true, enum: ['morning', 'night'] },
  actorRole: { type: String, required: true, immutable: true, enum: ['superadmin'] },
  reason: { type: String, required: true, immutable: true, minlength: 3, maxlength: 200 },
  createdAt: { type: Date, required: true, immutable: true, default: Date.now },
}, { collection: 'meal_history_corrections', strict: 'throw', versionKey: false });

correctionSchema.index({ date: 1, revision: 1 }, { unique: true, name: 'uniq_meal_correction_date_revision' });

export const MealHistoricalCorrection = mongoose.models.MealHistoricalCorrection
  || mongoose.model('MealHistoricalCorrection', correctionSchema);
