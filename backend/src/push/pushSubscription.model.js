import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';

const pushSubscriptionSchema = new mongoose.Schema(
  {
    subscriptionId: {
      type: String,
      required: true,
      unique: true,
      default: () => randomUUID(),
      immutable: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    keys: {
      p256dh: {
        type: String,
        required: true,
        trim: true,
      },
      auth: {
        type: String,
        required: true,
        trim: true,
      },
    },
    expirationTime: {
      type: Number,
      default: null,
    },
    preferences: {
      morning: {
        type: Boolean,
        default: true,
      },
      night: {
        type: Boolean,
        default: true,
      },
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    userAgent: {
      type: String,
      default: null,
      maxlength: 500,
    },
    lastSuccessAt: {
      type: Date,
      default: null,
    },
    lastFailureAt: {
      type: Date,
      default: null,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
  },
  {
    collection: 'push_subscriptions',
    timestamps: true,
    strict: 'throw',
  },
);

pushSubscriptionSchema.index({ memberId: 1, active: 1 });

export const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
