import { ROOM_SETTINGS_KEY, RECIPIENT_MODES, DEFAULT_DUE_DAY } from '../../src/roomFees/roomFee.constants.js';

function clone(data) {
  if (data === null || data === undefined) return data;
  return JSON.parse(JSON.stringify(data));
}

export class InMemoryRoomFeeRepository {
  constructor() {
    this.reset();
  }

  reset() {
    this.rooms = new Map();
    this.assignments = new Map();
    this.feePlans = new Map();
    this.charges = new Map();
    this.payments = new Map();
    this.settings = {
      settingsId: ROOM_SETTINGS_KEY,
      recipientMode: RECIPIENT_MODES.ADMIN_COLLECTOR,
      recipientName: 'Hostel Room Admin',
      upiId: null,
      paymentInstructions: null,
      defaultDueDay: DEFAULT_DUE_DAY,
      updatedByRole: 'system',
      updatedAt: new Date().toISOString(),
    };
  }

  // Rooms
  async createRoom(data) {
    if (this.rooms.has(data.roomId)) throw new Error('Duplicate roomId');
    const existingNum = Array.from(this.rooms.values()).find((r) => r.roomNumber === data.roomNumber.trim());
    if (existingNum) throw new Error('Duplicate roomNumber');

    const room = {
      ...clone(data),
      roomNumber: data.roomNumber.trim(),
      active: data.active ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rooms.set(room.roomId, room);
    return clone(room);
  }

  async findRoomById(roomId) {
    return clone(this.rooms.get(roomId) ?? null);
  }

  async findRoomByNumber(roomNumber) {
    const trimmed = roomNumber.trim();
    const found = Array.from(this.rooms.values()).find((r) => r.roomNumber === trimmed);
    return clone(found ?? null);
  }

  async findAllRooms({ activeOnly = false } = {}) {
    const list = Array.from(this.rooms.values())
      .filter((r) => (activeOnly ? r.active : true))
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
    return clone(list);
  }

  async updateRoom(roomId, updates) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    Object.assign(room, clone(updates), { updatedAt: new Date() });
    return clone(room);
  }

