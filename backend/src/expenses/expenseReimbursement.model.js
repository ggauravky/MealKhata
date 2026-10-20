import mongoose from 'mongoose';
import { REIMBURSEMENT_METHODS, REIMBURSEMENT_STATUSES } from './expense.constants.js';

const expenseReimbursementSchema = new mongoose.Schema(
  {
    reimbursementId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    expenseId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    expenseMonth: {
      type: String,
      required: true,
      index: true,
      match: /^\d{4}-\d{2}$/,
    },
    fromMemberId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    toMemberId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
    },
    method: {
      type: String,
      required: true,
      enum: REIMBURSEMENT_METHODS,
      default: 'upi',
    },
    reference: {
      type: String,
      trim: true,
      default: null,
      maxlength: 120,
    },
    idempotencyKey: {
      type: String,
      sparse: true,
      unique: true,
      index: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: [REIMBURSEMENT_STATUSES.RECORDED, REIMBURSEMENT_STATUSES.VOIDED],
      default: REIMBURSEMENT_STATUSES.RECORDED,
      index: true,
    },
    recordedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    recordedByRole: {
      type: String,
      required: true,
      enum: ['admin', 'superadmin'],
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
      maxlength: 300,
    },
  },
  {
    timestamps: true,
    collection: 'expense_reimbursements',
  },
);

expenseReimbursementSchema.index({ expenseId: 1, status: 1 });
expenseReimbursementSchema.index({ fromMemberId: 1, expenseMonth: 1 });
expenseReimbursementSchema.index({ toMemberId: 1, expenseMonth: 1 });

export const ExpenseReimbursement =
  mongoose.models.ExpenseReimbursement ||
  mongoose.model('ExpenseReimbursement', expenseReimbursementSchema);
