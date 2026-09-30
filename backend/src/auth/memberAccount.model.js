import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';

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

const memberAccountSchema = new mongoose.Schema(
  {
    memberId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      enum: MEMBER_IDS,
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
      validate: {
        validator: hasBcryptCost12,
        message: 'passwordHash must be a valid bcrypt hash with cost factor 12',
      },
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  {
    collection: 'member_accounts',
    strict: 'throw',
    timestamps: true,
    versionKey: false,
  },
);

export const MemberAccount =
  mongoose.models.MemberAccount ?? mongoose.model('MemberAccount', memberAccountSchema);
