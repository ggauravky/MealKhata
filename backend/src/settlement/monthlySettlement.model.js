import mongoose from 'mongoose';
import { assertSafeStudentId } from '../students/studentId.js';

const memberSnapshotSchema = new mongoose.Schema(
  {
    displayName: { type: String, required: false, trim: true },
    morningCount: { type: Number, required: false, min: 0 },
    nightCount: { type: Number, required: false, min: 0 },
    totalPlates: { type: Number, required: false, min: 0 },
    morningParticipationCount: { type: Number, required: false, min: 0 },
    nightParticipationCount: { type: Number, required: false, min: 0 },
    morningShareUnits: { type: Number, required: false, min: 0 },
    nightShareUnits: { type: Number, required: false, min: 0 },
    totalShareUnits: { type: Number, required: false, min: 0 },
    billAmountPaise: { type: Number, required: true, min: 0 },
    paidAmountPaise: { type: Number, required: true, min: 0 },
    remainingAmountPaise: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const roomSnapshotSchema = new mongoose.Schema(
  {
    morningCount: { type: Number, required: false, min: 0 },
    nightCount: { type: Number, required: false, min: 0 },
    totalPlates: { type: Number, required: false, min: 0 },
    morningPhysicalPlates: { type: Number, required: false, min: 0 },
    nightPhysicalPlates: { type: Number, required: false, min: 0 },
    totalPhysicalPlates: { type: Number, required: false, min: 0 },
    morningParticipants: { type: Number, required: false, min: 0 },
    nightParticipants: { type: Number, required: false, min: 0 },
    billAmountPaise: { type: Number, required: true, min: 0 },
    paidAmountPaise: { type: Number, required: true, min: 0 },
    remainingAmountPaise: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const ratesSnapshotSchema = new mongoose.Schema(
  {
    morningPricePaise: { type: Number, required: true, min: 0 },
    nightPricePaise: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const pricingAdjustmentSnapshotSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    mealType: { type: String, required: true, enum: ['morning', 'night'] },
    defaultPricePaise: { type: Number, required: true, min: 0 },
    effectivePricePaise: { type: Number, required: true, min: 0 },
    reason: { type: String, default: null },
  },
  { _id: false },
);

const settlementSnapshotSchema = new mongoose.Schema(
  {
    rates: { type: ratesSnapshotSchema, required: true },
    studentIds: { type: [String], default: undefined },
    members: { type: Map, of: memberSnapshotSchema, required: true },
    room: { type: roomSnapshotSchema, required: true },
    pricingAdjustments: {
      type: [pricingAdjustmentSnapshotSchema],
      required: false,
      default: () => [],
    },
  },
  { _id: false },
);

const monthlySettlementSchema = new mongoose.Schema(
  {
    settlementId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    month: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-(?:0[1-9]|1[0-2])$/,
      index: true,
    },
    sequence: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      required: true,
      enum: ['closed', 'reopened'],
      default: 'closed',
      index: true,
    },
    snapshotVersion: {
      type: Number,
      default: 2,
    },
    snapshot: {
      type: settlementSnapshotSchema,
      required: true,
    },
    closedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    closedByRole: {
      type: String,
      required: true,
      default: 'superadmin',
    },
    reopenedAt: {
      type: Date,
      default: null,
    },
    reopenedByRole: {
      type: String,
      default: null,
    },
    reopenReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'monthly_settlements',
  },
);

monthlySettlementSchema.pre('validate', function validateDynamicSnapshot() {
  if (this.snapshotVersion !== 3 || !this.snapshot) return;
  const ids = this.snapshot.studentIds;
  const members = this.snapshot.members;
  const keys = members instanceof Map ? [...members.keys()] : Object.keys(members ?? {});
  if (!Array.isArray(ids) || ids.length !== keys.length || new Set(ids).size !== ids.length ||
      ids.some((id) => !keys.includes(id))) {
    throw new Error('snapshot.studentIds must exactly match snapshot.members');
  }
  for (const id of ids) assertSafeStudentId(id);
  const billTotal = ids.reduce((sum, id) => sum + (members instanceof Map ? members.get(id) : members[id]).billAmountPaise, 0);
  const paidTotal = ids.reduce((sum, id) => sum + (members instanceof Map ? members.get(id) : members[id]).paidAmountPaise, 0);
  if (billTotal !== this.snapshot.room.billAmountPaise || paidTotal !== this.snapshot.room.paidAmountPaise) {
    throw new Error('snapshot member amounts must reconcile with room amounts');
  }
});

// Guarantee at most ONE active 'closed' settlement per month
monthlySettlementSchema.index(
  { month: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'closed' } },
);

monthlySettlementSchema.index({ month: 1, sequence: -1 });
monthlySettlementSchema.index({ month: 1, sequence: 1 }, { unique: true });

export const MonthlySettlement = mongoose.model('MonthlySettlement', monthlySettlementSchema);
