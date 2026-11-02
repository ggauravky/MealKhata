import mongoose from 'mongoose';
import { AUTHENTICATED_ROLES } from '../auth/permissions.js';
import { isValidPricePaise } from '../billing/monthlyRate.constants.js';
import { assertSafeStudentId } from '../students/studentId.js';
import { isValidLogicalDate } from '../utils/date.js';
import { DEFAULT_MEAL_STATUS, MEAL_STATUSES, MEAL_TYPES } from './meal.constants.js';
import { validateAllocationPlates, validateStudentKeyedRecord } from './mealParticipants.js';

function isSafeStudentId(value) {
  try {
    assertSafeStudentId(value);
    return true;
  } catch {
    return false;
  }
}

function studentIdField({ nullable = false } = {}) {
  return {
    type: String,
    required: !nullable,
    default: nullable ? null : undefined,
    validate: {
      validator: (value) => nullable && value === null ? true : isSafeStudentId(value),
      message: 'student identity must be a safe lowercase Mongo key identifier',
    },
  };
}

function statusMapField() {
  return {
    type: Map,
    of: {
      type: String,
      enum: MEAL_STATUSES,
      required: true,
      default: DEFAULT_MEAL_STATUS,
    },
    required: true,
    default: () => new Map(),
    validate: {
      validator: (value) => validateStudentKeyedRecord(value, 'meal statuses'),
      message: 'meal statuses contain an unsafe student key',
    },
  };
}

const changeSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, required: true },
    actorRole: { type: String, enum: AUTHENTICATED_ROLES, required: true },
    actorMemberId: studentIdField({ nullable: true }),
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    memberId: studentIdField(),
    from: { type: String, enum: MEAL_STATUSES, required: true },
    to: { type: String, enum: MEAL_STATUSES, required: true },
  },
  { _id: false, strict: 'throw' },
);

const plateSchema = new mongoose.Schema(
  {
    shares: {
      type: Map,
      of: {
        type: Number,
        required: true,
        min: 0,
        max: 6,
        validate: { validator: Number.isInteger, message: 'share must be an integer' },
      },
      required: true,
      default: () => new Map(),
      validate: {
        validator: (value) => validateStudentKeyedRecord(value, 'plate shares'),
        message: 'plate shares contain an unsafe student key',
      },
    },
  },
  { _id: false, strict: 'throw' },
);

const mealAllocationSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['default', 'custom'], required: true, default: 'custom' },
    plates: {
      type: [plateSchema],
      required: true,
      default: () => [],
      validate: {
        validator: validateAllocationPlates,
        message: 'allocation violates physical-plate or six-share-unit rules',
      },
    },
  },
  { _id: false },
);

const allocationChangeSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, required: true },
    actorRole: { type: String, enum: AUTHENTICATED_ROLES, required: true },
    actorMemberId: studentIdField({ nullable: true }),
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

const mealPriceOverrideSchema = new mongoose.Schema(
  {
    pricePaise: {
      type: Number,
      required: true,
      validate: {
        validator: isValidPricePaise,
        message: 'pricePaise must be a non-negative integer within allowed limits',
      },
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
  },
  { _id: false, strict: 'throw' },
);

const priceChangeSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, required: true },
    actorRole: { type: String, enum: AUTHENTICATED_ROLES, required: true },
    actorMemberId: studentIdField({ nullable: true }),
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    changeType: {
      type: String,
      enum: ['set', 'clear'],
      required: true,
    },
    fromOverridePricePaise: { type: Number, required: false, default: null },
    toOverridePricePaise: { type: Number, required: false, default: null },
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
    schemaVersion: {
      type: Number,
      required: false,
      enum: [3],
    },
    meals: {
      morning: statusMapField(),
      night: statusMapField(),
    },
    allocations: {
      morning: { type: mealAllocationSchema, required: false, default: null },
      night: { type: mealAllocationSchema, required: false, default: null },
    },
    priceOverrides: {
      morning: { type: mealPriceOverrideSchema, required: false, default: null },
      night: { type: mealPriceOverrideSchema, required: false, default: null },
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
    priceChanges: { type: [priceChangeSchema], required: true, default: () => [] },
  },
  {
    collection: 'meal_days',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

export const MealDay = mongoose.models.MealDay ?? mongoose.model('MealDay', mealDaySchema);
