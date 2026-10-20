import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';

export const roomAssignmentSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: String,
      required: true,
      unique: true,
    },
    roomId: {
      type: String,
      required: true,
      index: true,
    },
    memberId: {
      type: String,
      required: true,
      enum: MEMBER_IDS,
      index: true,
    },
    effectiveFromMonth: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/,
    },
    effectiveUntilMonth: {
      type: String,
      default: null,
      validate: {
        validator(v) {
          return v === null || /^\d{4}-\d{2}$/.test(v);
        },
        message: 'effectiveUntilMonth must be in YYYY-MM format or null',
      },
    },
    effectiveFromDate: {
      type: String,
      default: null,
      validate: {
        validator(v) {
          return v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);
        },
        message: 'effectiveFromDate must be in YYYY-MM-DD format or null',
      },
    },
    effectiveUntilDate: {
      type: String,
      default: null,
      validate: {
        validator(v) {
          return v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);
        },
        message: 'effectiveUntilDate must be in YYYY-MM-DD format or null',
      },
    },
    assignedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    assignedByRole: {
      type: String,
      required: true,
    },
  },
  {
    collection: 'room_assignments',
    timestamps: true,
    strict: 'throw',
  },
);

roomAssignmentSchema.index({ memberId: 1, effectiveFromMonth: 1 });
roomAssignmentSchema.index({ roomId: 1, effectiveFromMonth: 1 });

export const RoomAssignment =
  mongoose.models.RoomAssignment || mongoose.model('RoomAssignment', roomAssignmentSchema);
