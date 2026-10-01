import mongoose from 'mongoose';

const memberSnapshotSchema = new mongoose.Schema(
  {
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

const settlementSnapshotSchema = new mongoose.Schema(
  {
    rates: { type: ratesSnapshotSchema, required: true },
    members: {
      gaurav: { type: memberSnapshotSchema, required: true },
      nikhil: { type: memberSnapshotSchema, required: true },
      devansh: { type: memberSnapshotSchema, required: true },
    },
    room: { type: roomSnapshotSchema, required: true },
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

// Guarantee at most ONE active 'closed' settlement per month
monthlySettlementSchema.index(
  { month: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'closed' } },
);

monthlySettlementSchema.index({ month: 1, sequence: -1 });

export const MonthlySettlement = mongoose.model('MonthlySettlement', monthlySettlementSchema);
