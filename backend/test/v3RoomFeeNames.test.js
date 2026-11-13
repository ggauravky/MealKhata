import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import { ROLES } from '../src/auth/permissions.js';
import { SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createRoomFeeService } from '../src/roomFees/roomFee.service.js';
import {
  serializeFeePlan, serializeRoom, serializeRoomAssignment,
  serializeRoomCharge, serializeRoomPayment,
} from '../src/roomFees/roomFee.serializer.js';
import { createRoomFeeRouter, createRoomRouter } from '../src/routes/roomFee.routes.js';
import { InMemoryRoomFeeRepository } from './helpers/inMemoryRoomFeeRepository.js';
import { testSessionToken, createTestApp } from './helpers/testAuth.js';

const FOURTH = 'student_00000000000000000000000000000004';
const FIFTH = 'student_00000000000000000000000000000005';
const ORIGIN = 'http://localhost:5173';
const students = [
  { studentId: 'gaurav', displayName: 'Gaurav Renamed', status: 'ACTIVE' },
  { studentId: 'nikhil', displayName: 'Nikhil', status: 'ACTIVE' },
  { studentId: 'devansh', displayName: 'Devansh', status: 'ACTIVE' },
  { studentId: FOURTH, displayName: 'Asha Renamed', status: 'ACTIVE' },
  { studentId: FIFTH, displayName: 'Mira Archived', status: 'ARCHIVED' },
];

test('v3 Room Fee service fails closed without a student directory', () => {
  assert.throws(() => createRoomFeeService({
    repository: new InMemoryRoomFeeRepository(), students: null,
  }), /student directory.*required/i);
});

test('fee reconciliation preview keeps dynamic names on existing plans', async () => {
  const repository = new InMemoryRoomFeeRepository();
  repository.getFeeScheduleState = async () => ({ revision: 0 });
  const directory = {
    listAll: async () => students,
    assertKnown: async studentId => {
      if (!students.some(student => student.studentId === studentId)) throw new Error('Unknown student');
    },
  };
  const service = createRoomFeeService({ repository, students: directory,
    now: () => new Date('2026-11-06T12:00:00Z') });
  await service.createFeePlan({ memberId: FOURTH, amountPaise: 90000,
    effectiveFromMonth: '2026-11', actorRole: 'superadmin' });
  const preview = await service.previewFeePlanReconciliation({ memberId: FOURTH,
    schedule: [{ effectiveFromMonth: '2026-11', amountPaise: 90000, dueDay: 5 }],
    reason: 'Verify dynamic preview names', actorRole: 'superadmin' });
  assert.equal(preview.currentPlans[0].memberName, 'Asha Renamed');
});

test('Room Fee serializers resolve current, renamed and archived identities from a directory', () => {
  const studentNames = new Map(students.map(({ studentId, displayName }) => [studentId, displayName]));
  const room = { roomId: 'r-1', roomNumber: '104', roomLabel: 'Room 104', capacity: 3, active: true };
  const assignment = { assignmentId: 'a-1', roomId: 'r-1', memberId: FOURTH,
    effectiveFromMonth: '2026-11' };
  const plan = { feePlanId: 'p-1', memberId: FIFTH, amountPaise: 90000 };
  const payment = { roomPaymentId: 'pay-1', chargeId: 'c-1', memberId: FOURTH,
    amountPaise: 25000, status: 'verified' };
  const charge = { chargeId: 'c-1', memberId: FOURTH, baseAmountPaise: 100000,
    dueDate: '2026-11-30', status: 'issued' };

  assert.deepEqual(serializeRoom(room, { currentOccupants: ['gaurav', FOURTH, FIFTH], studentNames })
    .currentOccupants.map(row => row.name), ['Gaurav Renamed', 'Asha Renamed', 'Mira Archived']);
  assert.equal(serializeRoomAssignment(assignment, new Map([['r-1', room]]), { studentNames }).memberName,
    'Asha Renamed');
  assert.equal(serializeFeePlan(plan, { studentNames }).memberName, 'Mira Archived');
  assert.equal(serializeRoomPayment(payment, { studentNames }).memberName, 'Asha Renamed');
  const serializedCharge = serializeRoomCharge(charge, { payments: [payment], studentNames });
  assert.equal(serializedCharge.memberName, 'Asha Renamed');
  assert.equal(serializedCharge.payments[0].memberName, 'Asha Renamed');
  assert.equal(serializeFeePlan({ ...plan, memberId: 'legacy_missing' }, { studentNames }).memberName,
    'legacy_missing');
});

