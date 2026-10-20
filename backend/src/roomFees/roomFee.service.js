import { randomUUID } from 'node:crypto';
import { MEMBER_IDS, MEMBERS } from '../config/members.js';
import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalMonth, getPreviousLogicalMonth, compareLogicalMonths } from '../utils/month.js';
import { getLogicalDateInTimeZone } from '../utils/date.js';
import {
  DEFAULT_DUE_DAY,
  isValidRoomFeeAmount,
  isValidRoomPaymentAmount,
  isValidUuid,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_REASON_LENGTH,
  MAX_RECIPIENT_NAME_LENGTH,
  MAX_REFERENCE_LENGTH,
  MAX_ROOM_CAPACITY,
  MAX_ROOM_LABEL_LENGTH,
  MAX_ROOM_NUMBER_LENGTH,
  MAX_UPI_ID_LENGTH,
  MIN_DUE_DAY,
  MAX_DUE_DAY,
  MIN_ROOM_CAPACITY,
  RECIPIENT_MODES,
  ROOM_CHARGE_STATUSES,
  ROOM_PAYMENT_METHODS,
  ROOM_PAYMENT_STATUSES,
} from './roomFee.constants.js';
import {
  canAssignRooms,
  canIssueRoomCharges,
  canManageFeePlans,
  canManageRooms,
  canRecordRoomPayment,
  canViewAllRoomFees,
  canViewOwnRoomFees,
  canVoidRoomPayment,
  canAdjustRoomCharge,
  canCancelRoomCharge,
  canManageRoomPaymentSettings,
} from './roomFee.permissions.js';
import {
  computeChargeFinancials,
  serializeFeePlan,
  serializePaymentSettings,
  serializeRoom,
  serializeRoomAssignment,
  serializeRoomCharge,
  serializeRoomPayment,
} from './roomFee.serializer.js';

