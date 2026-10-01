import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';
import { ROLES } from './permissions.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function hasBcryptCost12(value) {
  if (typeof value !== 'string' || !bcryptHashPattern.test(value)) {
    return false;
  }

  try {
    return bcrypt.getRounds(value) === 12;
  } catch {
    return false;
  }
}

const userAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
    },
    memberId: {
      type: String,
      default: null,
      validate: {
        validator(val) {
          if (val === null || val === undefined) return true;
          return MEMBER_IDS.includes(val);
        },
        message: 'memberId must be one of the configured member IDs or null',
      },
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      validate: {
        validator: (value) => emailPattern.test(value),
        message: 'email must be a valid email address',
      },
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
      validate: {
        validator: hasBcryptCost12,
        message: 'passwordHash must be a valid bcrypt hash with cost factor 12',
      },
    },
    role: {
      type: String,
      required: true,
      enum: [ROLES.MEMBER, ROLES.ADMIN, ROLES.SUPERADMIN],
      index: true,
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
    sessionVersion: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'user_accounts',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

userAccountSchema.index(
  { memberId: 1 },
  {
    unique: true,
    partialFilterExpression: { memberId: { $type: 'string' } },
  },
);

export const UserAccount =
  mongoose.models.UserAccount ?? mongoose.model('UserAccount', userAccountSchema);
