import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';

export const roomFeeScheduleStateSchema = new mongoose.Schema(
  {
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      unique: true,
    },
    revision: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    lastChangedAt: {
      type: Date,
      default: null,
    },
    lastChangedByRole: {
      type: String,
      default: null,
    },
  },
  {
    collection: 'room_fee_schedule_states',
    timestamps: true,
    strict: 'throw',
  },
);

export const RoomFeeScheduleState = mongoose.models.RoomFeeScheduleState
  || mongoose.model('RoomFeeScheduleState', roomFeeScheduleStateSchema);