export function createRoomFeeService({
  repository,
  timezone = 'Asia/Kolkata',
  now = () => new Date(),
}) {
  function getCurrentMonth() {
    return getLogicalDateInTimeZone(now(), timezone).slice(0, 7);
  }

  return Object.freeze({
    // --- Room Management ---
    async createRoom({ roomNumber, roomLabel, capacity = 2, actorRole }) {
      if (!canManageRooms(actorRole)) {
        throw new HttpError(403, 'Permission denied to manage rooms.');
      }

      if (typeof roomNumber !== 'string' || !roomNumber.trim() || roomNumber.trim().length > MAX_ROOM_NUMBER_LENGTH) {
        throw new HttpError(400, `Room number is required and must not exceed ${MAX_ROOM_NUMBER_LENGTH} characters.`);
      }

      if (typeof roomLabel !== 'string' || !roomLabel.trim() || roomLabel.trim().length > MAX_ROOM_LABEL_LENGTH) {
        throw new HttpError(400, `Room label is required and must not exceed ${MAX_ROOM_LABEL_LENGTH} characters.`);
      }

      const numCapacity = Number(capacity);
      if (!Number.isInteger(numCapacity) || numCapacity < MIN_ROOM_CAPACITY || numCapacity > MAX_ROOM_CAPACITY) {
        throw new HttpError(400, `Capacity must be an integer between ${MIN_ROOM_CAPACITY} and ${MAX_ROOM_CAPACITY}.`);
      }

      const normalizedNumber = roomNumber.trim();
      const existing = await repository.findRoomByNumber(normalizedNumber);
      if (existing) {
        throw new HttpError(409, `Room ${normalizedNumber} already exists.`);
      }

      const roomId = randomUUID();
      const room = await repository.createRoom({
        roomId,
        roomNumber: normalizedNumber,
        roomLabel: roomLabel.trim(),
        capacity: numCapacity,
        active: true,
      });

      return serializeRoom(room);
    },

    async updateRoom(roomId, updates, actorRole) {
      if (!canManageRooms(actorRole)) {
        throw new HttpError(403, 'Permission denied to manage rooms.');
      }

      const room = await repository.findRoomById(roomId);
      if (!room) {
        throw new HttpError(404, 'Room not found.');
      }

      const allowedUpdates = {};
      if (updates.roomLabel !== undefined) {
        if (typeof updates.roomLabel !== 'string' || !updates.roomLabel.trim() || updates.roomLabel.trim().length > MAX_ROOM_LABEL_LENGTH) {
          throw new HttpError(400, `Room label must not exceed ${MAX_ROOM_LABEL_LENGTH} characters.`);
        }
        allowedUpdates.roomLabel = updates.roomLabel.trim();
      }

      if (updates.capacity !== undefined) {
        const numCapacity = Number(updates.capacity);
        if (!Number.isInteger(numCapacity) || numCapacity < MIN_ROOM_CAPACITY || numCapacity > MAX_ROOM_CAPACITY) {
          throw new HttpError(400, `Capacity must be an integer between ${MIN_ROOM_CAPACITY} and ${MAX_ROOM_CAPACITY}.`);
        }
        allowedUpdates.capacity = numCapacity;
      }

      if (updates.active !== undefined) {
        allowedUpdates.active = Boolean(updates.active);
      }

      const updated = await repository.updateRoom(roomId, allowedUpdates);
      return serializeRoom(updated);
    },

    async getRooms({ activeOnly = false } = {}) {
      const rooms = await repository.findAllRooms({ activeOnly });
      const currentMonth = getCurrentMonth();
      const assignments = await repository.findAllAssignments();

      // Determine active occupants per room for currentMonth
      const occupantMap = new Map();
      for (const a of assignments) {
        if (a.effectiveFromMonth <= currentMonth && (!a.effectiveUntilMonth || a.effectiveUntilMonth >= currentMonth)) {
          if (!occupantMap.has(a.roomId)) occupantMap.set(a.roomId, []);
          occupantMap.get(a.roomId).push(a.memberId);
        }
      }

      return rooms.map((room) =>
        serializeRoom(room, { currentOccupants: occupantMap.get(room.roomId) || [] })
      );
    },

    async getRoom(roomId) {
      const room = await repository.findRoomById(roomId);
      if (!room) {
        throw new HttpError(404, 'Room not found.');
      }
      const currentMonth = getCurrentMonth();
      const assignments = await repository.findAssignmentsForRoom(roomId);
      const activeOccupants = assignments
        .filter((a) => a.effectiveFromMonth <= currentMonth && (!a.effectiveUntilMonth || a.effectiveUntilMonth >= currentMonth))
        .map((a) => a.memberId);

      return serializeRoom(room, { currentOccupants: activeOccupants });
    },

    // --- Room Assignments ---
    async assignMemberToRoom({ memberId, roomId, effectiveFromMonth, effectiveUntilMonth = null, actorRole }) {
      const currentMonth = getCurrentMonth();
      if (!canAssignRooms({ role: actorRole, effectiveFromMonth, currentMonth })) {
        throw new HttpError(403, 'Permission denied to assign rooms for this period.');
      }

      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, 'Invalid member ID.');
      }

      const room = await repository.findRoomById(roomId);
      if (!room || !room.active) {
        throw new HttpError(400, 'Selected room does not exist or is inactive.');
      }

      if (!isValidLogicalMonth(effectiveFromMonth)) {
        throw new HttpError(400, 'effectiveFromMonth must be in YYYY-MM format.');
      }

      if (effectiveUntilMonth !== null && !isValidLogicalMonth(effectiveUntilMonth)) {
        throw new HttpError(400, 'effectiveUntilMonth must be in YYYY-MM format or null.');
      }

      if (effectiveUntilMonth && compareLogicalMonths(effectiveFromMonth, effectiveUntilMonth) > 0) {
        throw new HttpError(400, 'effectiveUntilMonth cannot be earlier than effectiveFromMonth.');
      }

      // Check member's existing assignments for overlap
      const memberAssignments = await repository.findAssignmentsForMember(memberId);
      for (const a of memberAssignments) {
        // If an open-ended assignment exists starting before the new one, we auto-cap it
        if (!a.effectiveUntilMonth && compareLogicalMonths(a.effectiveFromMonth, effectiveFromMonth) < 0) {
          const cappedUntil = getPreviousLogicalMonth(effectiveFromMonth);
          await repository.updateAssignment(a.assignmentId, { effectiveUntilMonth: cappedUntil });
          continue;
        }

        // Check if there is overlap
        const aFrom = a.effectiveFromMonth;
        const aUntil = a.effectiveUntilMonth;
        const bFrom = effectiveFromMonth;
        const bUntil = effectiveUntilMonth;

        const overlaps =
          (!aUntil || compareLogicalMonths(aUntil, bFrom) >= 0) &&
          (!bUntil || compareLogicalMonths(bUntil, aFrom) >= 0);

        if (overlaps) {
          throw new HttpError(409, `Member ${memberId} already has an active room assignment during ${aFrom} - ${aUntil || 'present'}.`);
        }
      }

      // Room capacity check for target month
      const roomAssignments = await repository.findAssignmentsForRoom(roomId);
      const activeInMonth = roomAssignments.filter((a) => {
        const from = a.effectiveFromMonth;
        const until = a.effectiveUntilMonth;
        return from <= effectiveFromMonth && (!until || until >= effectiveFromMonth);
      });

      if (activeInMonth.length >= room.capacity) {
        throw new HttpError(409, `Room ${room.roomNumber} is at maximum capacity (${room.capacity}) for ${effectiveFromMonth}.`);
      }

      const assignmentId = randomUUID();
      const assignment = await repository.createAssignment({
        assignmentId,
        roomId,
        memberId,
        effectiveFromMonth,
        effectiveUntilMonth,
        assignedAt: now(),
        assignedByRole: actorRole,
      });

      const roomMap = new Map([[room.roomId, room]]);
      return serializeRoomAssignment(assignment, roomMap);
    },

    async getAllAssignments() {
      const assignments = await repository.findAllAssignments();
      const rooms = await repository.findAllRooms();
      const roomMap = new Map(rooms.map((r) => [r.roomId, r]));
      return assignments.map((a) => serializeRoomAssignment(a, roomMap));
    },

    async getAssignmentsForMember(memberId) {
      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, 'Invalid member ID.');
      }
      const assignments = await repository.findAssignmentsForMember(memberId);
      const rooms = await repository.findAllRooms();
      const roomMap = new Map(rooms.map((r) => [r.roomId, r]));
      return assignments.map((a) => serializeRoomAssignment(a, roomMap));
    },

    async deleteAssignment(assignmentId, actorRole) {
      if (!canManageRooms(actorRole)) {
        throw new HttpError(403, 'Permission denied to delete room assignments.');
      }
      const deleted = await repository.deleteAssignment(assignmentId);
      if (!deleted) {
        throw new HttpError(404, 'Assignment not found.');
      }
      return { success: true };
    },

    // --- Fee Plans ---
    async createFeePlan({
      memberId,
      amountPaise,
      effectiveFromMonth,
      effectiveUntilMonth = null,
      dueDay = DEFAULT_DUE_DAY,
      reason = null,
      actorRole,
    }) {
      const currentMonth = getCurrentMonth();
      if (!canManageFeePlans({ role: actorRole, effectiveFromMonth, currentMonth })) {
        throw new HttpError(403, 'Permission denied to manage fee plans for this period.');
      }

      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, 'Invalid member ID.');
      }

      if (!isValidRoomFeeAmount(amountPaise)) {
        throw new HttpError(400, 'Fee amount must be a non-negative safe integer in paise.');
      }

      if (!isValidLogicalMonth(effectiveFromMonth)) {
        throw new HttpError(400, 'effectiveFromMonth must be in YYYY-MM format.');
      }

      if (effectiveUntilMonth !== null && !isValidLogicalMonth(effectiveUntilMonth)) {
        throw new HttpError(400, 'effectiveUntilMonth must be in YYYY-MM format or null.');
      }

      if (effectiveUntilMonth && compareLogicalMonths(effectiveFromMonth, effectiveUntilMonth) > 0) {
        throw new HttpError(400, 'effectiveUntilMonth cannot be earlier than effectiveFromMonth.');
      }

      const numDueDay = Number(dueDay);
      if (!Number.isInteger(numDueDay) || numDueDay < MIN_DUE_DAY || numDueDay > MAX_DUE_DAY) {
        throw new HttpError(400, `dueDay must be an integer between ${MIN_DUE_DAY} and ${MAX_DUE_DAY}.`);
      }

      const normalizedReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, MAX_REASON_LENGTH) : null;

      // Handle existing open-ended plans for this member starting before the new effective month
      const existingPlans = await repository.findFeePlansForMember(memberId);
      for (const p of existingPlans) {
        if (!p.supersededAt) {
          if (!p.effectiveUntilMonth && compareLogicalMonths(p.effectiveFromMonth, effectiveFromMonth) < 0) {
            const cappedUntil = getPreviousLogicalMonth(effectiveFromMonth);
            await repository.updateFeePlan(p.feePlanId, {
              effectiveUntilMonth: cappedUntil,
            });
          } else if (compareLogicalMonths(p.effectiveFromMonth, effectiveFromMonth) >= 0) {
            // Supersede any conflicting future plans
            await repository.updateFeePlan(p.feePlanId, {
              supersededAt: now(),
              supersededBy: actorRole,
            });
          }
        }
      }

      const feePlanId = randomUUID();
      const plan = await repository.createFeePlan({
        feePlanId,
        memberId,
        amountPaise,
        effectiveFromMonth,
        effectiveUntilMonth,
        dueDay: numDueDay,
        reason: normalizedReason,
        createdByRole: actorRole,
      });

      return serializeFeePlan(plan);
    },

    async getFeePlansForMember(memberId) {
      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, 'Invalid member ID.');
      }
      const plans = await repository.findFeePlansForMember(memberId);
      return plans.map(serializeFeePlan);
    },

    async getActiveFeePlan(memberId, month) {
      const plan = await repository.findActiveFeePlan(memberId, month);
      return serializeFeePlan(plan);
    },

    // --- Monthly Charges ---
    async previewCharges(month, actorRole) {
      if (!canViewAllRoomFees(actorRole)) {
        throw new HttpError(403, 'Permission denied to preview room charges.');
      }

      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'month must be in YYYY-MM format.');
      }

      const membersSummary = [];
      let totalProposedPaise = 0;
      let canIssueAny = false;

      const rooms = await repository.findAllRooms();
      const roomMap = new Map(rooms.map((r) => [r.roomId, r]));

      for (const member of MEMBERS) {
        const memberId = member.id;
        const assignment = await repository.findActiveAssignment(memberId, month);
        const plan = await repository.findActiveFeePlan(memberId, month);
        const existingCharge = await repository.findChargeByMemberAndMonth(memberId, month);

        const room = assignment ? roomMap.get(assignment.roomId) : null;

        if (existingCharge) {
          membersSummary.push({
            memberId,
            memberName: member.name,
            roomId: existingCharge.roomId,
            roomNumber: existingCharge.roomNumber,
            roomLabel: room?.roomLabel ?? `Room ${existingCharge.roomNumber}`,
            amountPaise: existingCharge.baseAmountPaise,
            dueDate: existingCharge.dueDate,
            status: 'already_issued',
            blockingReason: 'Charge already issued for this month.',
            chargeId: existingCharge.chargeId,
          });
        } else if (!assignment) {
          membersSummary.push({
            memberId,
            memberName: member.name,
            roomId: null,
            roomNumber: null,
            roomLabel: null,
            amountPaise: plan?.amountPaise ?? null,
            dueDate: null,
            status: 'blocked_missing_room',
            blockingReason: 'No room assigned for this month.',
          });
        } else if (!plan) {
          membersSummary.push({
            memberId,
            memberName: member.name,
            roomId: room.roomId,
            roomNumber: room.roomNumber,
            roomLabel: room.roomLabel,
            amountPaise: null,
            dueDate: null,
            status: 'blocked_missing_fee_plan',
            blockingReason: 'Room fee not configured for this month.',
          });
        } else {
          canIssueAny = true;
          totalProposedPaise += plan.amountPaise;
          const dueDayPadded = String(plan.dueDay).padStart(2, '0');
          const dueDate = `${month}-${dueDayPadded}`;

          membersSummary.push({
            memberId,
            memberName: member.name,
            roomId: room.roomId,
            roomNumber: room.roomNumber,
            roomLabel: room.roomLabel,
            amountPaise: plan.amountPaise,
            dueDate,
            status: 'ready_to_issue',
            blockingReason: null,
          });
        }
      }

      return {
        month,
        totalProposedPaise,
        canIssue: canIssueAny,
        members: membersSummary,
      };
    },

    async issueCharges(month, actorRole) {
      const currentMonth = getCurrentMonth();
      if (!canIssueRoomCharges({ role: actorRole, month, currentMonth })) {
        throw new HttpError(403, 'Permission denied to issue charges for this month.');
      }

      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'month must be in YYYY-MM format.');
      }

      const rooms = await repository.findAllRooms();
      const roomMap = new Map(rooms.map((r) => [r.roomId, r]));

      const issuedCharges = [];
      let skippedCount = 0;

      for (const member of MEMBERS) {
        const memberId = member.id;
        const existingCharge = await repository.findChargeByMemberAndMonth(memberId, month);
        if (existingCharge) {
          skippedCount++;
          continue;
        }

        const assignment = await repository.findActiveAssignment(memberId, month);
        const plan = await repository.findActiveFeePlan(memberId, month);

        if (!assignment || !plan) {
          skippedCount++;
          continue;
        }

        const room = roomMap.get(assignment.roomId);
        if (!room) {
          skippedCount++;
          continue;
        }

        const dueDayPadded = String(plan.dueDay).padStart(2, '0');
        const dueDate = `${month}-${dueDayPadded}`;
        const chargeId = randomUUID();

        try {
          const charge = await repository.createCharge({
            chargeId,
            memberId,
            roomId: room.roomId,
            roomNumber: room.roomNumber,
            month,
            feePlanId: plan.feePlanId,
            baseAmountPaise: plan.amountPaise,
            dueDate,
            status: ROOM_CHARGE_STATUSES.ISSUED,
            adjustments: [],
            issuedAt: now(),
            issuedByRole: actorRole,
          });
          issuedCharges.push(serializeRoomCharge(charge, { payments: [], now: now() }));
        } catch (error) {
          // Idempotency check: if duplicate key under race condition, skip
          if (error.code === 11000) {
            skippedCount++;
          } else {
            throw error;
          }
        }
      }

      return {
        month,
        issuedCount: issuedCharges.length,
        skippedCount,
        charges: issuedCharges,
      };
    },

    async adjustCharge({ chargeId, amountPaise, reason, actorRole }) {
      if (!canAdjustRoomCharge(actorRole)) {
        throw new HttpError(403, 'Only Super Admin can adjust issued room charges.');
      }

      const charge = await repository.findChargeById(chargeId);
      if (!charge) {
        throw new HttpError(404, 'Room charge not found.');
      }

      if (charge.status === ROOM_CHARGE_STATUSES.CANCELLED) {
        throw new HttpError(400, 'Cannot adjust a cancelled room charge.');
      }

      const numAmount = Number(amountPaise);
      if (!Number.isSafeInteger(numAmount)) {
        throw new HttpError(400, 'Adjustment amount must be a safe integer in paise.');
      }

      if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > MAX_REASON_LENGTH) {
        throw new HttpError(400, `Adjustment reason is required and must not exceed ${MAX_REASON_LENGTH} characters.`);
      }

      const currentAdjustments = charge.adjustments || [];
      const currentAdjustmentTotal = currentAdjustments.reduce((sum, a) => sum + a.amountPaise, 0);
      const newFinalBill = charge.baseAmountPaise + currentAdjustmentTotal + numAmount;

      if (newFinalBill < 0) {
        throw new HttpError(400, `Adjustment cannot reduce the total charge below ₹0 (current: ₹${(charge.baseAmountPaise + currentAdjustmentTotal) / 100}).`);
      }

      const adjustment = {
        adjustmentId: randomUUID(),
        amountPaise: numAmount,
        reason: reason.trim(),
        createdAt: now(),
        createdByRole: actorRole,
      };

      const updatedAdjustments = [...currentAdjustments, adjustment];
      const updated = await repository.updateCharge(chargeId, { adjustments: updatedAdjustments });
      const payments = await repository.findPaymentsForCharge(chargeId);

      return serializeRoomCharge(updated, { payments, now: now() });
    },

    async cancelCharge({ chargeId, reason, actorRole }) {
      if (!canCancelRoomCharge(actorRole)) {
        throw new HttpError(403, 'Only Super Admin can cancel issued room charges.');
      }

      const charge = await repository.findChargeById(chargeId);
      if (!charge) {
        throw new HttpError(404, 'Room charge not found.');
      }

      const payments = await repository.findPaymentsForCharge(chargeId);
      const activePayments = payments.filter((p) => p.status === ROOM_PAYMENT_STATUSES.VERIFIED);
      if (activePayments.length > 0) {
        throw new HttpError(409, 'Cannot cancel a charge with active recorded payments. Void the payments first.');
      }

      const normalizedReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, MAX_REASON_LENGTH) : 'Cancelled by Super Admin';

      const updated = await repository.updateCharge(chargeId, {
        status: ROOM_CHARGE_STATUSES.CANCELLED,
        cancelledAt: now(),
        cancelReason: normalizedReason,
      });

      return serializeRoomCharge(updated, { payments, now: now() });
    },

    async getChargesForMonth(month, actorRole) {
      if (!canViewAllRoomFees(actorRole)) {
        throw new HttpError(403, 'Permission denied.');
      }
      const charges = await repository.findChargesForMonth(month);
      const payments = await repository.findPaymentsForMonth(month);

      const paymentsByCharge = new Map();
      for (const p of payments) {
        if (!paymentsByCharge.has(p.chargeId)) paymentsByCharge.set(p.chargeId, []);
        paymentsByCharge.get(p.chargeId).push(p);
      }

      return charges.map((c) =>
        serializeRoomCharge(c, { payments: paymentsByCharge.get(c.chargeId) || [], now: now() })
      );
    },

    // --- Room Payments ---
    async recordPayment({
      chargeId,
      memberId,
      month,
      amountPaise,
      method,
      reference = null,
      idempotencyKey,
      actorRole,
    }) {
      if (!canRecordRoomPayment(actorRole)) {
        throw new HttpError(403, 'Only Admin or Super Admin can record verified room payments.');
      }

      if (!isValidUuid(idempotencyKey)) {
        throw new HttpError(400, 'A valid UUID idempotencyKey is required.');
      }

      // Idempotency: return existing payment if previously recorded with this key
      const existingKey = await repository.findPaymentByIdempotencyKey(idempotencyKey);
      if (existingKey) {
        return serializeRoomPayment(existingKey);
      }

      if (!isValidRoomPaymentAmount(amountPaise)) {
        throw new HttpError(400, 'Payment amount must be a positive safe integer in paise.');
      }

      if (!ROOM_PAYMENT_METHODS.includes(method)) {
        throw new HttpError(400, `Invalid payment method. Must be one of: ${ROOM_PAYMENT_METHODS.join(', ')}.`);
      }

      const charge = await repository.findChargeById(chargeId);
      if (!charge) {
        throw new HttpError(404, 'Room charge not found.');
      }

      if (charge.status === ROOM_CHARGE_STATUSES.CANCELLED) {
        throw new HttpError(400, 'Cannot record payment against a cancelled room charge.');
      }

      if (charge.memberId !== memberId || charge.month !== month) {
        throw new HttpError(400, 'Charge member or month does not match payment payload.');
      }

      // Check remaining balance
      const existingPayments = await repository.findPaymentsForCharge(chargeId);
      const financials = computeChargeFinancials({ charge, payments: existingPayments, now: now() });

      if (amountPaise > financials.remainingAmountPaise) {
        throw new HttpError(
          400,
          `Payment amount (₹${amountPaise / 100}) exceeds remaining balance of ₹${financials.remainingAmountPaise / 100}.`
        );
      }

      // Snapshot recipient settings
      const settings = await repository.getPaymentSettings();
      const recipientSnapshot = {
        recipientMode: settings.recipientMode,
        recipientName: settings.recipientName,
        upiId: settings.upiId,
      };

      const normalizedRef = typeof reference === 'string' && reference.trim() ? reference.trim().slice(0, MAX_REFERENCE_LENGTH) : null;
      const roomPaymentId = randomUUID();

      const payment = await repository.createPayment({
        roomPaymentId,
        chargeId,
        memberId,
        month,
        amountPaise,
        method,
        reference: normalizedRef,
        recipientSnapshot,
        idempotencyKey,
        status: ROOM_PAYMENT_STATUSES.VERIFIED,
        recordedAt: now(),
        recordedByRole: actorRole,
      });

      return serializeRoomPayment(payment);
    },

    async voidPayment({ roomPaymentId, reason, actorRole }) {
      if (!canVoidRoomPayment(actorRole)) {
        throw new HttpError(403, 'Only Super Admin can void room payments.');
      }

      if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > MAX_REASON_LENGTH) {
        throw new HttpError(400, `Void reason is required and must not exceed ${MAX_REASON_LENGTH} characters.`);
      }

      const payment = await repository.findPaymentById(roomPaymentId);
      if (!payment) {
        throw new HttpError(404, 'Room payment not found.');
      }

      if (payment.status === ROOM_PAYMENT_STATUSES.VOIDED) {
        return serializeRoomPayment(payment);
      }

      const updated = await repository.updatePayment(roomPaymentId, {
        status: ROOM_PAYMENT_STATUSES.VOIDED,
        voidedAt: now(),
        voidedByRole: actorRole,
        voidReason: reason.trim(),
      });

      return serializeRoomPayment(updated);
    },

    async getPaymentsForCharge(chargeId) {
      const payments = await repository.findPaymentsForCharge(chargeId);
      return payments.map(serializeRoomPayment);
    },

    async getPaymentsForMonth(month, actorRole) {
      if (!canViewAllRoomFees(actorRole)) {
        throw new HttpError(403, 'Permission denied.');
      }
      const payments = await repository.findPaymentsForMonth(month);
      return payments.map(serializeRoomPayment);
    },

    async getAllPayments({ limit = 100 } = {}, actorRole) {
      if (!canViewAllRoomFees(actorRole)) {
        throw new HttpError(403, 'Permission denied.');
      }
      const payments = await repository.findAllPayments({ limit });
      return payments.map(serializeRoomPayment);
    },

    // --- Member-Specific Data Queries ---
    async getMemberOverview({ memberId, targetMonth = null }) {
      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, 'Invalid member ID.');
      }

      const month = targetMonth || getCurrentMonth();
      const assignment = await repository.findActiveAssignment(memberId, month);
      let room = null;
      if (assignment) {
        room = await repository.findRoomById(assignment.roomId);
      }

      const feePlan = await repository.findActiveFeePlan(memberId, month);
      const charge = await repository.findChargeByMemberAndMonth(memberId, month);
      let serializedCharge = null;

      if (charge) {
        const payments = await repository.findPaymentsForCharge(charge.chargeId);
        serializedCharge = serializeRoomCharge(charge, { payments, now: now() });
      }

      // Member lifetime stats across all issued charges
      const allMemberCharges = await repository.findChargesForMember(memberId);
      const allMemberPayments = await repository.findPaymentsForMember(memberId);

      let totalBilledPaise = 0;
      let totalPaidPaise = 0;
      let totalOutstandingPaise = 0;
      let paidMonthsCount = 0;
      let partialMonthsCount = 0;
      let dueMonthsCount = 0;

      for (const c of allMemberCharges) {
        if (c.status === ROOM_CHARGE_STATUSES.CANCELLED) continue;
        const cPayments = allMemberPayments.filter((p) => p.chargeId === c.chargeId);
        const fin = computeChargeFinancials({ charge: c, payments: cPayments, now: now() });
        totalBilledPaise += fin.finalBillAmountPaise;
        totalPaidPaise += fin.paidAmountPaise;
        totalOutstandingPaise += fin.remainingAmountPaise;

        if (fin.paymentStatus === 'paid') paidMonthsCount++;
        else if (fin.paymentStatus === 'partial') partialMonthsCount++;
        else dueMonthsCount++;
      }

      const settings = await repository.getPaymentSettings();

      return {
        memberId,
        month,
        currentRoom: room ? serializeRoom(room) : null,
        currentAssignment: assignment ? serializeRoomAssignment(assignment, new Map([[room?.roomId, room]])) : null,
        currentFeePlan: feePlan ? serializeFeePlan(feePlan) : null,
        scheduledFeePaise: feePlan ? feePlan.amountPaise : null,
        currentMonthCharge: serializedCharge,
        summaryMetrics: {
          totalBilledPaise,
          totalPaidPaise,
          totalOutstandingPaise,
          issuedMonthsCount: allMemberCharges.filter((c) => c.status !== ROOM_CHARGE_STATUSES.CANCELLED).length,
          paidMonthsCount,
          partialMonthsCount,
          dueMonthsCount,
        },
        recipientSettings: serializePaymentSettings(settings),
      };
    },

    async getMemberHistory(memberId) {
      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, 'Invalid member ID.');
      }

      const charges = await repository.findChargesForMember(memberId);
      const payments = await repository.findPaymentsForMember(memberId);

      const paymentsByCharge = new Map();
      for (const p of payments) {
        if (!paymentsByCharge.has(p.chargeId)) paymentsByCharge.set(p.chargeId, []);
        paymentsByCharge.get(p.chargeId).push(p);
      }

      const serializedCharges = charges.map((c) =>
        serializeRoomCharge(c, { payments: paymentsByCharge.get(c.chargeId) || [], now: now() })
      );

      // Summary metrics
      let totalBilledPaise = 0;
      let totalPaidPaise = 0;
      let totalOutstandingPaise = 0;

      for (const sc of serializedCharges) {
        if (sc.status === ROOM_CHARGE_STATUSES.CANCELLED) continue;
        totalBilledPaise += sc.finalBillAmountPaise;
        totalPaidPaise += sc.paidAmountPaise;
        totalOutstandingPaise += sc.remainingAmountPaise;
      }

      return {
        memberId,
        charges: serializedCharges,
        summaryMetrics: {
          totalBilledPaise,
          totalPaidPaise,
          totalOutstandingPaise,
          issuedCount: serializedCharges.filter((c) => c.status !== ROOM_CHARGE_STATUSES.CANCELLED).length,
        },
      };
    },

    async getMemberPayments(memberId) {
      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, 'Invalid member ID.');
      }
      const payments = await repository.findPaymentsForMember(memberId);
      return payments.map(serializeRoomPayment);
    },

    // --- Admin Monthly Overview ---
    async getMonthlySummary(month, actorRole) {
      if (!canViewAllRoomFees(actorRole)) {
        throw new HttpError(403, 'Permission denied.');
      }

      if (!isValidLogicalMonth(month)) {
        throw new HttpError(400, 'month must be in YYYY-MM format.');
      }

      const rooms = await repository.findAllRooms();
      const roomMap = new Map(rooms.map((r) => [r.roomId, r]));

      const memberSummaries = [];
      let totalBilledPaise = 0;
      let totalCollectedPaise = 0;
      let totalOutstandingPaise = 0;
      let membersBilledCount = 0;
      let membersPaidCount = 0;
      let membersPendingCount = 0;

      for (const member of MEMBERS) {
        const memberId = member.id;
        const assignment = await repository.findActiveAssignment(memberId, month);
        const room = assignment ? roomMap.get(assignment.roomId) : null;
        const plan = await repository.findActiveFeePlan(memberId, month);
        const charge = await repository.findChargeByMemberAndMonth(memberId, month);

        let serializedCharge = null;
        if (charge) {
          const payments = await repository.findPaymentsForCharge(charge.chargeId);
          serializedCharge = serializeRoomCharge(charge, { payments, now: now() });

          if (charge.status !== ROOM_CHARGE_STATUSES.CANCELLED) {
            totalBilledPaise += serializedCharge.finalBillAmountPaise;
            totalCollectedPaise += serializedCharge.paidAmountPaise;
            totalOutstandingPaise += serializedCharge.remainingAmountPaise;
            membersBilledCount++;

            if (serializedCharge.paymentStatus === 'paid') {
              membersPaidCount++;
            } else {
              membersPendingCount++;
            }
          }
        }

        memberSummaries.push({
          memberId,
          memberName: member.name,
          room: room ? serializeRoom(room) : null,
          assignment: assignment ? serializeRoomAssignment(assignment, roomMap) : null,
          feePlan: plan ? serializeFeePlan(plan) : null,
          charge: serializedCharge,
          status: serializedCharge ? serializedCharge.paymentStatus : (plan ? 'not_issued' : 'not_configured'),
        });
      }

      return {
        month,
        household: {
          totalBilledPaise,
          totalCollectedPaise,
          totalOutstandingPaise,
          membersBilledCount,
          membersPaidCount,
          membersPendingCount,
        },
        members: memberSummaries,
      };
    },

    // --- Settings ---
    async getPaymentSettings() {
      const settings = await repository.getPaymentSettings();
      return serializePaymentSettings(settings);
    },

    async updatePaymentSettings(updates, actorRole) {
      if (!canManageRoomPaymentSettings(actorRole)) {
        throw new HttpError(403, 'Permission denied to update room payment settings.');
      }

      const allowed = {};
      if (updates.recipientMode !== undefined) {
        if (!Object.values(RECIPIENT_MODES).includes(updates.recipientMode)) {
          throw new HttpError(400, 'Invalid recipient mode.');
        }
        allowed.recipientMode = updates.recipientMode;
      }

      if (updates.recipientName !== undefined) {
        if (typeof updates.recipientName !== 'string' || !updates.recipientName.trim() || updates.recipientName.trim().length > MAX_RECIPIENT_NAME_LENGTH) {
          throw new HttpError(400, `Recipient name is required and must not exceed ${MAX_RECIPIENT_NAME_LENGTH} characters.`);
        }
        allowed.recipientName = updates.recipientName.trim();
      }

      if (updates.upiId !== undefined) {
        allowed.upiId = typeof updates.upiId === 'string' && updates.upiId.trim() ? updates.upiId.trim().slice(0, MAX_UPI_ID_LENGTH) : null;
      }

      if (updates.paymentInstructions !== undefined) {
        allowed.paymentInstructions = typeof updates.paymentInstructions === 'string' && updates.paymentInstructions.trim() ? updates.paymentInstructions.trim().slice(0, MAX_INSTRUCTIONS_LENGTH) : null;
      }

      if (updates.defaultDueDay !== undefined) {
        const numDueDay = Number(updates.defaultDueDay);
        if (!Number.isInteger(numDueDay) || numDueDay < MIN_DUE_DAY || numDueDay > MAX_DUE_DAY) {
          throw new HttpError(400, `defaultDueDay must be an integer between ${MIN_DUE_DAY} and ${MAX_DUE_DAY}.`);
        }
        allowed.defaultDueDay = numDueDay;
      }

      allowed.updatedByRole = actorRole;
      const updated = await repository.updatePaymentSettings(allowed);
      return serializePaymentSettings(updated);
    },
  });
}

import { roomRepository } from './room.repository.js';
export const roomFeeService = createRoomFeeService({ repository: roomRepository });

