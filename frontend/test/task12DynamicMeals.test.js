import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPresetAllocation, splitMealCost, validatePlateAllocation, PRESET_NAMES } from '../src/lib/plates.js';
import { createPresetAllocation as backendPreset, splitMealCost as backendSplit } from '../../backend/src/meals/plateAllocation.service.js';
import { canEditMealParticipant, resolveDayParticipants } from '../src/lib/operationalRoster.js';
import { canLoadMemberFinance } from '../src/lib/financePermissions.js';

const participants = ['gaurav', 'nikhil', 'devansh', 'student_fourth', 'student_fifth'];

test('day roster renders zero, one, four, and many without adding later students to saved history', () => {
  const roster = participants.map((id) => ({ id, name: id.toUpperCase() }));
  assert.deepEqual(resolveDayParticipants({ participantOrder: [], meals: { morning: {} } }, roster), []);
  assert.deepEqual(resolveDayParticipants({ participantOrder: ['gaurav'] }, roster).map((row) => row.id), ['gaurav']);
  assert.deepEqual(resolveDayParticipants({ participantOrder: participants.slice(0, 4) }, roster).map((row) => row.id), participants.slice(0, 4));
  assert.deepEqual(resolveDayParticipants({ participantOrder: participants }, roster).map((row) => row.id), participants);
  assert.deepEqual(resolveDayParticipants({ participantOrder: ['nikhil'] },
    roster.filter((row) => row.id !== 'nikhil')), [{ id: 'nikhil', name: 'nikhil' }]);
});

test('displayed participants never gain meal edit controls without server authorization', () => {
  const allowed = { editable: true, onChange: () => {}, editableMemberIds: ['student_fourth'] };
  assert.equal(canEditMealParticipant({ ...allowed, memberId: 'student_fourth' }), true);
  assert.equal(canEditMealParticipant({ ...allowed, memberId: 'nikhil' }), false);
  assert.equal(canEditMealParticipant({ ...allowed, editable: false, memberId: 'student_fourth' }), false);
  assert.equal(canEditMealParticipant({ ...allowed, editableMemberIds: null, memberId: 'student_fourth' }), false);
});

test('dashboard requests personal finance only for the signed-in member', () => {
  assert.equal(canLoadMemberFinance({ month: '2026-11', authenticated: true, role: 'member' }), true);
  assert.equal(canLoadMemberFinance({ month: '2026-11', authenticated: true, role: 'superadmin' }), false);
  assert.equal(canLoadMemberFinance({ month: '2026-11', authenticated: true, role: 'admin' }), false);
  assert.equal(canLoadMemberFinance({ month: '2026-11', authenticated: true, role: 'admin', targetMemberId: 'gaurav' }), true);
});

test('selected presets do not allocate to unrelated students', () => {
  const selected = ['gaurav', 'student_fourth', 'student_fifth'];
  for (const preset of [PRESET_NAMES.ONE_PLATE_THREE_SHARED, PRESET_NAMES.TWO_PLATES_THREE_EQUAL,
    PRESET_NAMES.TWO_PLATES_ONE_FULL_TWO_HALF, PRESET_NAMES.THREE_PLATES_THREE_FULL]) {
    const allocation = createPresetAllocation(preset, { participants, members: selected });
    assert.deepEqual(allocation, backendPreset(preset, { participants, members: selected }));
    validatePlateAllocation(allocation, { participants, maxPhysicalPlates: 5 });
    assert.equal(allocation.plates.every((plate) => plate.shares.nikhil === 0), true);
  }
});

test('five-student custom sharing matches backend exact odd-paise allocation', () => {
  const allocation = { mode: 'custom', plates: [{ shares: {
    gaurav: 1, nikhil: 1, devansh: 1, student_fourth: 1, student_fifth: 2,
  } }] };
  validatePlateAllocation(allocation, { participants, maxPhysicalPlates: 5 });
  const input = { date: '2026-11-04', mealType: 'night', effectiveAllocation: allocation,
    pricePaise: 101, participants };
  const preview = splitMealCost(input);
  assert.deepEqual(preview, backendSplit(input));
  assert.equal(Object.values(preview.members).reduce((sum, member) => sum + member.amountPaise, 0), 101);
  assert.throws(() => validatePlateAllocation({ mode: 'custom', plates: [{ shares: { ...allocation.plates[0].shares, student_fifth: 1 } }] },
    { participants, maxPhysicalPlates: 5 }), /exactly 6/);
});

test('server plate limit permits five default plates and rejects a lower cap', () => {
  const allocation = createPresetAllocation(PRESET_NAMES.INDIVIDUAL, { participants });
  validatePlateAllocation(allocation, { participants, maxPhysicalPlates: 5 });
  assert.throws(() => validatePlateAllocation(allocation, { participants, maxPhysicalPlates: 4 }), /more than 4/);
});
