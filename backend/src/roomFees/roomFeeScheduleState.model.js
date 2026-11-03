import mongoose from 'mongoose';
import { isSafeStudentId } from '../students/studentId.js';

export const roomFeeScheduleStateSchema = new mongoose.Schema(
  {
    memberId: {
      type: String,
      required: true,
      validate: isSafeStudentId,
      unique: true,
    },
    revision: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    assignmentRevision: {
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
    assignmentLastChangedAt: {
      type: Date,
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
