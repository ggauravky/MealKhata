import { isValidLogicalDate } from './logicalDate.js';
import { normalizeMemberRoster } from './memberContracts.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{5,31}$/;

function nullableText(value, { lowercase = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  return lowercase ? normalized.toLowerCase() : normalized;
}

function normalizedStatus(value) {
  return value === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
}

export function normalizeStudentList(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row.studentId === 'string' && row.studentId.trim())
    .map((row) => ({
      studentId: row.studentId,
      displayName: typeof row.displayName === 'string' && row.displayName.trim()
        ? row.displayName.trim()
        : row.studentId,
      status: normalizedStatus(row.status),
      email: nullableText(row.email, { lowercase: true }),
      phone: nullableText(row.phone),
      mealEligibilityFrom: nullableText(row.mealEligibilityFrom),
      mealEligibilityUntil: nullableText(row.mealEligibilityUntil),
      rosterOrder: Number.isSafeInteger(row.rosterOrder) ? row.rosterOrder : 0,
      archivedAt: row.archivedAt ?? null,
      archivedReason: nullableText(row.archivedReason),
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
    }))
    .sort((left, right) => (
      left.rosterOrder - right.rosterOrder
      || left.studentId.localeCompare(right.studentId)
    ));
}

export function mergeStudentManagementRoster(studentRows, memberRows) {
  const members = new Map(
    normalizeMemberRoster(memberRows).map((member) => [member.memberId, member]),
  );

  return normalizeStudentList(studentRows).map((student) => {
    const member = members.get(student.studentId);
    return {
      ...student,
      name: student.displayName,
      account: member?.account ?? { exists: false },
      stay: member?.stay ?? null,
      room: member?.room ?? null,
      assignment: member?.assignment ?? null,
      feePlan: member?.feePlan ?? null,
    };
  });
}

export function buildStudentProfilePayload(values, { editing = false } = {}) {
  const displayName = nullableText(values?.displayName);
  const email = nullableText(values?.email, { lowercase: true });
  const phone = nullableText(values?.phone);
  const mealEligibilityFrom = nullableText(values?.mealEligibilityFrom);
  const mealEligibilityUntil = nullableText(values?.mealEligibilityUntil);
  const rosterOrder = Number(values?.rosterOrder);
  const reason = nullableText(values?.reason);

  if (!displayName) throw new TypeError('Student name is required.');
  if (email && !EMAIL_PATTERN.test(email)) throw new TypeError('Enter a valid email address.');
  if (phone && !PHONE_PATTERN.test(phone)) throw new TypeError('Enter a valid phone number.');
  if (!Number.isSafeInteger(rosterOrder) || rosterOrder < 0) {
    throw new TypeError('Roster order must be a non-negative whole number.');
  }
  for (const date of [mealEligibilityFrom, mealEligibilityUntil]) {
    if (date && !isValidLogicalDate(date)) throw new TypeError('Eligibility dates must be valid calendar dates.');
  }
  if (mealEligibilityFrom && mealEligibilityUntil && mealEligibilityUntil < mealEligibilityFrom) {
    throw new TypeError('Eligibility end date cannot be before the start date.');
  }
  if (!reason) throw new TypeError('A reason is required.');

  const payload = {
    displayName,
    email,
    phone,
    mealEligibilityFrom,
    mealEligibilityUntil,
    rosterOrder,
    reason,
  };
  if (editing) {
    const expectedUpdatedAt = nullableText(values?.expectedUpdatedAt);
    if (!expectedUpdatedAt || Number.isNaN(new Date(expectedUpdatedAt).getTime())) {
      throw new TypeError('The student version is missing. Refresh and try again.');
    }
    payload.expectedUpdatedAt = expectedUpdatedAt;
  }
  return payload;
}

export function buildStudentLifecyclePayload(student, values, { archive } = {}) {
  const reason = nullableText(values?.reason);
  if (!reason) throw new TypeError('A reason is required.');
  if (!student?.updatedAt || Number.isNaN(new Date(student.updatedAt).getTime())) {
    throw new TypeError('The student version is missing. Refresh and try again.');
  }
  return {
    reason,
    ...(archive ? { disableAccount: values?.disableAccount === true } : {}),
    expectedUpdatedAt: student.updatedAt,
  };
}

export function getStudentErrorMessage(error) {
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : 'Unable to update this student.';
}
