import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import { ROLES } from '../auth/permissions.js';
import { userAccountRepository } from '../auth/userAccount.repository.js';
import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalDate } from '../utils/date.js';
import {
  MAX_STUDENT_REASON_LENGTH,
  STUDENT_AUDIT_EVENT_TYPES,
  STUDENT_PROFILE_FIELDS,
  STUDENT_STATUSES,
} from './student.constants.js';
import { generateStudentId } from './studentId.js';
import {
  normalizeStudentProfile,
  studentRepository,
} from './student.repository.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{5,31}$/;

function requireSuperAdmin(actor) {
  if (actor?.role !== ROLES.SUPERADMIN) {
    throw new HttpError(403, 'Only Super Admin can manage students.');
  }
}

function normalizeReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new HttpError(400, 'A reason is required for student changes.');
  }
  const normalized = reason.trim();
  if (normalized.length > MAX_STUDENT_REASON_LENGTH) {
    throw new HttpError(400, `Reason cannot exceed ${MAX_STUDENT_REASON_LENGTH} characters.`);
  }
  return normalized;
}

function assertOnlyProfileFields(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new HttpError(400, 'Student profile updates must be an object.');
  }
  const unknown = Object.keys(updates).filter((field) => !STUDENT_PROFILE_FIELDS.includes(field));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown student profile field: ${unknown[0]}.`);
  }
  if (Object.keys(updates).length === 0) {
    throw new HttpError(400, 'At least one student profile field is required.');
  }
}

function validateProfile(profile, { requireAll = true } = {}) {
  if (requireAll || Object.prototype.hasOwnProperty.call(profile, 'displayName')) {
    if (typeof profile.displayName !== 'string' || !profile.displayName.trim()) {
      throw new HttpError(400, 'displayName is required.');
    }
  }
  if (profile.email !== null && profile.email !== undefined && !EMAIL_PATTERN.test(profile.email)) {
    throw new HttpError(400, 'email must be null or a valid email address.');
  }
  if (profile.phone !== null && profile.phone !== undefined && !PHONE_PATTERN.test(profile.phone)) {
    throw new HttpError(400, 'phone must be null or a valid contact number.');
  }
  for (const field of ['mealEligibilityFrom', 'mealEligibilityUntil']) {
    if (profile[field] !== null && profile[field] !== undefined && !isValidLogicalDate(profile[field])) {
      throw new HttpError(400, `${field} must be null or a valid YYYY-MM-DD date.`);
    }
  }
  if (
    profile.mealEligibilityFrom
    && profile.mealEligibilityUntil
    && profile.mealEligibilityFrom > profile.mealEligibilityUntil
  ) {
    throw new HttpError(400, 'mealEligibilityUntil cannot precede mealEligibilityFrom.');
  }
  if (requireAll || Object.prototype.hasOwnProperty.call(profile, 'rosterOrder')) {
    if (!Number.isSafeInteger(profile.rosterOrder) || profile.rosterOrder < 0) {
      throw new HttpError(400, 'rosterOrder must be a non-negative safe integer.');
    }
  }
}

function assertExpectedUpdatedAt(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'expectedUpdatedAt is required for concurrency safety.');
  }
  return parsed;
}

function translatePersistenceError(error) {
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? 'student identity or contact';
    throw new HttpError(409, `That ${field} is already assigned to another student.`);
  }
  throw error;
}

async function runAtomically(operation) {
  if (mongoose.connection?.readyState !== 1) return operation(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export function createStudentService({
  repository = studentRepository,
  accounts = userAccountRepository,
  now = () => new Date(),
  generateId = generateStudentId,
} = {}) {
  const recordAudit = ({ studentId, eventType, actor, occurredAt, reason, before, after, session }) => (
    repository.createAuditEvent({
      auditId: `student_audit_${randomUUID().replaceAll('-', '')}`,
      studentId,
      eventType,
      actorUserId: actor.userId ?? null,
      actorRole: actor.role,
      actorStudentId: actor.studentId ?? null,
      occurredAt,
      reason,
      before,
      after,
    }, { session })
  );

  return Object.freeze({
    async createStudent({ actor, reason, ...input }) {
      requireSuperAdmin(actor);
      const normalizedReason = normalizeReason(reason);
      assertOnlyProfileFields(input);
      const profile = normalizeStudentProfile(input);
      validateProfile(profile);
      const studentId = generateId();
      const occurredAt = now();

      try {
        return await runAtomically(async (session) => {
          const created = await repository.create({
            studentId,
            ...profile,
            status: STUDENT_STATUSES.ACTIVE,
          }, { session });
          await recordAudit({
            studentId,
            eventType: STUDENT_AUDIT_EVENT_TYPES.CREATED,
            actor,
            occurredAt,
            reason: normalizedReason,
            before: null,
            after: created,
            session,
          });
          return created;
        });
      } catch (error) {
        return translatePersistenceError(error);
      }
    },

    async updateStudent({ studentId, updates, expectedUpdatedAt, actor, reason }) {
      requireSuperAdmin(actor);
      const normalizedReason = normalizeReason(reason);
      const expectedVersion = assertExpectedUpdatedAt(expectedUpdatedAt);
      assertOnlyProfileFields(updates);

      try {
        return await runAtomically(async (session) => {
          const existing = await repository.findById(studentId, { session });
          if (!existing) throw new HttpError(404, 'Student was not found.');
          const patch = normalizeStudentProfile(updates, { partial: true });
          validateProfile({ ...existing, ...patch });
          const updated = await repository.updateProfile(studentId, patch, {
            session,
            expectedUpdatedAt: expectedVersion,
          });
          if (!updated) throw new HttpError(409, 'Student was changed by another administrator.');
          const occurredAt = now();
          await recordAudit({
            studentId,
            eventType: STUDENT_AUDIT_EVENT_TYPES.PROFILE_UPDATED,
            actor,
            occurredAt,
            reason: normalizedReason,
            before: existing,
            after: updated,
            session,
          });
          return updated;
        });
      } catch (error) {
        return translatePersistenceError(error);
      }
    },

    async archiveStudent({
      studentId,
      reason,
      disableAccount = false,
      expectedUpdatedAt,
      actor,
    }) {
      requireSuperAdmin(actor);
      const normalizedReason = normalizeReason(reason);
      const expectedVersion = assertExpectedUpdatedAt(expectedUpdatedAt);

      return runAtomically(async (session) => {
        const existing = await repository.findById(studentId, { session });
        if (!existing) throw new HttpError(404, 'Student was not found.');
        if (existing.status !== STUDENT_STATUSES.ACTIVE) {
          throw new HttpError(409, 'Only an active student can be archived.');
        }
        const occurredAt = now();
        const archived = await repository.transitionStatus(studentId, {
          status: STUDENT_STATUSES.ARCHIVED,
          archivedAt: occurredAt,
          archivedReason: normalizedReason,
        }, { session, expectedUpdatedAt: expectedVersion });
        if (!archived) throw new HttpError(409, 'Student was changed by another administrator.');

        if (disableAccount) {
          const account = await accounts.findByMemberId(studentId, { session });
          if (account && account.active !== false) {
            await accounts.setActive(account.userId, false, { session });
          }
        }
        await recordAudit({
          studentId,
          eventType: STUDENT_AUDIT_EVENT_TYPES.ARCHIVED,
          actor,
          occurredAt,
          reason: normalizedReason,
          before: existing,
          after: archived,
          session,
        });
        return archived;
      });
    },

    async reactivateStudent({ studentId, reason, expectedUpdatedAt, actor }) {
      requireSuperAdmin(actor);
      const normalizedReason = normalizeReason(reason);
      const expectedVersion = assertExpectedUpdatedAt(expectedUpdatedAt);

      return runAtomically(async (session) => {
        const existing = await repository.findById(studentId, { session });
        if (!existing) throw new HttpError(404, 'Student was not found.');
        if (existing.status !== STUDENT_STATUSES.ARCHIVED) {
          throw new HttpError(409, 'Only an archived student can be reactivated.');
        }
        const occurredAt = now();
        const reactivated = await repository.transitionStatus(studentId, {
          status: STUDENT_STATUSES.ACTIVE,
        }, { session, expectedUpdatedAt: expectedVersion });
        if (!reactivated) throw new HttpError(409, 'Student was changed by another administrator.');
        await recordAudit({
          studentId,
          eventType: STUDENT_AUDIT_EVENT_TYPES.REACTIVATED,
          actor,
          occurredAt,
          reason: normalizedReason,
          before: existing,
          after: reactivated,
          session,
        });
        return reactivated;
      });
    },
  });
}

export const studentService = createStudentService();
