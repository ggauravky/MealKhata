export const STUDENT_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
});

export const LEGACY_STUDENT_ELIGIBILITY_FIXTURES = Object.freeze({
  gaurav: '2026-10-01',
  nikhil: null,
  devansh: null,
});

export const STUDENT_AUDIT_EVENT_TYPES = Object.freeze({
  CREATED: 'STUDENT_CREATED',
  PROFILE_UPDATED: 'STUDENT_PROFILE_UPDATED',
  ARCHIVED: 'STUDENT_ARCHIVED',
  REACTIVATED: 'STUDENT_REACTIVATED',
});

export const STUDENT_PROFILE_FIELDS = Object.freeze([
  'displayName',
  'email',
  'phone',
  'mealEligibilityFrom',
  'mealEligibilityUntil',
  'rosterOrder',
]);

export const STUDENT_AUDIT_SNAPSHOT_FIELDS = Object.freeze([
  ...STUDENT_PROFILE_FIELDS,
  'status',
  'archivedAt',
  'archivedReason',
]);

export const MAX_STUDENT_ID_LENGTH = 128;
export const MAX_STUDENT_NAME_LENGTH = 120;
export const MAX_STUDENT_EMAIL_LENGTH = 254;
export const MAX_STUDENT_PHONE_LENGTH = 32;
export const MAX_STUDENT_REASON_LENGTH = 500;
