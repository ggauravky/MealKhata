import mongoose from 'mongoose';
import { ROLES } from '../auth/permissions.js';
import { MEMBER_IDS } from '../config/members.js';
import { isValidLogicalMonth } from '../utils/month.js';
import {
  isValidPaymentAmount,
  isValidUuid,
  MAX_RECEIVER_NAME_LENGTH,
  MAX_UPI_ID_LENGTH,
  MAX_UPI_REFERENCE_LENGTH,
  MAX_VOID_REASON_LENGTH,
  PAYMENT_ENTRY_STATUSES,
  PAYMENT_METHODS,
} from './payment.constants.js';

const immutable = true;

const payeeSnapshotSchema = new mongoose.Schema(
  {
    receiverName: { type: String, required: true, maxlength: MAX_RECEIVER_NAME_LENGTH, immutable },
    upiId: { type: String, required: false, default: null, maxlength: MAX_UPI_ID_LENGTH, immutable },
    receiverMobile: { type: String, required: false, default: null, immutable },
  },
  { _id: false, strict: 'throw' },
);

const paymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, immutable, unique: true, validate: isValidUuid },
    month: { type: String, required: true, immutable, validate: isValidLogicalMonth },
    memberId: { type: String, required: true, immutable, enum: MEMBER_IDS },
    amountPaise: { type: Number, required: true, immutable, validate: isValidPaymentAmount },
    method: { type: String, required: true, immutable, enum: PAYMENT_METHODS },
    upiReference: { type: String, required: false, default: null, immutable, maxlength: MAX_UPI_REFERENCE_LENGTH },
    billAmountAtPaymentPaise: { type: Number, required: true, immutable, min: 0, validate: Number.isSafeInteger },
    periodTypeAtPayment: { type: String, required: true, immutable, enum: ['past', 'current'] },
    payeeSnapshot: { type: payeeSnapshotSchema, required: true, immutable },
    recordedAt: { type: Date, required: true, immutable },
    recordedByRole: { type: String, required: true, immutable, enum: [ROLES.ADMIN, ROLES.SUPERADMIN] },
    idempotencyKey: { type: String, required: true, immutable, unique: true, validate: isValidUuid },
    status: { type: String, required: true, enum: PAYMENT_ENTRY_STATUSES, default: 'recorded' },
    voidedAt: { type: Date, required: false, default: null },
    voidedByRole: { type: String, required: false, default: null, enum: [ROLES.SUPERADMIN, null] },
    voidReason: { type: String, required: false, default: null, maxlength: MAX_VOID_REASON_LENGTH },
  },
  {
    collection: 'payments',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

paymentSchema.index({ month: 1, memberId: 1 });

export const Payment = mongoose.models.Payment ?? mongoose.model('Payment', paymentSchema);
