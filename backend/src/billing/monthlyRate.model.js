import mongoose from 'mongoose';
import { ROLES } from '../auth/permissions.js';
import { isValidLogicalMonth } from '../utils/month.js';
import { isValidPricePaise, MAX_MEAL_PRICE_PAISE } from './monthlyRate.constants.js';

function priceField(label) {
  return {
    type: Number,
    required: true,
    min: 0,
    max: MAX_MEAL_PRICE_PAISE,
    validate: { validator: isValidPricePaise, message: `${label} price must be integer paise` },
  };
}

const pricesSchema = new mongoose.Schema(
  {
    morningPricePaise: priceField('morning'),
    nightPricePaise: priceField('night'),
  },
  { _id: false, strict: 'throw' },
);

const rateChangeSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, required: true },
    actorRole: { type: String, enum: [ROLES.SUPERADMIN], required: true },
    from: { type: pricesSchema, required: false, default: null },
    to: { type: pricesSchema, required: true },
  },
  { _id: false, strict: 'throw' },
);

const monthlyMealRateSchema = new mongoose.Schema(
  {
    month: {
      type: String,
      required: true,
      immutable: true,
      unique: true,
      validate: { validator: isValidLogicalMonth, message: 'month must use the YYYY-MM format' },
    },
    morningPricePaise: priceField('morning'),
    nightPricePaise: priceField('night'),
    revision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'revision must be an integer' },
    },
    changes: { type: [rateChangeSchema], required: true, default: () => [] },
  },
  {
    collection: 'monthly_meal_rates',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

export const MonthlyMealRate =
  mongoose.models.MonthlyMealRate ?? mongoose.model('MonthlyMealRate', monthlyMealRateSchema);
