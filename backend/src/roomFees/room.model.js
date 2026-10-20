import mongoose from 'mongoose';
import {
  DEFAULT_ROOM_CAPACITY,
  MAX_ROOM_CAPACITY,
  MAX_ROOM_LABEL_LENGTH,
  MAX_ROOM_NUMBER_LENGTH,
  MIN_ROOM_CAPACITY,
} from './roomFee.constants.js';

export const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
    },
    roomNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: MAX_ROOM_NUMBER_LENGTH,
    },
    roomLabel: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_ROOM_LABEL_LENGTH,
    },
    capacity: {
      type: Number,
      required: true,
      min: MIN_ROOM_CAPACITY,
      max: MAX_ROOM_CAPACITY,
      default: DEFAULT_ROOM_CAPACITY,
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
    },
    occupancyRevision: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  {
    collection: 'rooms',
    timestamps: true,
    strict: 'throw',
  },
);

roomSchema.index({ active: 1 });

export const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);
