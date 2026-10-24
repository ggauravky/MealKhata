/**
 * MealKhata 2.0 - Hostel Stay, Security Deposit & Clearance Mongoose Models
 */

import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';
import {
  CLEARANCE_STATUSES,
  DEPOSIT_ACCOUNT_STATUSES,
  DEPOSIT_HOLDER_TYPES,
  DEPOSIT_METHODS,
  DEPOSIT_TRANSACTION_TYPES,
  MAX_DEPOSIT_PAISE,
  MAX_NOTE_LENGTH,
  MAX_REFERENCE_LENGTH,
  STAY_STATUSES,
} from './stay.constants.js';

// ----------------------------------------------------
// 1. Audit Entry Schema (Embedded)
// ----------------------------------------------------
const auditEntrySchema = new mongoose.Schema(
  {
    event: { type: String, required: true },
    timestamp: { type: Date, required: true, default: Date.now },
    actorRole: { type: String, required: true },
    actorMemberId: { type: String, default: null },
    note: { type: String, default: null, maxlength: MAX_NOTE_LENGTH },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

// ----------------------------------------------------
// 2. Hostel Stay Schema
// ----------------------------------------------------
export const hostelStaySchema = new mongoose.Schema(
  {
    stayId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      index: true,
    },
    joinedOn: {
      type: String, // YYYY-MM-DD
      required: true,
      trim: true,
    },
    expectedLeaveOn: {
      type: String, // YYYY-MM-DD
      default: null,
      trim: true,
    },
    actualLeftOn: {
      type: String, // YYYY-MM-DD
      default: null,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(STAY_STATUSES),
      default: STAY_STATUSES.ACTIVE,
      index: true,
    },
    initialRoomId: {
      type: String,
      required: true,
      trim: true,
    },
    currentRoomId: {
      type: String,
      default: null,
      trim: true,
    },
    admissionAssignmentId: {
      type: String,
      default: null,
      trim: true,
    },
    admissionAssignmentOwned: {
      type: Boolean,
      default: true,
    },
    admissionFeePlanId: {
      type: String,
      default: null,
      trim: true,
    },
    admissionFeePlanOwned: {
      type: Boolean,
      default: true,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledByRole: {
      type: String,
      default: null,
    },
    cancelReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_NOTE_LENGTH,
    },
    checkoutRequestedAt: {
      type: Date,
      default: null,
    },
    checkoutRequestedFor: {
      type: String, // YYYY-MM-DD
      default: null,
      trim: true,
    },
    checkoutRequestNote: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_NOTE_LENGTH,
    },
    checkoutFinalizedAt: {
      type: Date,
      default: null,
    },
    checkoutFinalizedByRole: {
      type: String,
      default: null,
    },
    revision: {
      type: Number,
      required: true,
      default: 0,
    },
    financialRevision: {
      type: Number,
      required: true,
      default: 0,
    },
    clearanceSequence: {
      type: Number,
      default: 0,
    },
    clearanceReviewOpenedAt: {
      type: Date,
      default: null,
    },
    clearanceReviewOpenedByRole: {
      type: String,
      default: null,
    },
    clearanceReviewReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_NOTE_LENGTH,
    },
    history: {
      type: [auditEntrySchema],
      default: [],
    },
  },
  {
    collection: 'hostel_stays',
    timestamps: true,
    strict: 'throw',
  },
);

// Partial unique index: at most ONE active/pending stay per member!
hostelStaySchema.index(
  { memberId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          STAY_STATUSES.ACTIVE,
          STAY_STATUSES.CHECKOUT_REQUESTED,
          STAY_STATUSES.CHECKOUT_PENDING,
        ],
      },
    },
    name: 'unique_active_stay_per_member',
  },
);

export const HostelStay =
  mongoose.models.HostelStay || mongoose.model('HostelStay', hostelStaySchema);

// ----------------------------------------------------
// 3. Security Deposit Account Schema
// ----------------------------------------------------
export const hostelDepositAccountSchema = new mongoose.Schema(
  {
    depositAccountId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    stayId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      index: true,
    },
    expectedDepositPaise: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_DEPOSIT_PAISE,
      default: 0,
    },
    holderType: {
      type: String,
      required: true,
      enum: Object.values(DEPOSIT_HOLDER_TYPES),
      default: DEPOSIT_HOLDER_TYPES.ADMIN_COLLECTOR,
    },
    holderName: {
      type: String,
      required: true,
      trim: true,
      default: 'Hostel Administration',
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(DEPOSIT_ACCOUNT_STATUSES),
      default: DEPOSIT_ACCOUNT_STATUSES.OPEN,
    },
    revision: {
      type: Number,
      required: true,
      default: 0,
    },
    history: {
      type: [auditEntrySchema],
      default: [],
    },
  },
  {
    collection: 'hostel_deposit_accounts',
    timestamps: true,
    strict: 'throw',
  },
);

export const HostelDepositAccount =
  mongoose.models.HostelDepositAccount ||
  mongoose.model('HostelDepositAccount', hostelDepositAccountSchema);

// ----------------------------------------------------
// 4. Security Deposit Transaction Schema
// ----------------------------------------------------
export const hostelDepositTransactionSchema = new mongoose.Schema(
  {
    depositTransactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    depositAccountId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    stayId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: Object.values(DEPOSIT_TRANSACTION_TYPES),
      index: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_DEPOSIT_PAISE,
    },
    method: {
      type: String,
      required: true,
      enum: Object.values(DEPOSIT_METHODS),
      default: DEPOSIT_METHODS.UPI,
    },
    reference: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_REFERENCE_LENGTH,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_NOTE_LENGTH,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
    recordedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    recordedByRole: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['recorded', 'voided'],
      default: 'recorded',
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    voidedByRole: {
      type: String,
      default: null,
    },
    voidReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_NOTE_LENGTH,
    },
  },
  {
    collection: 'hostel_deposit_transactions',
    timestamps: true,
    strict: 'throw',
  },
);

hostelDepositTransactionSchema.index({ stayId: 1, type: 1, status: 1 });
hostelDepositTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });

export const HostelDepositTransaction =
  mongoose.models.HostelDepositTransaction ||
  mongoose.model('HostelDepositTransaction', hostelDepositTransactionSchema);

// ----------------------------------------------------
// 5. Hostel Clearance Snapshot Schema
// ----------------------------------------------------
export const hostelClearanceSchema = new mongoose.Schema(
  {
    clearanceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    stayId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      index: true,
    },
    sequence: {
      type: Number,
      required: true,
      default: 1,
    },
    snapshotVersion: {
      type: Number,
      required: true,
      default: 1,
    },
    joinedOn: {
      type: String,
      required: true,
    },
    actualLeftOn: {
      type: String,
      required: true,
    },
    lastRoomId: {
      type: String,
      default: null,
    },
    financialAsOf: {
      type: Date,
      required: true,
      default: Date.now,
    },
    messSummary: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    roomFeeSummary: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    expenseSummary: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    depositSummary: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    outstandingObligations: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    clearanceStatus: {
      type: String,
      required: true,
      enum: Object.values(CLEARANCE_STATUSES),
    },
    exceptionReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_NOTE_LENGTH,
    },
    finalizedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    finalizedByRole: {
      type: String,
      required: true,
    },
  },
  {
    collection: 'hostel_clearances',
    timestamps: true,
    strict: 'throw',
  },
);

hostelClearanceSchema.index({ stayId: 1, sequence: 1 }, { unique: true });

export const HostelClearance =
  mongoose.models.HostelClearance ||
  mongoose.model('HostelClearance', hostelClearanceSchema);
