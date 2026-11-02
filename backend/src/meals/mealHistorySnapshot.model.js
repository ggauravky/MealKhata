import mongoose from 'mongoose';

import { MEMBER_IDS } from '../config/members.js';
import { isValidLogicalDate } from '../utils/date.js';
import { MEAL_STATUSES, MEAL_TYPES } from './meal.constants.js';

const CALCULATION_VERSION = 'legacy-v2';
const ACTOR_ROLES = ['member', 'admin', 'superadmin', 'unknown'];
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function nonNegativeIntegerField() {
  return {
    type: Number,
    required: true,
    min: 0,
    validate: { validator: Number.isSafeInteger, message: 'value must be a non-negative safe integer' },
  };
}

function nullableNonNegativeIntegerField() {
  return {
    type: Number,
    default: null,
    min: 0,
    validate: {
      validator: (value) => value === null || Number.isSafeInteger(value),
      message: 'value must be null or a non-negative safe integer',
    },
  };
}

const statusesDefinition = Object.fromEntries(
  MEMBER_IDS.map((studentId) => [studentId, { type: String, enum: MEAL_STATUSES, required: true }]),
);
const integerByStudentDefinition = Object.fromEntries(
  MEMBER_IDS.map((studentId) => [studentId, nonNegativeIntegerField()]),
);

const statusesSchema = new mongoose.Schema(statusesDefinition, { _id: false, strict: 'throw' });
const integerByStudentSchema = new mongoose.Schema(integerByStudentDefinition, { _id: false, strict: 'throw' });
const plateSchema = new mongoose.Schema(
  { shares: { type: integerByStudentSchema, required: true } },
  { _id: false, strict: 'throw' },
);
const allocationSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['default', 'custom'], required: true },
    source: { type: String, enum: ['default', 'custom'], required: true },
    plates: { type: [plateSchema], required: true },
    physicalPlates: nonNegativeIntegerField(),
    shareUnits: { type: integerByStudentSchema, required: true },
  },
  { _id: false, strict: 'throw' },
);
const pricingSchema = new mongoose.Schema(
  {
    defaultPricePaise: nonNegativeIntegerField(),
    effectivePricePaise: nonNegativeIntegerField(),
    overridePricePaise: nullableNonNegativeIntegerField(),
    isOverridden: { type: Boolean, required: true },
    reason: { type: String, default: null, maxlength: 200 },
  },
  { _id: false, strict: 'throw' },
);
const costSchema = new mongoose.Schema(
  {
    physicalPlates: nonNegativeIntegerField(),
    pricePaise: nonNegativeIntegerField(),
    totalCostPaise: nonNegativeIntegerField(),
    memberAmountsPaise: { type: integerByStudentSchema, required: true },
    roomAmountPaise: nonNegativeIntegerField(),
  },
  { _id: false, strict: 'throw' },
);

function actorFields() {
  return {
    changedAt: { type: String, required: true, match: ISO_DATE_TIME_PATTERN },
    actorRole: { type: String, enum: ACTOR_ROLES, required: true },
    actorStudentId: { type: String, default: null },
    mealType: { type: String, enum: MEAL_TYPES, required: true },
  };
}

const statusChangeSchema = new mongoose.Schema(
  {
    ...actorFields(),
    studentId: { type: String, required: true },
    from: { type: String, enum: MEAL_STATUSES, required: true },
    to: { type: String, enum: MEAL_STATUSES, required: true },
  },
  { _id: false, strict: 'throw' },
);
const allocationChangeSchema = new mongoose.Schema(
  {
    ...actorFields(),
    changeType: { type: String, enum: ['set', 'clear', 'reset_on_status_change'], required: true },
    from: { type: mongoose.Schema.Types.Mixed, default: null },
    to: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, default: null },
  },
  { _id: false, strict: 'throw' },
);
const priceChangeSchema = new mongoose.Schema(
  {
    ...actorFields(),
    changeType: { type: String, enum: ['set', 'clear'], required: true },
    fromPricePaise: nullableNonNegativeIntegerField(),
    toPricePaise: nullableNonNegativeIntegerField(),
    reason: { type: String, default: null },
  },
  { _id: false, strict: 'throw' },
);

export const mealHistorySnapshotSchema = new mongoose.Schema(
  {
    snapshotId: { type: String, required: true, unique: true, immutable: true },
    date: {
      type: String,
      required: true,
      immutable: true,
      validate: {
        validator: isValidLogicalDate,
        message: 'date must be a valid calendar date in YYYY-MM-DD format',
      },
    },
    calculationVersion: { type: String, enum: [CALCULATION_VERSION], required: true, immutable: true },
    sourceChecksum: { type: String, required: true, immutable: true, match: SHA256_PATTERN },
    sourceRevision: nonNegativeIntegerField(),
    participantOrder: {
      type: [String],
      required: true,
      immutable: true,
      validate: {
        validator: (value) => (
          Array.isArray(value)
          && value.length === MEMBER_IDS.length
          && value.every((studentId, index) => studentId === MEMBER_IDS[index])
        ),
        message: 'participantOrder must preserve the legacy participant order',
      },
    },
    statuses: {
      morning: { type: statusesSchema, required: true },
      night: { type: statusesSchema, required: true },
    },
    allocations: {
      morning: { type: allocationSchema, required: true },
      night: { type: allocationSchema, required: true },
    },
    pricing: {
      morning: { type: pricingSchema, required: true },
      night: { type: pricingSchema, required: true },
    },
    costs: {
      morning: { type: costSchema, required: true },
      night: { type: costSchema, required: true },
    },
    audit: {
      statusChanges: { type: [statusChangeSchema], required: true, default: () => [] },
      allocationChanges: { type: [allocationChangeSchema], required: true, default: () => [] },
      priceChanges: { type: [priceChangeSchema], required: true, default: () => [] },
    },
    sourceCreatedAt: { type: String, default: null, match: ISO_DATE_TIME_PATTERN },
    sourceUpdatedAt: { type: String, default: null, match: ISO_DATE_TIME_PATTERN },
    capturedAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  {
    collection: 'meal_history_snapshots',
    strict: 'throw',
    versionKey: false,
  },
);

mealHistorySnapshotSchema.index(
  { date: 1, calculationVersion: 1 },
  { unique: true, name: 'uniq_meal_snapshot_date_version' },
);
mealHistorySnapshotSchema.index(
  { calculationVersion: 1, sourceRevision: 1 },
  { name: 'meal_snapshot_version_revision' },
);

export function createMealHistorySnapshotModel(connection = mongoose) {
  return connection.models.MealHistorySnapshot
    || connection.model('MealHistorySnapshot', mealHistorySnapshotSchema);
}

export const MealHistorySnapshot = createMealHistorySnapshotModel(mongoose);
