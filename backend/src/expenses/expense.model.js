import mongoose from 'mongoose';
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES, SPLIT_TYPES } from './expense.constants.js';

const expenseAllocationSchema = new mongoose.Schema(
  {
    memberId: {
      type: String,
      required: true,
      trim: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false },
);

const expenseSchema = new mongoose.Schema(
  {
    expenseId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    month: {
      type: String,
      required: true,
      index: true,
      match: /^\d{4}-\d{2}$/,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    category: {
      type: String,
      required: true,
      enum: EXPENSE_CATEGORIES,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
    },
    paidByMemberId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    splitType: {
      type: String,
      required: true,
      enum: SPLIT_TYPES,
      default: 'equal',
    },
    allocations: {
      type: [expenseAllocationSchema],
      required: true,
      validate: {
        validator(allocs) {
          return Array.isArray(allocs) && allocs.length > 0;
        },
        message: 'Expense must have at least one member allocation',
      },
    },
    status: {
      type: String,
      required: true,
      enum: [EXPENSE_STATUSES.RECORDED, EXPENSE_STATUSES.VOIDED],
      default: EXPENSE_STATUSES.RECORDED,
      index: true,
    },
    idempotencyKey: {
      type: String,
      sparse: true,
      unique: true,
      index: true,
      trim: true,
    },
    createdByRole: {
      type: String,
      required: true,
      enum: ['admin', 'superadmin'],
    },
    createdByMemberId: {
      type: String,
      default: null,
      trim: true,
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
    revision: {
      type: String,
      required: true,
      default: () => new Date().toISOString(),
    },
  },
  {
    timestamps: true,
    collection: 'expenses',
  },
);

// Compound indexes for query efficiency and member isolation
expenseSchema.index({ month: 1, date: -1 });
expenseSchema.index({ paidByMemberId: 1, month: 1 });
expenseSchema.index({ 'allocations.memberId': 1, month: 1 });

export const Expense = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
