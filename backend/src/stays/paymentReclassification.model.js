import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';
import { DEPOSIT_METHODS, MAX_DEPOSIT_PAISE, MAX_NOTE_LENGTH, MAX_REFERENCE_LENGTH } from './stay.constants.js';

const allocationSchema = new mongoose.Schema(
  {
    allocationId: { type: String, required: true },
    category: { type: String, required: true, enum: ['UNALLOCATED_CREDIT'] },
    memberId: { type: String, required: true, enum: MEMBER_IDS },
    targetAccount: { type: String, required: true, trim: true, maxlength: 120 },
    amountPaise: { type: Number, required: true, min: 1, max: MAX_DEPOSIT_PAISE },
    destinationRecordId: { type: String, required: true, trim: true },
  },
  { _id: false, strict: 'throw' },
);

const paymentReclassificationSchema = new mongoose.Schema(
  {
    reclassificationId: { type: String, required: true, unique: true, trim: true },
    sourceDepositTransactionId: { type: String, required: true, unique: true, trim: true },
    sourceDepositAccountId: { type: String, required: true, trim: true, index: true },
    sourceStayId: { type: String, required: true, trim: true, index: true },
    memberId: { type: String, required: true, enum: MEMBER_IDS, index: true },
    amountPaise: { type: Number, required: true, min: 1, max: MAX_DEPOSIT_PAISE },
    paymentDate: { type: Date, required: true },
    paymentMethod: { type: String, required: true, enum: Object.values(DEPOSIT_METHODS) },
    reference: { type: String, default: null, trim: true, maxlength: MAX_REFERENCE_LENGTH },
    allocations: { type: [allocationSchema], required: true },
    reason: { type: String, required: true, trim: true, maxlength: MAX_NOTE_LENGTH },
    idempotencyKey: { type: String, required: true, unique: true, trim: true },
    requestFingerprint: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ['COMPLETED'], default: 'COMPLETED' },
    completedAt: { type: Date, required: true, default: Date.now },
    completedByRole: { type: String, required: true },
  },
  { collection: 'payment_reclassifications', timestamps: true, strict: 'throw' },
);

const creditHistorySchema = new mongoose.Schema(
  {
    event: { type: String, required: true },
    timestamp: { type: Date, required: true, default: Date.now },
    actorRole: { type: String, required: true },
    note: { type: String, required: true, trim: true, maxlength: MAX_NOTE_LENGTH },
  },
  { _id: false, strict: 'throw' },
);

const unallocatedCreditSchema = new mongoose.Schema(
  {
    creditId: { type: String, required: true, unique: true, trim: true },
    reclassificationId: { type: String, required: true, trim: true, index: true },
    allocationId: { type: String, required: true, unique: true, trim: true },
    sourceDepositTransactionId: { type: String, required: true, trim: true, index: true },
    memberId: { type: String, required: true, enum: MEMBER_IDS, index: true },
    targetAccount: { type: String, required: true, trim: true, maxlength: 120 },
    amountPaise: { type: Number, required: true, min: 1, max: MAX_DEPOSIT_PAISE },
    remainingAmountPaise: { type: Number, required: true, min: 0, max: MAX_DEPOSIT_PAISE },
    paymentDate: { type: Date, required: true },
    paymentMethod: { type: String, required: true, enum: Object.values(DEPOSIT_METHODS) },
    reference: { type: String, default: null, trim: true, maxlength: MAX_REFERENCE_LENGTH },
    status: { type: String, required: true, enum: ['OPEN', 'ALLOCATED'], default: 'OPEN' },
    history: { type: [creditHistorySchema], default: [] },
  },
  { collection: 'unallocated_credits', timestamps: true, strict: 'throw' },
);

export const PaymentReclassification =
  mongoose.models.PaymentReclassification
  || mongoose.model('PaymentReclassification', paymentReclassificationSchema);

export const UnallocatedCredit =
  mongoose.models.UnallocatedCredit
  || mongoose.model('UnallocatedCredit', unallocatedCreditSchema);
