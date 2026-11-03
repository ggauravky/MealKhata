import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toOperationalRoster } from '../src/lib/operationalRoster.js';
import { buildExpenseEditInitialValues } from '../src/lib/expenseEditorState.js';

test('operational selectors include any active student and retain archived identities for history', () => {
  const students = [
    { studentId: 'gaurav', displayName: 'Gaurav', status: 'ACTIVE', rosterOrder: 0 },
    { studentId: 'student_fourth', displayName: 'Aarav', status: 'ACTIVE', rosterOrder: 3 },
    { studentId: 'nikhil', displayName: 'Nikhil', status: 'ARCHIVED', rosterOrder: 1 },
  ];
  assert.deepEqual(toOperationalRoster([]), []);
  assert.deepEqual(toOperationalRoster(students).map((member) => member.id), ['gaurav', 'student_fourth']);
  assert.deepEqual(toOperationalRoster(students, { includeArchived: true }).map((member) => member.id),
    ['gaurav', 'nikhil', 'student_fourth']);
});

test('expense editor preserves a fourth student custom allocation', () => {
  const state = buildExpenseEditInitialValues({ amountPaise: 101,
    allocations: [{ memberId: 'student_fourth', amountPaise: 51 }, { memberId: 'gaurav', amountPaise: 50 }] });
  assert.equal(state.customAmounts.student_fourth, '0.51');
  assert.equal(state.customAmounts.gaurav, '0.50');
});