  // Assignments
  async createAssignment(data) {
    if (this.assignments.has(data.assignmentId)) throw new Error('Duplicate assignmentId');
    const assignment = {
      ...clone(data),
      assignedAt: data.assignedAt ? new Date(data.assignedAt) : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.assignments.set(assignment.assignmentId, assignment);
    return clone(assignment);
  }

  async findAssignmentById(assignmentId) {
    return clone(this.assignments.get(assignmentId) ?? null);
  }

  async findAssignmentsForMember(memberId) {
    const list = Array.from(this.assignments.values())
      .filter((a) => a.memberId === memberId)
      .sort((a, b) => b.effectiveFromMonth.localeCompare(a.effectiveFromMonth));
    return clone(list);
  }

  async findAssignmentsForRoom(roomId) {
    const list = Array.from(this.assignments.values())
      .filter((a) => a.roomId === roomId)
      .sort((a, b) => b.effectiveFromMonth.localeCompare(a.effectiveFromMonth));
    return clone(list);
  }

  async findAllAssignments() {
    const list = Array.from(this.assignments.values()).sort((a, b) =>
      b.effectiveFromMonth.localeCompare(a.effectiveFromMonth)
    );
    return clone(list);
  }

  async findActiveAssignment(memberId, month) {
    const found = Array.from(this.assignments.values()).find((a) => {
      if (a.memberId !== memberId) return false;
      if (a.effectiveFromMonth > month) return false;
      if (a.effectiveUntilMonth && a.effectiveUntilMonth < month) return false;
      return true;
    });
    return clone(found ?? null);
  }

  async deleteAssignment(assignmentId) {
    const item = this.assignments.get(assignmentId);
    if (!item) return null;
    this.assignments.delete(assignmentId);
    return clone(item);
  }

  async updateAssignment(assignmentId, updates) {
    const item = this.assignments.get(assignmentId);
    if (!item) return null;
    Object.assign(item, clone(updates), { updatedAt: new Date() });
    return clone(item);
  }

  // Fee Plans
  async createFeePlan(data) {
    if (this.feePlans.has(data.feePlanId)) throw new Error('Duplicate feePlanId');
    const plan = {
      ...clone(data),
      supersededAt: null,
      supersededBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.feePlans.set(plan.feePlanId, plan);
    return clone(plan);
  }

  async findFeePlanById(feePlanId) {
    return clone(this.feePlans.get(feePlanId) ?? null);
  }

  async findFeePlansForMember(memberId) {
    const list = Array.from(this.feePlans.values())
      .filter((p) => p.memberId === memberId)
      .sort((a, b) => b.effectiveFromMonth.localeCompare(a.effectiveFromMonth));
    return clone(list);
  }

  async findActiveFeePlan(memberId, month) {
    const plans = Array.from(this.feePlans.values())
      .filter((p) => {
        if (p.memberId !== memberId) return false;
        if (p.supersededAt) return false;
        if (p.effectiveFromMonth > month) return false;
        if (p.effectiveUntilMonth && p.effectiveUntilMonth < month) return false;
        return true;
      })
      .sort((a, b) => b.effectiveFromMonth.localeCompare(a.effectiveFromMonth));
    return clone(plans[0] ?? null);
  }

  async updateFeePlan(feePlanId, updates) {
    const plan = this.feePlans.get(feePlanId);
    if (!plan) return null;
    Object.assign(plan, clone(updates), { updatedAt: new Date() });
    return clone(plan);
  }

  // Charges
  async createCharge(data) {
    if (this.charges.has(data.chargeId)) throw new Error('Duplicate chargeId');
    const existing = Array.from(this.charges.values()).find(
      (c) => c.memberId === data.memberId && c.month === data.month && c.status !== 'cancelled'
    );
    if (existing) {
      const err = new Error('Duplicate charge for member and month');
      err.code = 11000;
      throw err;
    }

    const charge = {
      ...clone(data),
      adjustments: clone(data.adjustments || []),
      issuedAt: data.issuedAt ? new Date(data.issuedAt) : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.charges.set(charge.chargeId, charge);
    return clone(charge);
  }

  async findChargeById(chargeId) {
    return clone(this.charges.get(chargeId) ?? null);
  }

  async findChargeByMemberAndMonth(memberId, month) {
    const found = Array.from(this.charges.values()).find(
      (c) => c.memberId === memberId && c.month === month && c.status !== 'cancelled'
    );
    return clone(found ?? null);
  }

  async findChargesForMonth(month) {
    const list = Array.from(this.charges.values()).filter((c) => c.month === month && c.status !== 'cancelled');
    return clone(list);
  }

  async findChargesForMember(memberId) {
    const list = Array.from(this.charges.values())
      .filter((c) => c.memberId === memberId)
      .sort((a, b) => b.month.localeCompare(a.month));
    return clone(list);
  }

  async updateCharge(chargeId, updates) {
    const charge = this.charges.get(chargeId);
    if (!charge) return null;
    Object.assign(charge, clone(updates), { updatedAt: new Date() });
    return clone(charge);
  }

  // Payments
  async createPayment(data) {
    if (this.payments.has(data.roomPaymentId)) throw new Error('Duplicate roomPaymentId');
    const existingKey = Array.from(this.payments.values()).find((p) => p.idempotencyKey === data.idempotencyKey);
    if (existingKey) {
      const err = new Error('Duplicate idempotencyKey');
      err.code = 11000;
      throw err;
    }

    const payment = {
      ...clone(data),
      recordedAt: data.recordedAt ? new Date(data.recordedAt) : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.payments.set(payment.roomPaymentId, payment);
    return clone(payment);
  }

  async findPaymentById(roomPaymentId) {
    return clone(this.payments.get(roomPaymentId) ?? null);
  }

  async findPaymentByIdempotencyKey(idempotencyKey) {
    const found = Array.from(this.payments.values()).find((p) => p.idempotencyKey === idempotencyKey);
    return clone(found ?? null);
  }

  async findPaymentsForCharge(chargeId) {
    const list = Array.from(this.payments.values())
      .filter((p) => p.chargeId === chargeId)
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
    return clone(list);
  }

  async findPaymentsForMonth(month) {
    const list = Array.from(this.payments.values())
      .filter((p) => p.month === month)
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
    return clone(list);
  }

  async findPaymentsForMember(memberId) {
    const list = Array.from(this.payments.values())
      .filter((p) => p.memberId === memberId)
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
    return clone(list);
  }

  async findAllPayments({ limit = 100 } = {}) {
    const list = Array.from(this.payments.values())
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
      .slice(0, limit);
    return clone(list);
  }

  async updatePayment(roomPaymentId, updates) {
    const payment = this.payments.get(roomPaymentId);
    if (!payment) return null;
    Object.assign(payment, clone(updates), { updatedAt: new Date() });
    return clone(payment);
  }

  // Settings
  async getPaymentSettings() {
    return clone(this.settings);
  }

  async updatePaymentSettings(updates) {
    Object.assign(this.settings, clone(updates), { updatedAt: new Date().toISOString() });
    return clone(this.settings);
  }
}
