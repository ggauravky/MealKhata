import { Student } from './student.model.js';
import { StudentAuditEvent } from './studentAuditEvent.model.js';
import {
  STUDENT_AUDIT_SNAPSHOT_FIELDS,
  STUDENT_PROFILE_FIELDS,
  STUDENT_STATUSES,
} from './student.constants.js';
import { assertSafeStudentId } from './studentId.js';

function pickFields(source, fields) {
  /** @type {Record<string, any>} */
  const picked = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source ?? {}, field)) picked[field] = source[field];
  }
  return picked;
}

function pickScalarSnapshotFields(source) {
  /** @type {Record<string, any>} */
  const snapshot = {};
  for (const field of STUDENT_AUDIT_SNAPSHOT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source ?? {}, field)) continue;
    const value = source[field];
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || value instanceof Date
    ) {
      snapshot[field] = value;
    }
  }
  return snapshot;
}

function normalizeNullableString(value, { lowercase = false } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return lowercase ? normalized.toLowerCase() : normalized;
}

export function normalizeStudentProfile(source, { partial = false } = {}) {
  const profile = pickFields(source, STUDENT_PROFILE_FIELDS);
  if (Object.prototype.hasOwnProperty.call(profile, 'displayName')) {
    profile['displayName'] = String(profile['displayName']).trim();
  }
  if (Object.prototype.hasOwnProperty.call(profile, 'email')) {
    profile['email'] = normalizeNullableString(profile['email'], { lowercase: true });
  }
  if (Object.prototype.hasOwnProperty.call(profile, 'phone')) {
    profile['phone'] = normalizeNullableString(profile['phone']);
  }
  if (!partial) {
    profile['email'] ??= null;
    profile['phone'] ??= null;
    profile['mealEligibilityFrom'] ??= null;
    profile['mealEligibilityUntil'] ??= null;
  }
  return profile;
}

export function sanitizeStudentAuditEvent(source) {
  assertSafeStudentId(source.studentId);
  const event = {
    auditId: source.auditId,
    studentId: source.studentId,
    eventType: source.eventType,
    actorUserId: source.actorUserId ?? null,
    actorRole: source.actorRole,
    actorStudentId: source.actorStudentId ?? null,
    occurredAt: source.occurredAt,
    reason: normalizeNullableString(source.reason),
    before: source.before === null || source.before === undefined
      ? null
      : pickScalarSnapshotFields(source.before),
    after: source.after === null || source.after === undefined
      ? null
      : pickScalarSnapshotFields(source.after),
  };
  if (event.actorStudentId !== null) assertSafeStudentId(event.actorStudentId);
  return event;
}

function withSession(query, session) {
  return session ? query.session(session) : query;
}

export function createStudentRepository({
  studentModel = Student,
  auditModel = StudentAuditEvent,
} = {}) {
  return Object.freeze({
    async create(data, { session = null } = {}) {
      assertSafeStudentId(data.studentId);
      const record = {
        studentId: data.studentId,
        ...normalizeStudentProfile(data),
        status: data.status ?? STUDENT_STATUSES.ACTIVE,
        archivedAt: data.archivedAt ?? null,
        archivedReason: normalizeNullableString(data.archivedReason),
      };
      if (session) {
        const created = await studentModel.create([record], { session });
        return created[0].toObject();
      }
      const created = await studentModel.create(record);
      return created.toObject();
    },

    async findById(studentId, { session = null } = {}) {
      assertSafeStudentId(studentId);
      return withSession(studentModel.findOne({ studentId }), session).lean();
    },

    async list({ status = null, session = null } = {}) {
      const filter = status ? { status } : {};
      return withSession(
        studentModel.find(filter).sort({ rosterOrder: 1, createdAt: 1, studentId: 1 }),
        session,
      ).lean();
    },

    async updateProfile(studentId, updates, { session = null, expectedUpdatedAt = null } = {}) {
      assertSafeStudentId(studentId);
      const filter = expectedUpdatedAt ? { studentId, updatedAt: expectedUpdatedAt } : { studentId };
      const options = session
        ? { new: true, runValidators: true, session }
        : { new: true, runValidators: true };
      return studentModel.findOneAndUpdate(
        filter,
        { $set: normalizeStudentProfile(updates, { partial: true }) },
        options,
      ).lean();
    },

    async transitionStatus(studentId, transition, { session = null, expectedUpdatedAt = null } = {}) {
      assertSafeStudentId(studentId);
      const filter = expectedUpdatedAt ? { studentId, updatedAt: expectedUpdatedAt } : { studentId };
      const isArchived = transition.status === STUDENT_STATUSES.ARCHIVED;
      const update = {
        status: transition.status,
        archivedAt: isArchived ? transition.archivedAt : null,
        archivedReason: isArchived ? normalizeNullableString(transition.archivedReason) : null,
      };
      const options = session
        ? { new: true, runValidators: true, session }
        : { new: true, runValidators: true };
      return studentModel.findOneAndUpdate(filter, { $set: update }, options).lean();
    },

    async createAuditEvent(data, { session = null } = {}) {
      const event = sanitizeStudentAuditEvent(data);
      if (session) {
        const created = await auditModel.create([event], { session });
        return created[0].toObject();
      }
      const created = await auditModel.create(event);
      return created.toObject();
    },
  });
}

export const studentRepository = createStudentRepository();
