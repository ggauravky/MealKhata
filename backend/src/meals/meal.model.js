import mongoose from 'mongoose';
import { AUTHENTICATED_ROLES } from '../auth/permissions.js';
import { MEMBER_IDS } from '../config/members.js';
import { isValidLogicalDate } from '../utils/date.js';
import { DEFAULT_MEAL_STATUS, MEAL_STATUSES, MEAL_TYPES } from './meal.constants.js';

const statusField = () => ({
  type: String,
  enum: MEAL_STATUSES,
  required: true,
  default: DEFAULT_MEAL_STATUS,
});

const mealSchemaDefinition = Object.fromEntries(
  MEMBER_IDS.map((memberId) => [memberId, statusField()]),
);

const mealSchema = new mongoose.Schema(mealSchemaDefinition, {
  _id: false,
  strict: 'throw',
});

const changeSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, required: true },
    actorRole: { type: String, enum: AUTHENTICATED_ROLES, required: true },
    actorMemberId: { type: String, enum: [...MEMBER_IDS, null], required: false, default: null },
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    memberId: { type: String, enum: MEMBER_IDS, required: true },
    from: { type: String, enum: MEAL_STATUSES, required: true },
    to: { type: String, enum: MEAL_STATUSES, required: true },
  },
  { _id: false, strict: 'throw' },
);

const mealDaySchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      immutable: true,
      unique: true,
      validate: {
        validator: isValidLogicalDate,
        message: 'date must be a valid calendar date in YYYY-MM-DD format',
      },
    },
    meals: {
      morning: { type: mealSchema, required: true, default: () => ({}) },
      night: { type: mealSchema, required: true, default: () => ({}) },
    },
    revision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'revision must be an integer' },
    },
    changes: { type: [changeSchema], required: true, default: () => [] },
  },
  {
    collection: 'meal_days',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

export const MealDay = mongoose.models.MealDay ?? mongoose.model('MealDay', mealDaySchema);