test('Room Fee REST names remain dynamic through assignments, charges, payments and summary', async () => {
  const repository = new InMemoryRoomFeeRepository();
  const directory = {
    listAll: async () => students,
    assertKnown: async id => students.find(student => student.studentId === id),
  };
  const service = createRoomFeeService({ repository, students: directory,
    now: () => new Date('2026-11-07T12:00:00.000Z') });
  const app = createTestApp({
    roomFees: createRoomFeeRouter({ service, broadcast: () => {} }),
    rooms: createRoomRouter({ service, broadcast: () => {} }),
  });
  const cookie = `${SESSION_COOKIE_NAME}=${await testSessionToken(ROLES.ADMIN)}`;
  const created = await request(app).post('/api/room-fees/rooms')
    .set('Origin', ORIGIN).set('Cookie', cookie)
    .send({ roomNumber: 'dyn-104', capacity: 2 });
  assert.equal(created.status, 201);
  const assigned = await request(app).post('/api/room-fees/assignments')
    .set('Origin', ORIGIN).set('Cookie', cookie)
    .send({ memberId: FOURTH, roomId: created.body.data.roomId,
      effectiveFromMonth: '2026-11' });
  assert.equal(assigned.status, 201);
  assert.equal(assigned.body.data.memberName, 'Asha Renamed');
  const rooms = await request(app).get('/api/room-fees/rooms').set('Cookie', cookie);
  assert.equal(rooms.status, 200);
  assert.equal(rooms.body.data[0].currentOccupants[0].name, 'Asha Renamed');
  const plan = await request(app).post('/api/room-fees/plans')
    .set('Origin', ORIGIN).set('Cookie', cookie)
    .send({ memberId: FOURTH, amountPaise: 90000, effectiveFromMonth: '2026-11' });
  assert.equal(plan.status, 201);
  assert.equal(plan.body.data.memberName, 'Asha Renamed');
  const plans = await request(app).get(`/api/room-fees/plans/${FOURTH}`).set('Cookie', cookie);
  assert.equal(plans.body.data[0].memberName, 'Asha Renamed');
  const issued = await request(app).post('/api/room-fees/charges/issue')
    .set('Origin', ORIGIN).set('Cookie', cookie).send({ month: '2026-11' });
  assert.equal(issued.status, 200);
  assert.equal(issued.body.data.charges[0].memberName, 'Asha Renamed');
  const chargeId = issued.body.data.charges[0].chargeId;
  const payment = await request(app).post('/api/room-fees/payments')
    .set('Origin', ORIGIN).set('Cookie', cookie)
    .send({ chargeId, memberId: FOURTH, month: '2026-11', amountPaise: 25000,
      method: 'upi', reference: 'DYNAMIC-FOURTH-ROOM', idempotencyKey: randomUUID() });
  assert.equal(payment.status, 201);
  assert.equal(payment.body.data.memberName, 'Asha Renamed');
  const charges = await request(app).get('/api/room-fees/charges/2026-11').set('Cookie', cookie);
  assert.equal(charges.body.data[0].memberName, 'Asha Renamed');
  assert.equal(charges.body.data[0].payments[0].memberName, 'Asha Renamed');
  const history = await request(app).get(`/api/room-fees/me/history?memberId=${FOURTH}`)
    .set('Cookie', cookie);
  assert.equal(history.body.data.charges[0].memberName, 'Asha Renamed');
  const summary = await request(app).get('/api/room-fees/summary/2026-11').set('Cookie', cookie);
  const fourth = summary.body.data.members.find(row => row.memberId === FOURTH);
  assert.equal(fourth.memberName, 'Asha Renamed');
  assert.equal(fourth.charge.memberName, 'Asha Renamed');
});

test('archiving a student stops new Room Fee charges while preserving their records', async () => {
  const repository = new InMemoryRoomFeeRepository();
  const roster = students.map(student => ({ ...student }));
  const archived = roster.find(student => student.studentId === FIFTH);
  archived.status = 'ACTIVE';
  const service = createRoomFeeService({ repository,
    students: { listAll: async () => roster,
      assertKnown: async id => roster.find(student => student.studentId === id) },
    now: () => new Date('2026-11-07T12:00:00.000Z') });
  const room = await service.createRoom({ roomNumber: 'archived-room', capacity: 1,
    actorRole: ROLES.ADMIN });
  await service.assignMemberToRoom({ memberId: FIFTH, roomId: room.roomId,
    effectiveFromMonth: '2026-11', actorRole: ROLES.ADMIN });
  await service.createFeePlan({ memberId: FIFTH, amountPaise: 90000,
    effectiveFromMonth: '2026-11', actorRole: ROLES.ADMIN });
  archived.status = 'ARCHIVED';

  const issued = await service.issueCharges('2026-11', ROLES.ADMIN);
  assert.equal(issued.issuedCount, 0);
  assert.deepEqual(await service.getChargesForMonth('2026-11', ROLES.ADMIN), []);
  const plans = await service.getFeePlansForMember(FIFTH);
  assert.equal(plans[0].memberName, 'Mira Archived');
});
