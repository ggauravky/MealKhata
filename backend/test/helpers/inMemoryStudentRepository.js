import { isValidLogicalDate } from '../../src/utils/date.js';
import {
  STUDENT_PROFILE_FIELDS,
  STUDENT_STATUSES,
} from '../../src/students/student.constants.js';
import { assertSafeStudentId } from '../../src/students/studentId.js';
import {
  normalizeStudentProfile,
  sanitizeStudentAuditEvent,
} from '../../src/students/student.repository.js';

function clone(value) {
  return structuredClone(value);
}

function duplicateKeyError(field, value) {
  return Object.assign(new Error(`Duplicate ${field}: ${value}`), {
    code: 11000,
    keyPattern: { [field]: 1 },
    keyValue: { [field]: value },
  });
}

function assertProfile(profile) {
  if (typeof profile.displayName !== 'string' || !profile.displayName) {
    throw new TypeError('displayName is required');
  }
  if (!Number.isSafeInteger(profile.rosterOrder) || profile.rosterOrder < 0) {
    throw new TypeError('rosterOrder must be a non-negative safe integer');
  }
  for (const field of ['mealEligibilityFrom', 'mealEligibilityUntil']) {
    if (profile[field] !== null && profile[field] !== undefined && !isValidLogicalDate(profile[field])) {
      throw new TypeError(`${field} must be null or a valid YYYY-MM-DD date`);
    }
  }
}

export class InMemoryStudentRepository {
  students = new Map();

  auditEvents = new Map();

  constructor(initialStudents = []) {
    for (const student of initialStudents) this.#insertInitial(student);
  }

  #insertInitial(data) {
    assertSafeStudentId(data.studentId);
    const profile = normalizeStudentProfile(data);
    assertProfile(profile);
    const now = data.createdAt ?? new Date();
    this.students.set(data.studentId, clone({
      studentId: data.studentId,
      ...profile,
      status: data.status ?? STUDENT_STATUSES.ACTIVE,
      archivedAt: data.archivedAt ?? null,
      archivedReason: data.archivedReason ?? null,
      createdAt: now,
      updatedAt: data.updatedAt ?? now,
    }));
  }

  #assertUniqueContacts(candidate, exceptStudentId = null) {
    for (const student of this.students.values()) {
      if (student.studentId === exceptStudentId) continue;
      for (const field of ['email', 'phone']) {
        if (candidate[field] !== null && candidate[field] === student[field]) {
          throw duplicateKeyError(field, candidate[field]);
        }
      }
    }
  }

  async create(data) {
    assertSafeStudentId(data.studentId);
    if (this.students.has(data.studentId)) throw duplicateKeyError('studentId', data.studentId);
    const profile = normalizeStudentProfile(data);
    assertProfile(profile);
    this.#assertUniqueContacts(profile);
    const now = new Date();
    const student = {
      studentId: data.studentId,
      ...profile,
      status: data.status ?? STUDENT_STATUSES.ACTIVE,
      archivedAt: data.archivedAt ?? null,
      archivedReason: data.archivedReason ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.students.set(student.studentId, clone(student));
    return clone(student);
  }

  async findById(studentId) {
    assertSafeStudentId(studentId);
    const student = this.students.get(studentId);
    return student ? clone(student) : null;
  }

  async list({ status = null } = {}) {
    return [...this.students.values()]
      .filter((student) => !status || student.status === status)
      .sort((left, right) => (
        left.rosterOrder - right.rosterOrder
        || left.createdAt.getTime() - right.createdAt.getTime()
        || left.studentId.localeCompare(right.studentId)
      ))
      .map(clone);
  }

  async updateProfile(studentId, updates, { expectedUpdatedAt = null } = {}) {
    assertSafeStudentId(studentId);
    const current = this.students.get(studentId);
    if (!current) return null;
    if (expectedUpdatedAt && current.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) return null;
    const patch = normalizeStudentProfile(updates, { partial: true });
    const profile = Object.fromEntries(STUDENT_PROFILE_FIELDS.map((field) => [field, current[field]]));
    const nextProfile = { ...profile, ...patch };
    assertProfile(nextProfile);
    this.#assertUniqueContacts(nextProfile, studentId);
    const updated = { ...current, ...patch, updatedAt: new Date() };
    this.students.set(studentId, clone(updated));
    return clone(updated);
  }

  async transitionStatus(studentId, transition, { expectedUpdatedAt = null } = {}) {
    assertSafeStudentId(studentId);
    const current = this.students.get(studentId);
    if (!current) return null;
    if (expectedUpdatedAt && current.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) return null;
    if (!Object.values(STUDENT_STATUSES).includes(transition.status)) {
      throw new TypeError('status must be ACTIVE or ARCHIVED');
    }
    const isArchived = transition.status === STUDENT_STATUSES.ARCHIVED;
    const updated = {
      ...current,
      status: transition.status,
      archivedAt: isArchived ? transition.archivedAt : null,
      archivedReason: isArchived ? transition.archivedReason?.trim() || null : null,
      updatedAt: new Date(),
    };
    this.students.set(studentId, clone(updated));
    return clone(updated);
  }

  async createAuditEvent(data) {
    if (this.auditEvents.has(data.auditId)) throw duplicateKeyError('auditId', data.auditId);
    const event = sanitizeStudentAuditEvent(data);
    this.auditEvents.set(event.auditId, clone(event));
    return clone(event);
  }
}
