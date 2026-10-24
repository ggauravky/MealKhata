import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Room } from './room.model.js';
import { RoomAssignment } from './roomAssignment.model.js';
import { RoomFeePlan } from './roomFeePlan.model.js';
import { RoomCharge } from './roomCharge.model.js';
import { RoomPayment } from './roomPayment.model.js';
import { RoomPaymentSettings } from './roomPaymentSettings.model.js';
import { ROOM_SETTINGS_KEY } from './roomFee.constants.js';
import { selectAssignmentForDate, selectAssignmentForMonth } from './assignmentResolution.js';
import { guardFinancialMutation } from '../finance/financialMutationGuard.js';

export const roomRepository = {
  requiresTransactions: true,

  // Rooms
  async createRoom(data) {
    return Room.create(data);
  },

  async findRoomById(roomId, { session } = {}) {
    const q = Room.findOne({ roomId });
    if (session) q.session(session);
    return q.lean();
  },

  async findRoomByNumber(roomNumber, { session } = {}) {
    const q = Room.findOne({ roomNumber: roomNumber.trim() });
    if (session) q.session(session);
    return q.lean();
  },

  async findAllRooms({ activeOnly = false, session = null } = {}) {
    const query = activeOnly ? { active: true } : {};
    const q = Room.find(query).sort({ roomNumber: 1 });
    if (session) q.session(session);
    return q.lean();
  },

  async updateRoom(roomId, updates, { session } = {}) {
    const opts = { returnDocument: 'after', runValidators: true };
    if (session) opts.session = session;
    const updateDoc = updates.$set || updates.$inc ? updates : { $set: updates };
    return Room.findOneAndUpdate({ roomId }, updateDoc, opts).lean();
  },

  // Assignments
  async createAssignment(data, { session } = {}) {
    if (session) {
      const res = await RoomAssignment.create([data], { session });
      return res[0].toObject();
    }
    return RoomAssignment.create(data);
  },

  async findAssignmentById(assignmentId, { session } = {}) {
    const q = RoomAssignment.findOne({ assignmentId });
    if (session) q.session(session);
    return q.lean();
  },

  async findAssignmentsForMember(memberId, { session } = {}) {
    const q = RoomAssignment.find({ memberId }).sort({ effectiveFromMonth: -1 });
    if (session) q.session(session);
    return q.lean();
  },

  async findAssignmentsForRoom(roomId, { session } = {}) {
    const q = RoomAssignment.find({ roomId }).sort({ effectiveFromMonth: -1 });
    if (session) q.session(session);
    return q.lean();
  },

  async findAllAssignments() {
    return RoomAssignment.find({}).sort({ effectiveFromMonth: -1 }).lean();
  },

  async findActiveAssignment(memberId, month, { session } = {}) {
    const q = RoomAssignment.find({ memberId });
    if (session) q.session(session);
    const assignments = await q.lean();
    return selectAssignmentForMonth(assignments, memberId, month);
  },

  async findAssignmentOnDate(memberId, date, { session } = {}) {
    const q = RoomAssignment.find({ memberId });
    if (session) q.session(session);
    const assignments = await q.lean();
    return selectAssignmentForDate(assignments, memberId, date);
  },

  async deleteAssignment(assignmentId) {
    return RoomAssignment.findOneAndDelete({ assignmentId }).lean();
  },

  async updateAssignment(assignmentId, updates, { session } = {}) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return RoomAssignment.findOneAndUpdate({ assignmentId }, { $set: updates }, options).lean();
  },

  // Fee Plans
  async createFeePlan(data, { session } = {}) {
    if (session) {
      const res = await RoomFeePlan.create([data], { session });
      return res[0].toObject();
    }
    return RoomFeePlan.create(data);
  },

  async findFeePlanById(feePlanId, { session } = {}) {
    const q = RoomFeePlan.findOne({ feePlanId });
    if (session) q.session(session);
    return q.lean();
  },

  async findFeePlansForMember(memberId, { session } = {}) {
    const q = RoomFeePlan.find({ memberId }).sort({ effectiveFromMonth: -1 });
    if (session) q.session(session);
    return q.lean();
  },

  async findActiveFeePlan(memberId, month, { session } = {}) {
    const q = RoomFeePlan.findOne({
      memberId,
      effectiveFromMonth: { $lte: month },
      $or: [{ effectiveUntilMonth: null }, { effectiveUntilMonth: { $gte: month } }],
      supersededAt: null,
    }).sort({ effectiveFromMonth: -1 });
    if (session) q.session(session);
    return q.lean();
  },

  async updateFeePlan(feePlanId, updates, { session } = {}) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return RoomFeePlan.findOneAndUpdate({ feePlanId }, { $set: updates }, options).lean();
  },

  // Charges
  async createCharge(data, { session } = {}) {
    if (session) {
      const res = await RoomCharge.create([data], { session });
      return res[0].toObject();
    }
    return RoomCharge.create(data);
  },

  async findChargeById(chargeId) {
    return RoomCharge.findOne({ chargeId }).lean();
  },

  async findChargeByMemberAndMonth(memberId, month, { session } = {}) {
    const q = RoomCharge.findOne({ memberId, month });
    if (session) q.session(session);
    return q.lean();
  },

  async findChargesForMonth(month) {
    return RoomCharge.find({ month }).lean();
  },

  async findChargesForMember(memberId) {
    return RoomCharge.find({ memberId }).sort({ month: -1 }).lean();
  },

  async updateCharge(chargeId, updates, { session } = {}) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return RoomCharge.findOneAndUpdate({ chargeId }, { $set: updates }, options).lean();
  },

  // Payments
  async createPayment(data, { session } = {}) {
    if (session) {
      const res = await RoomPayment.create([data], { session });
      return res[0].toObject();
    }
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

  async updatePayment(roomPaymentId, updates, { session } = {}) {
    const options = { returnDocument: 'after', runValidators: true };
    if (session) options.session = session;
    return RoomPayment.findOneAndUpdate({ roomPaymentId }, { $set: updates }, options).lean();
  },

  // Atomic Room Payment with Session Concurrency Guard
  async executeAtomicRoomPayment({
    chargeId,
    memberId,
    month,
    amountPaise,
    method,
    reference,
    recipientSnapshot,
    idempotencyKey,
    actorRole,
  }) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const maxRetries = 5;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let session = null;
        try {
          session = await mongoose.startSession();
          session.startTransaction();

          // 1. Fetch charge with session
          const charge = await RoomCharge.findOne({ chargeId }).session(session);
          if (!charge) {
            const err = new Error('Room charge not found.');
            err.statusCode = 404;
            throw err;
          }

          if (charge.status === 'cancelled') {
            const err = new Error('Cannot record payment against a cancelled room charge.');
            err.statusCode = 400;
            throw err;
          }

          const targetMemberId = memberId || charge.memberId;
          const targetMonth = month || charge.month;

          if (memberId && charge.memberId !== memberId) {
            const err = new Error('Charge member or month does not match payment payload.');
            err.statusCode = 400;
            throw err;
          }
          if (month && charge.month !== month) {
            const err = new Error('Charge member or month does not match payment payload.');
            err.statusCode = 400;
            throw err;
          }

          await guardFinancialMutation({
            memberId: targetMemberId,
            effectiveMonth: targetMonth,
            actorRole,
            session,
          });

          // 2. Check idempotency within transaction session
          const existingKey = await RoomPayment.findOne({ idempotencyKey }).session(session);
          if (existingKey) {
            const isMatch =
              existingKey.chargeId === chargeId &&
              existingKey.memberId === targetMemberId &&
              existingKey.month === targetMonth &&
              existingKey.amountPaise === amountPaise &&
              existingKey.method === method;

            if (!isMatch) {
              const err = new Error('Idempotency key reused with conflicting payment payload.');
              err.statusCode = 409;
              throw err;
            }
            await session.commitTransaction();
            return existingKey.toObject();
          }

          // 3. Concurrency guard: serialize concurrent payments on this charge
          await RoomCharge.updateOne(
            { chargeId },
            { $inc: { __v: 1 } },
            { session },
          );

          // 4. Compute remaining balance within session
          const activePayments = await RoomPayment.find({ chargeId, status: 'verified' }).session(session);
          const alreadyPaid = activePayments.reduce((sum, p) => sum + p.amountPaise, 0);
          const adjustmentsTotal = (charge.adjustments || []).reduce((sum, a) => sum + a.amountPaise, 0);
          const finalBillPaise = Math.max(0, charge.baseAmountPaise + adjustmentsTotal);
          const remainingPaise = Math.max(0, finalBillPaise - alreadyPaid);

          if (amountPaise > remainingPaise) {
            const err = new Error(`Payment amount (₹${(amountPaise / 100).toFixed(2)}) exceeds remaining balance of ₹${(remainingPaise / 100).toFixed(2)}.`);
            err.statusCode = 400;
            throw err;
          }

          // 4. Create verified payment within session
          const roomPaymentId = randomUUID();
          const paymentData = {
            roomPaymentId,
            chargeId,
            memberId: targetMemberId,
            month: targetMonth,
            amountPaise,
            method,
            reference,
            recipientSnapshot,
            idempotencyKey,
            recordedAt: new Date(),
            recordedByRole: actorRole,
            status: 'verified',
          };

          const created = await RoomPayment.create([paymentData], { session });
          await session.commitTransaction();
          return created[0].toObject();
        } catch (err) {
          if (session && session.inTransaction()) {
            await session.abortTransaction();
          }
          const isTransient =
            err.errorLabels?.has?.('TransientTransactionError') ||
            err.errorLabelSet?.has?.('TransientTransactionError') ||
            err.code === 112 ||
            (typeof err.message === 'string' && (err.message.includes('WriteConflict') || err.message.includes('catalog changes')));

          if (isTransient && attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            continue;
          }

          if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
            const error = new Error('Financial transaction unavailable. Database transaction support is required.');
            error.statusCode = 503;
            throw error;
          }
          throw err;
        } finally {
          if (session) {
            await session.endSession();
          }
        }
      }
    }

    const err = new Error('Financial transaction unavailable. Database connection required.');
    err.statusCode = 503;
    throw err;
  },

  // Atomic Charge Adjustment with optimistic concurrency or session
  async atomicAdjustCharge({ chargeId, numAmount, reason, actorRole }) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const maxRetries = 5;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let session = null;
        try {
          session = await mongoose.startSession();
          session.startTransaction();

          const charge = await RoomCharge.findOne({ chargeId }).session(session);
          if (!charge) {
            const err = new Error('Room charge not found.');
            err.statusCode = 404;
            throw err;
          }
          if (charge.status === 'cancelled') {
            const err = new Error('Cannot adjust a cancelled room charge.');
            err.statusCode = 400;
            throw err;
          }

          await guardFinancialMutation({
            memberId: charge.memberId,
            effectiveMonth: charge.month,
            actorRole,
            session,
          });

          const currentAdjustments = charge.adjustments || [];
          const currentTotal = currentAdjustments.reduce((sum, a) => sum + a.amountPaise, 0);
          const newFinalBill = charge.baseAmountPaise + currentTotal + numAmount;
          if (newFinalBill < 0) {
            const err = new Error(`Adjustment cannot reduce the total charge below ₹0 (current: ₹${(charge.baseAmountPaise + currentTotal) / 100}).`);
            err.statusCode = 400;
            throw err;
          }

          const adjustment = {
            adjustmentId: randomUUID(),
            amountPaise: numAmount,
            reason: reason.trim(),
            createdAt: new Date(),
            createdByRole: actorRole,
          };

          charge.adjustments.push(adjustment);
          await charge.save({ session });
          await session.commitTransaction();
          return charge.toObject();
        } catch (err) {
          if (session && session.inTransaction()) {
            await session.abortTransaction();
          }
          const isTransient =
            err.errorLabels?.has?.('TransientTransactionError') ||
            err.errorLabelSet?.has?.('TransientTransactionError') ||
            err.code === 112 ||
            (typeof err.message === 'string' && (err.message.includes('WriteConflict') || err.message.includes('catalog changes')));

          if (isTransient && attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            continue;
          }

          if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
            const error = new Error('Financial transaction unavailable. Database transaction support is required.');
            error.statusCode = 503;
            throw error;
          }
          throw err;
        } finally {
          if (session) {
            await session.endSession();
          }
        }
      }
    }

    const err = new Error('Financial transaction unavailable. Database connection required.');
    err.statusCode = 503;
    throw err;
  },

  async executeAtomicCancelCharge({ chargeId, reason, actorRole }) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const maxRetries = 5;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let session = null;
        try {
          session = await mongoose.startSession();
          session.startTransaction();

          const charge = await RoomCharge.findOne({ chargeId }).session(session);
          if (!charge) {
            const err = new Error('Room charge not found.');
            err.statusCode = 404;
            throw err;
          }
          if (charge.status === 'cancelled') {
            const err = new Error('Room charge is already cancelled.');
            err.statusCode = 400;
            throw err;
          }

          await guardFinancialMutation({
            memberId: charge.memberId,
            effectiveMonth: charge.month,
            actorRole,
            session,
          });

          // Guard / touch charge revision to conflict with concurrent payments
          await RoomCharge.updateOne(
            { chargeId },
            { $inc: { __v: 1 } },
            { session },
          );

          // Check active payments within session
          const activePayments = await RoomPayment.find({ chargeId, status: 'verified' }).session(session);
          if (activePayments.length > 0) {
            const err = new Error('Cannot cancel a charge with active recorded payments. Void the payments first.');
            err.statusCode = 409;
            throw err;
          }

          charge.status = 'cancelled';
          charge.cancelledAt = new Date();
          charge.cancelReason = reason;
          await charge.save({ session });

          await session.commitTransaction();
          return charge.toObject();
        } catch (err) {
          if (session && session.inTransaction()) {
            await session.abortTransaction();
          }
          const isTransient =
            err.errorLabels?.has?.('TransientTransactionError') ||
            err.errorLabelSet?.has?.('TransientTransactionError') ||
            err.code === 112 ||
            (typeof err.message === 'string' && (err.message.includes('WriteConflict') || err.message.includes('catalog changes')));

          if (isTransient && attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            continue;
          }

          if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
            const error = new Error('Financial transaction unavailable. Database transaction support is required.');
            error.statusCode = 503;
            throw error;
          }
          throw err;
        } finally {
          if (session) {
            await session.endSession();
          }
        }
      }
    }

    const err = new Error('Financial transaction unavailable. Database connection required.');
    err.statusCode = 503;
    throw err;
  },

  async executeAtomicVoidPayment({ roomPaymentId, reason, actorRole }) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const maxRetries = 5;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let session = null;
        try {
          session = await mongoose.startSession();
          session.startTransaction();

          const payment = await RoomPayment.findOne({ roomPaymentId }).session(session);
          if (!payment) {
            const err = new Error('Room payment not found.');
            err.statusCode = 404;
            throw err;
          }
          if (payment.status === 'voided') {
            await session.commitTransaction();
            return payment.toObject();
          }

          await guardFinancialMutation({
            memberId: payment.memberId,
            effectiveMonth: payment.month,
            actorRole,
            session,
          });

          // Guard / touch charge revision
          await RoomCharge.updateOne(
            { chargeId: payment.chargeId },
            { $inc: { __v: 1 } },
            { session },
          );

          payment.status = 'voided';
          payment.voidedAt = new Date();
          payment.voidedByRole = actorRole;
          payment.voidReason = reason.trim();
          await payment.save({ session });

          await session.commitTransaction();
          return payment.toObject();
        } catch (err) {
          if (session && session.inTransaction()) {
            await session.abortTransaction();
          }
          const isTransient =
            err.errorLabels?.has?.('TransientTransactionError') ||
            err.errorLabelSet?.has?.('TransientTransactionError') ||
            err.code === 112 ||
            (typeof err.message === 'string' && (err.message.includes('WriteConflict') || err.message.includes('catalog changes')));

          if (isTransient && attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            continue;
          }

          if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
            const error = new Error('Financial transaction unavailable. Database transaction support is required.');
            error.statusCode = 503;
            throw error;
          }
          throw err;
        } finally {
          if (session) {
            await session.endSession();
          }
        }
      }
    }

    const err = new Error('Financial transaction unavailable. Database connection required.');
    err.statusCode = 503;
    throw err;
  },

  // Settings
  async getPaymentSettings() {
    return RoomPaymentSettings.findOneAndUpdate(
      { settingsId: ROOM_SETTINGS_KEY },
      { $setOnInsert: { settingsId: ROOM_SETTINGS_KEY } },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    ).lean();
  },

  async updatePaymentSettings(updates) {
    return RoomPaymentSettings.findOneAndUpdate(
      { settingsId: ROOM_SETTINGS_KEY },
      { $set: updates },
      { returnDocument: 'after', upsert: true, runValidators: true },
    ).lean();
  },
};
