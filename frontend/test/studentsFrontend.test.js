import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildStudentLifecyclePayload,
  buildStudentProfilePayload,
  getStudentErrorMessage,
  mergeStudentManagementRoster,
  normalizeStudentList,
} from '../src/lib/studentContracts.js';

const FOURTH_ID = 'student_0123456789abcdef0123456789abcdef';

function student(studentId, displayName, rosterOrder, overrides = {}) {
  return {
    studentId,
    displayName,
    status: 'ACTIVE',
    email: null,
    phone: null,
    mealEligibilityFrom: null,
    mealEligibilityUntil: null,
    rosterOrder,
    archivedAt: null,
    archivedReason: null,
    createdAt: '2026-10-20T06:30:00.000Z',
    updatedAt: '2026-10-20T06:30:00.000Z',
    ...overrides,
  };
}

describe('dynamic student frontend contracts', () => {
  test('normalizes zero, one, three, four, and many students without fixed identities', () => {
    const one = [student('gaurav', 'Gaurav', 0)];
    const three = [
      student('gaurav', 'Gaurav', 0),
      student('nikhil', 'Nikhil', 1),
      student('devansh', 'Devansh', 2),
    ];
    const four = [...three, student(FOURTH_ID, 'Aarav Sen', 3)];
    const many = [
      ...four,
      student('student_11111111111111111111111111111111', 'Ira Das', 4),
      student('student_22222222222222222222222222222222', 'Maya Roy', 5),
    ];

    assert.deepEqual(normalizeStudentList([]), []);
    assert.deepEqual(normalizeStudentList(one).map((row) => row.studentId), ['gaurav']);
    assert.deepEqual(normalizeStudentList(three).map((row) => row.studentId), ['gaurav', 'nikhil', 'devansh']);
    assert.deepEqual(normalizeStudentList(four).map((row) => row.studentId), [
      'gaurav',
      'nikhil',
      'devansh',
      FOURTH_ID,
    ]);
    assert.equal(normalizeStudentList(many).length, 6);
  });

  test('keeps archived historical identities and merges account/accommodation data by student ID', () => {
    const archived = student(FOURTH_ID, 'Aarav Sen', 3, {
      status: 'ARCHIVED',
      archivedAt: '2026-10-28T10:00:00.000Z',
      archivedReason: 'Semester complete',
    });
    const [merged] = mergeStudentManagementRoster([archived], [{
      memberId: FOURTH_ID,
      name: 'Aarav Sen',
      account: { exists: true, active: false, email: 'aarav@example.com' },
      stay: null,
      room: null,
      assignment: null,
      feePlan: null,
    }]);

    assert.equal(merged.studentId, FOURTH_ID);
    assert.equal(merged.status, 'ARCHIVED');
    assert.equal(merged.archivedReason, 'Semester complete');
    assert.deepEqual(merged.account, {
      exists: true,
      userId: null,
      email: 'aarav@example.com',
      displayName: null,
      role: null,
      active: false,
      lastLoginAt: null,
      passwordChangedAt: null,
      sessionVersion: 0,
    });
    assert.equal(merged.stay, null);
  });

  test('builds allow-listed create and edit payloads while optional onboarding stays independent', () => {
    const values = {
      displayName: '  Aarav Sen  ',
      email: ' AARAV@Example.com ',
      phone: ' 9876543210 ',
      mealEligibilityFrom: '2026-10-29',
      mealEligibilityUntil: '',
      rosterOrder: '30',
      reason: '  Verified enrollment  ',
      createAccount: false,
      createStay: false,
      roomId: 'must-not-be-sent',
      monthlyRentPaise: 280000,
      expectedDepositPaise: 500000,
      studentId: 'must-not-be-overwritten',
    };

    assert.deepEqual(buildStudentProfilePayload(values), {
      displayName: 'Aarav Sen',
      email: 'aarav@example.com',
      phone: '9876543210',
      mealEligibilityFrom: '2026-10-29',
      mealEligibilityUntil: null,
      rosterOrder: 30,
      reason: 'Verified enrollment',
    });
    assert.deepEqual(buildStudentProfilePayload({
      ...values,
      expectedUpdatedAt: '2026-10-29T06:30:00.000Z',
    }, { editing: true }), {
      displayName: 'Aarav Sen',
      email: 'aarav@example.com',
      phone: '9876543210',
      mealEligibilityFrom: '2026-10-29',
      mealEligibilityUntil: null,
      rosterOrder: 30,
      reason: 'Verified enrollment',
      expectedUpdatedAt: '2026-10-29T06:30:00.000Z',
    });
  });

  test('validates profile dates, ordering, email, roster order, and reason before requests', () => {
    const valid = {
      displayName: 'Aarav Sen',
      email: '',
      phone: '',
      mealEligibilityFrom: '',
      mealEligibilityUntil: '',
      rosterOrder: 3,
      reason: 'Verified enrollment',
    };

    assert.throws(() => buildStudentProfilePayload({ ...valid, displayName: '' }), /name/i);
    assert.throws(() => buildStudentProfilePayload({ ...valid, email: 'invalid' }), /email/i);
    assert.throws(() => buildStudentProfilePayload({ ...valid, phone: 'not-a-phone' }), /phone/i);
    assert.throws(() => buildStudentProfilePayload({ ...valid, rosterOrder: '-1' }), /roster order/i);
    assert.throws(() => buildStudentProfilePayload({ ...valid, mealEligibilityFrom: '2026-02-30' }), /date/i);
    assert.throws(() => buildStudentProfilePayload({
      ...valid,
      mealEligibilityFrom: '2026-11-01',
      mealEligibilityUntil: '2026-10-31',
    }), /before/i);
    assert.throws(() => buildStudentProfilePayload({ ...valid, reason: ' ' }), /reason/i);
  });

  test('builds archive/reactivation payloads with optimistic concurrency and optional login disable', () => {
    const current = student(FOURTH_ID, 'Aarav Sen', 3, {
      updatedAt: '2026-10-29T06:30:00.000Z',
    });

    assert.deepEqual(buildStudentLifecyclePayload(current, {
      reason: '  Semester complete  ',
      disableAccount: true,
    }, { archive: true }), {
      reason: 'Semester complete',
      disableAccount: true,
      expectedUpdatedAt: '2026-10-29T06:30:00.000Z',
    });
    assert.deepEqual(buildStudentLifecyclePayload(current, {
      reason: '  Returning student  ',
      disableAccount: true,
    }, { archive: false }), {
      reason: 'Returning student',
      expectedUpdatedAt: '2026-10-29T06:30:00.000Z',
    });
  });

  test('uses safe API error messages and a useful fallback', () => {
    assert.equal(getStudentErrorMessage({ message: 'Student was changed by another administrator.' }), 'Student was changed by another administrator.');
    assert.equal(getStudentErrorMessage(null), 'Unable to update this student.');
  });
});
