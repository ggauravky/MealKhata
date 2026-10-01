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

const plateShareSchema = new mongoose.Schema(
  Object.fromEntries(
    MEMBER_IDS.map((memberId) => [
      memberId,
      {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: 6,
        validate: { validator: Number.isInteger, message: 'share must be an integer' },
      },
    ]),
  ),
  { _id: false },
);

const plateSchema = new mongoose.Schema(
  {
    shares: { type: plateShareSchema, required: true },
  },
  { _id: false },
);

const mealAllocationSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['default', 'custom'], required: true, default: 'custom' },
    plates: { type: [plateSchema], required: true, default: () => [] },
  },
  { _id: false },
);

const allocationChangeSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, required: true },
    actorRole: { type: String, enum: AUTHENTICATED_ROLES, required: true },
    actorMemberId: { type: String, enum: [...MEMBER_IDS, null], required: false, default: null },
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    changeType: {
      type: String,
      enum: ['set', 'clear', 'reset_on_status_change'],
      required: true,
      default: 'set',
    },
    from: { type: mongoose.Schema.Types.Mixed, required: false, default: null },
    to: { type: mongoose.Schema.Types.Mixed, required: false, default: null },
    reason: { type: String, required: false, default: null },
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
    allocations: {
      morning: { type: mealAllocationSchema, required: false, default: null },
      night: { type: mealAllocationSchema, required: false, default: null },
    },
    revision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'revision must be an integer' },
    },
    changes: { type: [changeSchema], required: true, default: () => [] },
    allocationChanges: { type: [allocationChangeSchema], required: true, default: () => [] },
  },
  {
    collection: 'meal_days',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

export const MealDay = mongoose.models.MealDay ?? mongoose.model('MealDay', mealDaySchema);
