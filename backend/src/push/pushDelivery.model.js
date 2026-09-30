import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';

const pushDeliverySchema = new mongoose.Schema(
  {
    dispatchKey: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      index: true,
    },
    mealType: {
      type: String,
      required: true,
      enum: ['morning', 'night'],
    },
    logicalDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    subscriptionId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['claimed', 'sent', 'failed', 'gone'],
      default: 'claimed',
    },
    error: {
      type: String,
      default: null,
      maxlength: 500,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: '60d', // 60-day operational TTL
    },
  },
  {
    collection: 'push_deliveries',
    timestamps: false,
    strict: 'throw',
  },
);

pushDeliverySchema.index({ logicalDate: 1, mealType: 1, memberId: 1 });

export const PushDelivery = mongoose.model('PushDelivery', pushDeliverySchema);
