import { Room } from './room.model.js';
import { RoomAssignment } from './roomAssignment.model.js';
import { RoomFeePlan } from './roomFeePlan.model.js';
import { RoomCharge } from './roomCharge.model.js';
import { RoomPayment } from './roomPayment.model.js';
import { RoomPaymentSettings } from './roomPaymentSettings.model.js';
import { ROOM_SETTINGS_KEY } from './roomFee.constants.js';

export const roomRepository = {
  // Rooms
  async createRoom(data) {
    return Room.create(data);
  },

  async findRoomById(roomId) {
    return Room.findOne({ roomId }).lean();
  },

  async findRoomByNumber(roomNumber) {
    return Room.findOne({ roomNumber: roomNumber.trim() }).lean();
  },

  async findAllRooms({ activeOnly = false } = {}) {
    const query = activeOnly ? { active: true } : {};
    return Room.find(query).sort({ roomNumber: 1 }).lean();
  },

  async updateRoom(roomId, updates) {
    return Room.findOneAndUpdate({ roomId }, { $set: updates }, { new: true, runValidators: true }).lean();
  },

  // Assignments
  async createAssignment(data) {
    return RoomAssignment.create(data);
  },

  async findAssignmentById(assignmentId) {
    return RoomAssignment.findOne({ assignmentId }).lean();
  },

  async findAssignmentsForMember(memberId) {
    return RoomAssignment.find({ memberId }).sort({ effectiveFromMonth: -1 }).lean();
  },

  async findAssignmentsForRoom(roomId) {
    return RoomAssignment.find({ roomId }).sort({ effectiveFromMonth: -1 }).lean();
  },

  async findAllAssignments() {
    return RoomAssignment.find({}).sort({ effectiveFromMonth: -1 }).lean();
  },

  async findActiveAssignment(memberId, month) {
    return RoomAssignment.findOne({
      memberId,
      effectiveFromMonth: { $lte: month },
      $or: [{ effectiveUntilMonth: null }, { effectiveUntilMonth: { $gte: month } }],
    }).lean();
  },

  async deleteAssignment(assignmentId) {
    return RoomAssignment.findOneAndDelete({ assignmentId }).lean();
  },

  async updateAssignment(assignmentId, updates) {
    return RoomAssignment.findOneAndUpdate({ assignmentId }, { $set: updates }, { new: true, runValidators: true }).lean();
  },

  // Fee Plans
  async createFeePlan(data) {
    return RoomFeePlan.create(data);
  },

  async findFeePlanById(feePlanId) {
    return RoomFeePlan.findOne({ feePlanId }).lean();
  },

  async findFeePlansForMember(memberId) {
    return RoomFeePlan.find({ memberId }).sort({ effectiveFromMonth: -1 }).lean();
  },

  async findActiveFeePlan(memberId, month) {
    return RoomFeePlan.findOne({
      memberId,
      effectiveFromMonth: { $lte: month },
      $or: [{ effectiveUntilMonth: null }, { effectiveUntilMonth: { $gte: month } }],
      supersededAt: null,
    }).sort({ effectiveFromMonth: -1 }).lean();
  },

  async updateFeePlan(feePlanId, updates) {
    return RoomFeePlan.findOneAndUpdate({ feePlanId }, { $set: updates }, { new: true, runValidators: true }).lean();
  },

  // Charges
  async createCharge(data) {
    return RoomCharge.create(data);
  },

  async findChargeById(chargeId) {
    return RoomCharge.findOne({ chargeId }).lean();
  },

  async findChargeByMemberAndMonth(memberId, month) {
    return RoomCharge.findOne({ memberId, month }).lean();
  },

  async findChargesForMonth(month) {
    return RoomCharge.find({ month }).lean();
  },

  async findChargesForMember(memberId) {
    return RoomCharge.find({ memberId }).sort({ month: -1 }).lean();
  },

  async updateCharge(chargeId, updates) {
    return RoomCharge.findOneAndUpdate({ chargeId }, { $set: updates }, { new: true, runValidators: true }).lean();
  },

  // Payments
  async createPayment(data) {
    return RoomPayment.create(data);
  },

  async findPaymentById(roomPaymentId) {
    return RoomPayment.findOne({ roomPaymentId }).lean();
  },

  async findPaymentByIdempotencyKey(idempotencyKey) {
    return RoomPayment.findOne({ idempotencyKey }).lean();
  },

  async findPaymentsForCharge(chargeId) {
    return RoomPayment.find({ chargeId }).sort({ recordedAt: -1 }).lean();
  },

  async findPaymentsForMonth(month) {
    return RoomPayment.find({ month }).sort({ recordedAt: -1 }).lean();
  },

  async findPaymentsForMember(memberId) {
    return RoomPayment.find({ memberId }).sort({ recordedAt: -1 }).lean();
  },

  async findAllPayments({ limit = 100 } = {}) {
    return RoomPayment.find({}).sort({ recordedAt: -1 }).limit(limit).lean();
  },

  async updatePayment(roomPaymentId, updates) {
    return RoomPayment.findOneAndUpdate({ roomPaymentId }, { $set: updates }, { new: true, runValidators: true }).lean();
  },

  // Settings
  async getPaymentSettings() {
    return RoomPaymentSettings.findOneAndUpdate(
      { settingsId: ROOM_SETTINGS_KEY },
      { $setOnInsert: { settingsId: ROOM_SETTINGS_KEY } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async updatePaymentSettings(updates) {
    return RoomPaymentSettings.findOneAndUpdate(
      { settingsId: ROOM_SETTINGS_KEY },
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    ).lean();
  },
};
