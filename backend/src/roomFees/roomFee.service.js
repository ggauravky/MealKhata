import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { MEMBER_IDS, MEMBERS } from '../config/members.js';
import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalMonth, getPreviousLogicalMonth, compareLogicalMonths, getClampedDueDate, lastDateOfMonth } from '../utils/month.js';
import { getLogicalDateInTimeZone, getPreviousLogicalDate, isValidLogicalDate } from '../utils/date.js';

export function calculateMaxSimultaneousOccupancy({
  roomAssignments = [],
  targetAssignment,
  roomCapacity,
}) {
  const targetFrom = targetAssignment.effectiveFromDate || `${targetAssignment.effectiveFromMonth}-01`;
  const targetUntil = targetAssignment.effectiveUntilDate || (targetAssignment.effectiveUntilMonth ? lastDateOfMonth(targetAssignment.effectiveUntilMonth) : '9999-12-31');

  const overlapping = [];
  for (const a of roomAssignments) {
    if (a.cancelledAt) continue;
    if (a.assignmentId && a.assignmentId === targetAssignment.assignmentId) continue;
    if (a.memberId === targetAssignment.memberId) continue;

    const aFrom = a.effectiveFromDate || `${a.effectiveFromMonth}-01`;
    const aUntil = a.effectiveUntilDate || (a.effectiveUntilMonth ? lastDateOfMonth(a.effectiveUntilMonth) : '9999-12-31');

    if (aFrom <= targetUntil && targetFrom <= aUntil) {
      overlapping.push({
        from: aFrom > targetFrom ? aFrom : targetFrom,
        until: aUntil < targetUntil ? aUntil : targetUntil,
      });
    }
  }

  const testDates = new Set();
  testDates.add(targetFrom);
  for (const interval of overlapping) {
    testDates.add(interval.from);
  }

  let maxOccupancy = 0;
  for (const date of testDates) {
    let count = 1; // 1 for target assignment
    for (const interval of overlapping) {
      if (interval.from <= date && date <= interval.until) {
        count += 1;
      }
    }
    if (count > maxOccupancy) {
      maxOccupancy = count;
    }
  }

  return maxOccupancy;
}
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

      const normalizedNumber = roomNumber.trim();
      const existing = await repository.findRoomByNumber(normalizedNumber);
      if (existing) {
        throw new HttpError(409, `Room ${normalizedNumber} already exists.`);
      }

      const trimmedLabel = typeof roomLabel === 'string' ? roomLabel.trim() : '';
      if (trimmedLabel.length > MAX_ROOM_LABEL_LENGTH) {
        throw new HttpError(400, `Room label must not exceed ${MAX_ROOM_LABEL_LENGTH} characters.`);
      }
      const finalLabel = trimmedLabel || `Room ${normalizedNumber}`;

      const numCapacity = Number(capacity);
      if (!Number.isInteger(numCapacity) || numCapacity < MIN_ROOM_CAPACITY || numCapacity > MAX_ROOM_CAPACITY) {
        throw new HttpError(400, `Capacity must be an integer between ${MIN_ROOM_CAPACITY} and ${MAX_ROOM_CAPACITY}.`);
      }

      const roomId = randomUUID();
      const room = await repository.createRoom({
        roomId,
        roomNumber: normalizedNumber,
        roomLabel: finalLabel,
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
        if (typeof updates.roomLabel !== 'string') {
          throw new HttpError(400, 'Room label must be a string.');
        }
        const trimmedLabel = updates.roomLabel.trim();
        if (trimmedLabel.length > MAX_ROOM_LABEL_LENGTH) {
          throw new HttpError(400, `Room label must not exceed ${MAX_ROOM_LABEL_LENGTH} characters.`);
        }
        allowedUpdates.roomLabel = trimmedLabel || `Room ${room.roomNumber}`;
      }

      if (updates.capacity !== undefined) {
        const numCapacity = Number(updates.capacity);
        if (!Number.isInteger(numCapacity) || numCapacity < MIN_ROOM_CAPACITY || numCapacity > MAX_ROOM_CAPACITY) {
          throw new HttpError(400, `Capacity must be an integer between ${MIN_ROOM_CAPACITY} and ${MAX_ROOM_CAPACITY}.`);
        }

        const todayDate = getLogicalDateInTimeZone(now(), timezone);
        const assignments = await repository.findAssignmentsForRoom(roomId);
        const activeOccupants = assignments.filter((a) => {
          if (a.cancelledAt) return false;
          const fromDate = a.effectiveFromDate || `${a.effectiveFromMonth}-01`;
          const untilDate = a.effectiveUntilDate || (a.effectiveUntilMonth ? lastDateOfMonth(a.effectiveUntilMonth) : null);
          return fromDate <= todayDate && (!untilDate || untilDate >= todayDate);
        });

        if (numCapacity < activeOccupants.length) {
          throw new HttpError(
            409,
            `Cannot reduce capacity to ${numCapacity}: room currently has ${activeOccupants.length} active occupant(s).`
          );
        }

        // Check committed future intervals
        const futureDates = new Set([todayDate]);
        for (const a of assignments) {
          if (a.cancelledAt) continue;
          const fromDate = a.effectiveFromDate || `${a.effectiveFromMonth}-01`;
          if (fromDate >= todayDate) futureDates.add(fromDate);
        }
        for (const fDate of futureDates) {
          let count = 0;
          for (const a of assignments) {
            if (a.cancelledAt) continue;
            const fromDate = a.effectiveFromDate || `${a.effectiveFromMonth}-01`;
            const untilDate = a.effectiveUntilDate || (a.effectiveUntilMonth ? lastDateOfMonth(a.effectiveUntilMonth) : null);
            if (fromDate <= fDate && (!untilDate || untilDate >= fDate)) {
              count += 1;
            }
          }
          if (count > numCapacity) {
            throw new HttpError(
              409,
              `Cannot reduce capacity to ${numCapacity}: committed assignments reach ${count} occupants during ${fDate}.`
            );
          }
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
      const todayDate = getLogicalDateInTimeZone(now(), timezone);
      const assignments = await repository.findAllAssignments();

      // Determine active occupants per room as of today
      const occupantMap = new Map();
      for (const a of assignments) {
        if (a.cancelledAt) continue;
        const fromDate = a.effectiveFromDate || `${a.effectiveFromMonth}-01`;
        const untilDate = a.effectiveUntilDate || (a.effectiveUntilMonth ? lastDateOfMonth(a.effectiveUntilMonth) : null);
        if (fromDate <= todayDate && (!untilDate || untilDate >= todayDate)) {
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
      const todayDate = getLogicalDateInTimeZone(now(), timezone);
      const assignments = await repository.findAssignmentsForRoom(roomId);
      const activeOccupants = assignments
        .filter((a) => {
          if (a.cancelledAt) return false;
          const fromDate = a.effectiveFromDate || `${a.effectiveFromMonth}-01`;
          const untilDate = a.effectiveUntilDate || (a.effectiveUntilMonth ? lastDateOfMonth(a.effectiveUntilMonth) : null);
          return fromDate <= todayDate && (!untilDate || untilDate >= todayDate);
        })
        .map((a) => a.memberId);

      return serializeRoom(room, { currentOccupants: activeOccupants });
    },

    // --- Room Assignments ---
    async assignMemberToRoom({
      memberId,
      roomId,
      effectiveFromMonth: rawFromMonth,
      effectiveUntilMonth = null,
      effectiveFromDate = null,
      effectiveUntilDate = null,
      actorRole,
      isAdmission = false,
      session = null,
    }) {
      const effectiveFromMonth = rawFromMonth || (effectiveFromDate ? effectiveFromDate.slice(0, 7) : null);
      const currentMonth = getCurrentMonth();
      if (!isAdmission && !canAssignRooms({ role: actorRole, effectiveFromMonth, currentMonth })) {
        throw new HttpError(403, 'Permission denied to assign rooms for this period.');
      }

      if (!MEMBER_IDS.includes(memberId)) {
        throw new HttpError(400, 'Invalid member ID.');
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

      const targetFromDate = effectiveFromDate || `${effectiveFromMonth}-01`;
      const targetUntilDate = effectiveUntilDate || (effectiveUntilMonth ? lastDateOfMonth(effectiveUntilMonth) : null);

      if (targetUntilDate && targetFromDate > targetUntilDate) {
        throw new HttpError(400, 'effectiveUntilDate cannot be earlier than effectiveFromDate.');
      }

      let localSession = null;
      if (!session && mongoose.connection && mongoose.connection.readyState === 1) {
        try {
          localSession = await mongoose.startSession();
          localSession.startTransaction();
        } catch (_err) {
          if (process.env.NODE_ENV === 'production') {
            throw new HttpError(503, 'Database transaction support is required.');
          }
          localSession = null;
        }
      } else if (!session && process.env.NODE_ENV === 'production') {
        throw new HttpError(503, 'Database transaction support is required.');
      }

      const activeSession = session || localSession;

      try {
        const room =
          (await repository.findRoomById(roomId, { session: activeSession })) ||
          (await repository.findRoomByNumber(roomId, { session: activeSession }));
        if (!room || !room.active) {
          throw new HttpError(400, 'Selected room does not exist or is inactive.');
        }

        if (activeSession) {
          // Database-backed concurrency guard: touch occupancyRevision on room document
          // inside the transaction to serialize concurrent occupancy checks for the same room.
          await repository.updateRoom(room.roomId, { $inc: { occupancyRevision: 1 } }, { session: activeSession });
        }

        // 1. Room capacity check using exact simultaneous occupancy validation across all intervals
        const roomAssignments = await repository.findAssignmentsForRoom(room.roomId, { session: activeSession });
        const maxSimultaneousOccupancy = calculateMaxSimultaneousOccupancy({
          roomAssignments,
          targetAssignment: {
            memberId,
            effectiveFromMonth,
            effectiveUntilMonth,
            effectiveFromDate: targetFromDate,
            effectiveUntilDate: targetUntilDate,
          },
          roomCapacity: room.capacity,
        });

        if (maxSimultaneousOccupancy > room.capacity) {
          throw new HttpError(409, `Room ${room.roomNumber} is at maximum capacity (${room.capacity}) during the requested period.`);
        }

        // 2. Check member's existing assignments for overlap and identify prior assignment to auto-cap
        const memberAssignments = await repository.findAssignmentsForMember(memberId, { session: activeSession });
        let assignmentToCap = null;
        let cappedUntilDate = null;
        let cappedUntilMonth = null;

        for (const a of memberAssignments) {
          if (a.cancelledAt) continue;
          const aFrom = a.effectiveFromDate || `${a.effectiveFromMonth}-01`;
          const aUntil = a.effectiveUntilDate || (a.effectiveUntilMonth ? lastDateOfMonth(a.effectiveUntilMonth) : null);

          // If an open-ended assignment exists starting before the new one, plan to auto-cap it
          if (!aUntil && aFrom < targetFromDate) {
            cappedUntilDate = getPreviousLogicalDate(targetFromDate);
            cappedUntilMonth = cappedUntilDate.slice(0, 7);
            assignmentToCap = a;
            continue;
          }

          const overlaps =
            aFrom <= (targetUntilDate || '9999-99-99') &&
            targetFromDate <= (aUntil || '9999-99-99');

          if (overlaps) {
            throw new HttpError(409, `Member ${memberId} already has an active room assignment during ${aFrom} - ${aUntil || 'present'}.`);
          }
        }

        // 3. Apply auto-cap to prior assignment if applicable
        if (assignmentToCap && cappedUntilDate && cappedUntilMonth) {
          await repository.updateAssignment(
            assignmentToCap.assignmentId,
            {
              effectiveUntilMonth: cappedUntilMonth,
              effectiveUntilDate: cappedUntilDate,
            },
            { session: activeSession },
          );
        }

        const assignmentId = randomUUID();
        const assignment = await repository.createAssignment(
          {
            assignmentId,
            roomId: room.roomId,
            memberId,
            effectiveFromMonth,
            effectiveUntilMonth,
            effectiveFromDate: targetFromDate,
            effectiveUntilDate: targetUntilDate,
            assignedAt: now(),
            assignedByRole: actorRole,
          },
          { session: activeSession },
        );

        if (localSession) {
          await localSession.commitTransaction();
        }

        const roomMap = new Map([[room.roomId, room]]);
        return serializeRoomAssignment(assignment, roomMap);
      } catch (err) {
        if (localSession && localSession.inTransaction()) {
          await localSession.abortTransaction();
        }
        throw err;
      } finally {
        if (localSession) {
          await localSession.endSession();
        }
      }
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

    async getAssignmentById(assignmentId) {
      const assignment = await repository.findAssignmentById(assignmentId);
      if (!assignment || assignment.cancelledAt) return null;
      const room = await repository.findRoomById(assignment.roomId);
      return serializeRoomAssignment(assignment, new Map([[room?.roomId, room]]));
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

    async cancelAdmissionArtifacts({ assignmentId, feePlanId = null, reason, actorRole, session = null }) {
      if (actorRole !== 'superadmin') {
        throw new HttpError(403, 'Only Super Admin can cancel admission room artifacts.');
      }
      if (!assignmentId && !feePlanId) {
        throw new HttpError(409, 'No Stay-owned admission artifacts were identified safely.');
      }

      if (assignmentId) {
        const assignment = await repository.findAssignmentById(assignmentId, { session });
        if (!assignment) {
          throw new HttpError(409, 'The admission room assignment no longer exists.');
        }
        await repository.updateAssignment(
          assignmentId,
          {
            cancelledAt: now(),
            cancelledByRole: actorRole,
            cancelReason: reason,
          },
          { session },
        );
      }

      if (feePlanId) {
        const feePlan = await repository.findFeePlanById(feePlanId, { session });
        if (!feePlan) {
          throw new HttpError(409, 'The admission fee plan no longer exists.');
        }
        await repository.updateFeePlan(
          feePlanId,
          { supersededAt: now(), supersededBy: actorRole },
          { session },
        );
      }

      return { success: true };
    },

    async correctAdmissionArtifacts({
      assignmentId,
      feePlanId = null,
      memberId,
      roomId,
      effectiveFromDate,
      actorRole,
      session = null,
    }) {
      if (actorRole !== 'superadmin') {
        throw new HttpError(403, 'Only Super Admin can correct admission room artifacts.');
      }
      if (!MEMBER_IDS.includes(memberId) || !isValidLogicalDate(effectiveFromDate)) {
        throw new HttpError(400, 'A valid member and admission date are required.');
      }
      if (!roomId || !roomId.trim()) {
        throw new HttpError(400, 'A corrected room is required.');
      }

      const assignment = await repository.findAssignmentById(assignmentId, { session });
      if (!assignment || assignment.memberId !== memberId || assignment.cancelledAt) {
        throw new HttpError(409, 'The admission room assignment cannot be corrected safely.');
      }
      const room = (await repository.findRoomById(roomId.trim(), { session }))
        || (await repository.findRoomByNumber(roomId.trim(), { session }));
      if (!room || !room.active) {
        throw new HttpError(400, 'Selected room does not exist or is inactive.');
      }

      if (session) {
        await repository.updateRoom(room.roomId, { $inc: { occupancyRevision: 1 } }, { session });
      }
      const targetAssignment = {
        ...assignment,
        roomId: room.roomId,
        effectiveFromMonth: effectiveFromDate.slice(0, 7),
        effectiveFromDate,
      };
      const roomAssignments = await repository.findAssignmentsForRoom(room.roomId, { session });
      if (calculateMaxSimultaneousOccupancy({
        roomAssignments,
        targetAssignment,
        roomCapacity: room.capacity,
      }) > room.capacity) {
        throw new HttpError(409, `Room ${room.roomNumber} is at maximum capacity during the corrected admission period.`);
      }

      const memberAssignments = await repository.findAssignmentsForMember(memberId, { session });
      const targetUntil = targetAssignment.effectiveUntilDate
        || (targetAssignment.effectiveUntilMonth ? lastDateOfMonth(targetAssignment.effectiveUntilMonth) : null);
      for (const other of memberAssignments) {
        if (other.assignmentId === assignmentId || other.cancelledAt) continue;
        const otherFrom = other.effectiveFromDate || `${other.effectiveFromMonth}-01`;
        const otherUntil = other.effectiveUntilDate
          || (other.effectiveUntilMonth ? lastDateOfMonth(other.effectiveUntilMonth) : null);
        if (otherFrom <= (targetUntil || '9999-12-31') && effectiveFromDate <= (otherUntil || '9999-12-31')) {
          throw new HttpError(409, 'The corrected admission would overlap another room assignment for this member.');
        }
      }

      const updatedAssignment = await repository.updateAssignment(assignmentId, {
        roomId: room.roomId,
        effectiveFromMonth: effectiveFromDate.slice(0, 7),
        effectiveFromDate,
      }, { session });

      let updatedFeePlan = null;
      if (feePlanId) {
        const feePlan = await repository.findFeePlanById(feePlanId, { session });
        if (!feePlan || feePlan.memberId !== memberId) {
          throw new HttpError(409, 'The admission fee plan cannot be corrected safely.');
        }
        updatedFeePlan = await repository.updateFeePlan(
          feePlanId,
          { effectiveFromMonth: effectiveFromDate.slice(0, 7) },
          { session },
        );
      }

      return { assignment: updatedAssignment, feePlan: updatedFeePlan };
    },

    async endActiveRoomAssignment({ memberId, endMonth, endDate = null, session = null }) {
      const assignments = await repository.findAssignmentsForMember(memberId);
      const targetMonth = endDate ? endDate.slice(0, 7) : endMonth;
      const targetDate = endDate || (targetMonth ? lastDateOfMonth(targetMonth) : null);

      for (const a of assignments) {
        if (a.cancelledAt) continue;
        const fromDate = a.effectiveFromDate || `${a.effectiveFromMonth}-01`;
        const untilDate = a.effectiveUntilDate || (a.effectiveUntilMonth ? lastDateOfMonth(a.effectiveUntilMonth) : null);

        if (fromDate <= (targetDate || '9999-99-99') && (!untilDate || untilDate >= targetDate)) {
          const cappedDate = targetDate || `${targetMonth}-28`;
          const cappedMonth = targetMonth || cappedDate.slice(0, 7);
          await repository.updateAssignment(
            a.assignmentId,
            {
              effectiveUntilMonth: cappedMonth,
              effectiveUntilDate: cappedDate,
            },
            { session },
          );
        }
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
      isAdmission = false,
      session = null,
    }) {
      const currentMonth = getCurrentMonth();
      if (!isAdmission && !canManageFeePlans({ role: actorRole, effectiveFromMonth, currentMonth })) {
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

      let localSession = null;
      if (!session && mongoose.connection && mongoose.connection.readyState === 1) {
        try {
          localSession = await mongoose.startSession();
          localSession.startTransaction();
        } catch (_err) {
          if (process.env.NODE_ENV === 'production') {
            throw new HttpError(503, 'Database transaction support is required.');
          }
          localSession = null;
        }
      } else if (!session && process.env.NODE_ENV === 'production') {
        throw new HttpError(503, 'Database transaction support is required.');
      }

      const activeSession = session || localSession;

      try {
        // Handle existing open-ended plans for this member starting before the new effective month
        const existingPlans = await repository.findFeePlansForMember(memberId, { session: activeSession });
        for (const p of existingPlans) {
          if (!p.supersededAt) {
            if (!p.effectiveUntilMonth && compareLogicalMonths(p.effectiveFromMonth, effectiveFromMonth) < 0) {
              const cappedUntil = getPreviousLogicalMonth(effectiveFromMonth);
              await repository.updateFeePlan(
                p.feePlanId,
                {
                  effectiveUntilMonth: cappedUntil,
                },
                { session: activeSession },
              );
            } else if (compareLogicalMonths(p.effectiveFromMonth, effectiveFromMonth) >= 0) {
              // Supersede any conflicting future plans
              await repository.updateFeePlan(
                p.feePlanId,
                {
                  supersededAt: now(),
                  supersededBy: actorRole,
                },
                { session: activeSession },
              );
            }
          }
        }

        const feePlanId = randomUUID();
        const plan = await repository.createFeePlan(
          {
            feePlanId,
            memberId,
            amountPaise,
            effectiveFromMonth,
            effectiveUntilMonth,
            dueDay: numDueDay,
            reason: normalizedReason,
            createdByRole: actorRole,
          },
          { session: activeSession },
        );

        if (localSession) {
          await localSession.commitTransaction();
        }

        return serializeFeePlan(plan);
      } catch (err) {
        if (localSession && localSession.inTransaction()) {
          await localSession.abortTransaction();
        }
        throw err;
      } finally {
        if (localSession) {
          await localSession.endSession();
        }
      }
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

        // Check if member has completed hostel stay prior to this month
        let completedStay = false;
        try {
          if (mongoose.connection && mongoose.connection.readyState === 1 && mongoose.models.HostelStay) {
            const stays = await mongoose.models.HostelStay.find({ memberId }).lean();
            if (stays.length > 0) {
              const coversMonth = stays.some((s) => {
                const joinM = s.joinedOn.slice(0, 7);
                const leftM = s.actualLeftOn ? s.actualLeftOn.slice(0, 7) : null;
                return joinM <= month && (!leftM || leftM >= month);
              });
              if (!coversMonth) {
                completedStay = true;
              }
            }
          }
        } catch (_err) {
          completedStay = false;
        }

        if (completedStay) {
          membersSummary.push({
            memberId,
            memberName: member.name,
            roomId: null,
            roomNumber: null,
            roomLabel: null,
            amountPaise: null,
            dueDate: null,
            status: 'blocked_completed_stay',
            blockingReason: 'Member has completed hostel stay.',
          });
          continue;
        }

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
          const dueDate = getClampedDueDate(month, plan.dueDay);

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

      let localSession = null;
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
          localSession = await mongoose.startSession();
          localSession.startTransaction();
        } catch (_err) {
          localSession = null;
        }
      }

      try {
        for (const member of MEMBERS) {
          const memberId = member.id;

          // Check if member has completed hostel stay prior to this month
          let completedStay = false;
          try {
            if (mongoose.connection && mongoose.connection.readyState === 1 && mongoose.models.HostelStay) {
              const stays = await mongoose.models.HostelStay.find({ memberId }).session(localSession).lean();
              if (stays.length > 0) {
                const coversMonth = stays.some((s) => {
                  const joinM = s.joinedOn.slice(0, 7);
                  const leftM = s.actualLeftOn ? s.actualLeftOn.slice(0, 7) : null;
                  return joinM <= month && (!leftM || leftM >= month);
                });
                if (!coversMonth) {
                  completedStay = true;
                }
              }
            }
          } catch (_err) {
            completedStay = false;
          }

          if (completedStay) {
            skippedCount++;
            continue;
          }

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

          const dueDate = getClampedDueDate(month, plan.dueDay);
          const chargeId = randomUUID();

          try {
            const charge = await repository.createCharge(
              {
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
              },
              localSession ? { session: localSession } : {},
            );
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

        if (localSession) {
          await localSession.commitTransaction();
        }

        return {
          month,
          issuedCount: issuedCharges.length,
          skippedCount,
          charges: issuedCharges,
        };
      } catch (err) {
        if (localSession && localSession.inTransaction()) {
          await localSession.abortTransaction();
        }
        throw err;
      } finally {
        if (localSession) {
          await localSession.endSession();
        }
      }
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

      if (typeof repository.atomicAdjustCharge === 'function') {
        const updated = await repository.atomicAdjustCharge({
          chargeId,
          numAmount,
          reason: reason.trim(),
          actorRole,
        });
        const payments = await repository.findPaymentsForCharge(chargeId);
        return serializeRoomCharge(updated, { payments, now: now() });
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

      const normalizedReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, MAX_REASON_LENGTH) : 'Cancelled by Super Admin';

      if (typeof repository.executeAtomicCancelCharge === 'function') {
        const updated = await repository.executeAtomicCancelCharge({
          chargeId,
          reason: normalizedReason,
          actorRole,
        });
        const payments = await repository.findPaymentsForCharge(chargeId);
        return serializeRoomCharge(updated, { payments, now: now() });
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

      let targetMemberId = memberId;
      let targetMonth = month;
      if (!targetMemberId || !targetMonth) {
        const charge = await repository.findChargeById(chargeId);
        if (!charge) {
          throw new HttpError(404, 'Room charge not found.');
        }
        targetMemberId = targetMemberId || charge.memberId;
        targetMonth = targetMonth || charge.month;
      }

      // Idempotency: return existing payment if previously recorded with this key
      const existingKey = await repository.findPaymentByIdempotencyKey(idempotencyKey);
      if (existingKey) {
        const isMatch =
          existingKey.chargeId === chargeId &&
          existingKey.memberId === targetMemberId &&
          existingKey.month === targetMonth &&
          existingKey.amountPaise === amountPaise &&
          existingKey.method === method;

        if (!isMatch) {
          throw new HttpError(409, 'Idempotency key reused with conflicting payment payload.');
        }
        return serializeRoomPayment(existingKey);
      }

      if (!isValidRoomPaymentAmount(amountPaise)) {
        throw new HttpError(400, 'Payment amount must be a positive safe integer in paise.');
      }

      if (!ROOM_PAYMENT_METHODS.includes(method)) {
        throw new HttpError(400, `Invalid payment method. Must be one of: ${ROOM_PAYMENT_METHODS.join(', ')}.`);
      }

      if (typeof repository.executeAtomicRoomPayment === 'function') {
        const settings = await repository.getPaymentSettings();
        const recipientSnapshot = {
          recipientMode: settings.recipientMode,
          recipientName: settings.recipientName,
          upiId: settings.upiId,
        };
        const normalizedRef = typeof reference === 'string' && reference.trim() ? reference.trim().slice(0, MAX_REFERENCE_LENGTH) : null;
        const payment = await repository.executeAtomicRoomPayment({
          chargeId,
          memberId: targetMemberId,
          month: targetMonth,
          amountPaise,
          method,
          reference: normalizedRef,
          recipientSnapshot,
          idempotencyKey,
          actorRole,
        });
        return serializeRoomPayment(payment);
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

      if (typeof repository.executeAtomicVoidPayment === 'function') {
        const updated = await repository.executeAtomicVoidPayment({
          roomPaymentId,
          reason: reason.trim(),
          actorRole,
        });
        return serializeRoomPayment(updated);
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
