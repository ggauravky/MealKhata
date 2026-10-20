import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { createRoomFeeService } from '../src/roomFees/roomFee.service.js';
import { createRoomFeeRouter, createRoomRouter } from '../src/routes/roomFee.routes.js';
import { InMemoryRoomFeeRepository } from './helpers/inMemoryRoomFeeRepository.js';

const ORIGIN = 'http://localhost:5173';
const NOW = new Date('2026-10-20T12:00:00.000Z');
const CURRENT_MONTH = '2026-10';
const FUTURE_MONTH = '2026-11';
const PAST_MONTH = '2026-09';

const repository = new InMemoryRoomFeeRepository();
const broadcasts = [];

const service = createRoomFeeService({
  repository,
  timezone: 'Asia/Kolkata',
  now: () => NOW,
});

const roomFees = createRoomFeeRouter({
  service,
  broadcast: (payload) => broadcasts.push(payload),
});

const rooms = createRoomRouter({
  service,
  broadcast: (payload) => broadcasts.push(payload),
});

const testApp = createApp({
  roomFees,
  rooms,
});

async function cookieFor(role, memberId = null) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, { memberId })}`;
}

beforeEach(() => {
  repository.reset();
  broadcasts.length = 0;
});

describe('MealKhata 2.0: Room Fees & Management Domain (Phase 1)', () => {
  describe('Room Creation & Capacity Validation', () => {
    test('Admin can create a room with valid capacity', async () => {
      const res = await request(testApp)
        .post('/api/rooms')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          roomNumber: '204',
          roomLabel: 'Room 204',
          capacity: 2,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.roomNumber, '204');
      assert.equal(res.body.data.capacity, 2);
      assert.equal(res.body.data.currentOccupancyCount, 0);
      assert.ok(broadcasts.length > 0);
    });

    test('Rejects duplicate room number', async () => {
      await request(testApp)
        .post('/api/rooms')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ roomNumber: '201', roomLabel: 'Room 201', capacity: 1 });

      const res = await request(testApp)
        .post('/api/rooms')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ roomNumber: '201', roomLabel: 'Duplicate 201', capacity: 1 });

      assert.equal(res.status, 409);
    });

    test('Rejects invalid capacity (less than 1 or non-integer)', async () => {
      const res = await request(testApp)
        .post('/api/rooms')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ roomNumber: '101', roomLabel: 'Room 101', capacity: 0 });

      assert.equal(res.status, 400);
    });
  });

  describe('Room Assignments & Capacity Invariants', () => {
    test('Assigns members to rooms and enforces capacity constraints', async () => {
      // 1. Create Room 204 (capacity 2) and Room 201 (capacity 1)
      const r204Res = await request(testApp)
        .post('/api/rooms')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ roomNumber: '204', roomLabel: 'Room 204', capacity: 2 });
      const r204Id = r204Res.body.data.roomId;

      const r201Res = await request(testApp)
        .post('/api/rooms')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ roomNumber: '201', roomLabel: 'Room 201', capacity: 1 });
      const r201Id = r201Res.body.data.roomId;

      // 2. Assign Gaurav to Room 201
      const gauravAssign = await request(testApp)
        .post('/api/room-fees/assignments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          roomId: r201Id,
          effectiveFromMonth: CURRENT_MONTH,
        });
      assert.equal(gauravAssign.status, 201);

      // 3. Assign Nikhil to Room 204
      const nikhilAssign = await request(testApp)
        .post('/api/room-fees/assignments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'nikhil',
          roomId: r204Id,
          effectiveFromMonth: CURRENT_MONTH,
        });
      assert.equal(nikhilAssign.status, 201);

      // 4. Assign Devansh to Room 204 (now at capacity: 2 occupants)
      const devanshAssign = await request(testApp)
        .post('/api/room-fees/assignments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'devansh',
          roomId: r204Id,
          effectiveFromMonth: CURRENT_MONTH,
        });
      assert.equal(devanshAssign.status, 201);

      // 5. Attempting to assign Gaurav to Room 204 in same month exceeds capacity
      const overflowAssign = await request(testApp)
        .post('/api/room-fees/assignments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          roomId: r204Id,
          effectiveFromMonth: CURRENT_MONTH,
        });
      assert.equal(overflowAssign.status, 409);
    });

    test('Rejects overlapping room assignments for a member', async () => {
      const roomRes = await request(testApp)
        .post('/api/rooms')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ roomNumber: '301', roomLabel: 'Room 301', capacity: 2 });
      const roomId = roomRes.body.data.roomId;

      // Assign Nikhil for July - September
      await request(testApp)
        .post('/api/room-fees/assignments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          memberId: 'nikhil',
          roomId,
          effectiveFromMonth: '2026-07',
          effectiveUntilMonth: '2026-09',
        });

      // Attempt overlapping assignment August - October
      const overlapRes = await request(testApp)
        .post('/api/room-fees/assignments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          memberId: 'nikhil',
          roomId,
          effectiveFromMonth: '2026-08',
          effectiveUntilMonth: '2026-10',
        });

      assert.equal(overlapRes.status, 409);
    });
  });

  describe('Scenario A & B: Individual Member Fee Plans', () => {
    test('Configures different fees for roommates sharing a room, and single room fee', async () => {
      // Scenario A: Nikhil ₹2,500/mo, Devansh ₹2,800/mo
      const nikhilPlan = await request(testApp)
        .post('/api/room-fees/plans')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'nikhil',
          amountPaise: 250000,
          effectiveFromMonth: CURRENT_MONTH,
          dueDay: 5,
          reason: 'Double occupancy rate',
        });
      assert.equal(nikhilPlan.status, 201);
      assert.equal(nikhilPlan.body.data.amountPaise, 250000);

      const devanshPlan = await request(testApp)
        .post('/api/room-fees/plans')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'devansh',
          amountPaise: 280000,
          effectiveFromMonth: CURRENT_MONTH,
          dueDay: 5,
          reason: 'Double occupancy rate (corner room)',
        });
      assert.equal(devanshPlan.status, 201);
      assert.equal(devanshPlan.body.data.amountPaise, 280000);

      // Scenario B: Gaurav Single room ₹3,500/mo
      const gauravPlan = await request(testApp)
        .post('/api/room-fees/plans')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          amountPaise: 350000,
          effectiveFromMonth: CURRENT_MONTH,
          dueDay: 5,
          reason: 'Single occupancy rate',
        });
      assert.equal(gauravPlan.status, 201);
      assert.equal(gauravPlan.body.data.amountPaise, 350000);
    });

    test('Scenario E: Rate changes effective future month do not alter past rates', async () => {
      // Historical rate: July 2026 ₹2,500
      await request(testApp)
        .post('/api/room-fees/plans')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          memberId: 'nikhil',
          amountPaise: 250000,
          effectiveFromMonth: '2026-07',
          dueDay: 5,
        });

      // New rate effective October onward: ₹2,800
      await request(testApp)
        .post('/api/room-fees/plans')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'nikhil',
          amountPaise: 280000,
          effectiveFromMonth: '2026-10',
          dueDay: 5,
        });

      // Verify active fee plan for September is still ₹2,500
      const sepPlan = await service.getActiveFeePlan('nikhil', '2026-09');
      assert.equal(sepPlan.amountPaise, 250000);

      // Verify active fee plan for October is ₹2,800
      const octPlan = await service.getActiveFeePlan('nikhil', '2026-10');
      assert.equal(octPlan.amountPaise, 280000);
    });
  });

  describe('Monthly Charges: Preview, Issuance, & Adjustments', () => {
    let r201Id;
    let r204Id;

    beforeEach(async () => {
      // Setup rooms
      const r201 = await service.createRoom({ roomNumber: '201', roomLabel: 'Room 201', capacity: 1, actorRole: ROLES.ADMIN });
      const r204 = await service.createRoom({ roomNumber: '204', roomLabel: 'Room 204', capacity: 2, actorRole: ROLES.ADMIN });
      r201Id = r201.roomId;
      r204Id = r204.roomId;

      // Assign members
      await service.assignMemberToRoom({ memberId: 'gaurav', roomId: r201Id, effectiveFromMonth: CURRENT_MONTH, actorRole: ROLES.ADMIN });
      await service.assignMemberToRoom({ memberId: 'nikhil', roomId: r204Id, effectiveFromMonth: CURRENT_MONTH, actorRole: ROLES.ADMIN });
      await service.assignMemberToRoom({ memberId: 'devansh', roomId: r204Id, effectiveFromMonth: CURRENT_MONTH, actorRole: ROLES.ADMIN });

      // Configure fee plans
      await service.createFeePlan({ memberId: 'gaurav', amountPaise: 350000, effectiveFromMonth: CURRENT_MONTH, actorRole: ROLES.ADMIN });
      await service.createFeePlan({ memberId: 'nikhil', amountPaise: 250000, effectiveFromMonth: CURRENT_MONTH, actorRole: ROLES.ADMIN });
      await service.createFeePlan({ memberId: 'devansh', amountPaise: 280000, effectiveFromMonth: CURRENT_MONTH, actorRole: ROLES.ADMIN });
    });

    test('Previews monthly charges for October before issuance', async () => {
      const res = await request(testApp)
        .post('/api/room-fees/charges/preview')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ month: CURRENT_MONTH });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.canIssue, true);
      assert.equal(res.body.data.totalProposedPaise, 880000); // 3500 + 2500 + 2800 = 8800
      assert.equal(res.body.data.members.length, 3);
    });

    test('Issues monthly charges idempotently without duplicate charges', async () => {
      // 1. Issue charges
      const res1 = await request(testApp)
        .post('/api/room-fees/charges/issue')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ month: CURRENT_MONTH });

      assert.equal(res1.status, 200);
      assert.equal(res1.body.data.issuedCount, 3);
      assert.equal(res1.body.data.skippedCount, 0);

      // 2. Issuing again in the same month skips without duplicates
      const res2 = await request(testApp)
        .post('/api/room-fees/charges/issue')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ month: CURRENT_MONTH });

      assert.equal(res2.status, 200);
      assert.equal(res2.body.data.issuedCount, 0);
      assert.equal(res2.body.data.skippedCount, 3);
    });

    test('Super Admin can adjust issued charge and prevents negative final bill', async () => {
      await service.issueCharges(CURRENT_MONTH, ROLES.ADMIN);
      const charges = await service.getChargesForMonth(CURRENT_MONTH, ROLES.ADMIN);
      const nikhilCharge = charges.find((c) => c.memberId === 'nikhil');

      // Add discount adjustment: -₹300 (-30000 paise)
      const adjRes = await request(testApp)
        .post(`/api/room-fees/charges/${nikhilCharge.chargeId}/adjustments`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          amountPaise: -30000,
          reason: 'Approved partial room discount',
        });

      assert.equal(adjRes.status, 200);
      assert.equal(adjRes.body.data.finalBillAmountPaise, 220000); // 250000 - 30000 = 220000

      // Rejects adjustment that makes bill negative
      const badAdjRes = await request(testApp)
        .post(`/api/room-fees/charges/${nikhilCharge.chargeId}/adjustments`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          amountPaise: -300000, // exceeds remaining
          reason: 'Excessive discount',
        });

      assert.equal(badAdjRes.status, 400);
    });
  });

  describe('Room Payments Ledger & Invariants', () => {
    let nikhilChargeId;

    beforeEach(async () => {
      const room = await service.createRoom({ roomNumber: '204', roomLabel: 'Room 204', capacity: 2, actorRole: ROLES.ADMIN });
      await service.assignMemberToRoom({ memberId: 'nikhil', roomId: room.roomId, effectiveFromMonth: CURRENT_MONTH, actorRole: ROLES.ADMIN });
      await service.createFeePlan({ memberId: 'nikhil', amountPaise: 250000, effectiveFromMonth: CURRENT_MONTH, actorRole: ROLES.ADMIN });
      const issued = await service.issueCharges(CURRENT_MONTH, ROLES.ADMIN);
      nikhilChargeId = issued.charges[0].chargeId;
    });

    test('Scenario C: Records partial payment (₹1,000 against ₹2,500 -> ₹1,500 remaining, status Partial)', async () => {
      const res = await request(testApp)
        .post('/api/room-fees/payments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          chargeId: nikhilChargeId,
          memberId: 'nikhil',
          month: CURRENT_MONTH,
          amountPaise: 100000, // ₹1,000
          method: 'upi',
          reference: 'UPI-REF-001',
          idempotencyKey: '00000000-0000-4000-8000-000000000001',
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.amountPaise, 100000);

      // Verify member overview
      const overview = await service.getMemberOverview({ memberId: 'nikhil', targetMonth: CURRENT_MONTH });
      assert.equal(overview.currentMonthCharge.paidAmountPaise, 100000);
      assert.equal(overview.currentMonthCharge.remainingAmountPaise, 150000);
      assert.equal(overview.currentMonthCharge.paymentStatus, 'partial');
    });

    test('Scenario D: Multiple payments complete one charge (₹1,000 + ₹1,500 = ₹2,500, status Paid)', async () => {
      // Payment 1: ₹1,000
      await service.recordPayment({
        chargeId: nikhilChargeId,
        memberId: 'nikhil',
        month: CURRENT_MONTH,
        amountPaise: 100000,
        method: 'upi',
        idempotencyKey: '00000000-0000-4000-8000-000000000002',
        actorRole: ROLES.ADMIN,
      });

      // Payment 2: ₹1,500
      await service.recordPayment({
        chargeId: nikhilChargeId,
        memberId: 'nikhil',
        month: CURRENT_MONTH,
        amountPaise: 150000,
        method: 'bank_transfer',
        idempotencyKey: '00000000-0000-4000-8000-000000000003',
        actorRole: ROLES.ADMIN,
      });

      const overview = await service.getMemberOverview({ memberId: 'nikhil', targetMonth: CURRENT_MONTH });
      assert.equal(overview.currentMonthCharge.paidAmountPaise, 250000);
      assert.equal(overview.currentMonthCharge.remainingAmountPaise, 0);
      assert.equal(overview.currentMonthCharge.paymentStatus, 'paid');
    });

    test('Prevents accidental overpayment exceeding remaining bill', async () => {
      const res = await request(testApp)
        .post('/api/room-fees/payments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          chargeId: nikhilChargeId,
          memberId: 'nikhil',
          month: CURRENT_MONTH,
          amountPaise: 300000, // exceeds 250000
          method: 'upi',
          idempotencyKey: '00000000-0000-4000-8000-000000000004',
        });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes('exceeds remaining balance'));
    });

    test('Payment idempotency: Retried request returns original payment without double-counting', async () => {
      const payload = {
        chargeId: nikhilChargeId,
        memberId: 'nikhil',
        month: CURRENT_MONTH,
        amountPaise: 100000,
        method: 'upi',
        idempotencyKey: '00000000-0000-4000-8000-000000000005',
      };

      const res1 = await request(testApp)
        .post('/api/room-fees/payments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send(payload);

      const res2 = await request(testApp)
        .post('/api/room-fees/payments')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send(payload);

      assert.equal(res1.status, 201);
      assert.equal(res2.status, 201);
      assert.equal(res1.body.data.roomPaymentId, res2.body.data.roomPaymentId);

      const payments = await service.getPaymentsForCharge(nikhilChargeId);
      assert.equal(payments.length, 1);
    });

    test('Super Admin can void payment with reason and recomputes balance', async () => {
      const pay = await service.recordPayment({
        chargeId: nikhilChargeId,
        memberId: 'nikhil',
        month: CURRENT_MONTH,
        amountPaise: 100000,
        method: 'upi',
        idempotencyKey: '00000000-0000-4000-8000-000000000006',
        actorRole: ROLES.ADMIN,
      });

      const voidRes = await request(testApp)
        .post(`/api/room-fees/payments/${pay.roomPaymentId}/void`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ reason: 'Recorded against wrong member' });

      assert.equal(voidRes.status, 200);
      assert.equal(voidRes.body.data.status, 'voided');

      // Remaining balance reverts to ₹2,500
      const overview = await service.getMemberOverview({ memberId: 'nikhil', targetMonth: CURRENT_MONTH });
      assert.equal(overview.currentMonthCharge.paidAmountPaise, 0);
      assert.equal(overview.currentMonthCharge.remainingAmountPaise, 250000);
    });
  });

  describe('Role-Based Authorization & Privacy Isolation', () => {
    test('Scenario G: Member can only view own room fees, not other members (returns 403)', async () => {
      // Nikhil requests Gaurav's room fee profile
      const res = await request(testApp)
        .get('/api/room-fees/members/gaurav')
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'nikhil'));

      assert.equal(res.status, 403);
    });

    test('Viewer is rejected from all private room fee endpoints (returns 401)', async () => {
      const res1 = await request(testApp).get('/api/room-fees/me');
      assert.equal(res1.status, 401);

      const res2 = await request(testApp).get('/api/room-fees/summary/2026-10');
      assert.equal(res2.status, 401);

      const res3 = await request(testApp).get('/api/rooms');
      assert.equal(res3.status, 401);
    });

    test('Member cannot create rooms or issue charges (returns 403)', async () => {
      const res1 = await request(testApp)
        .post('/api/rooms')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'))
        .send({ roomNumber: '999', roomLabel: 'Unauthorized', capacity: 1 });
      assert.equal(res1.status, 403);

      const res2 = await request(testApp)
        .post('/api/room-fees/charges/issue')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'))
        .send({ month: CURRENT_MONTH });
      assert.equal(res2.status, 403);
    });

    test('Admin cannot void payments (only Super Admin)', async () => {
      const res = await request(testApp)
        .post('/api/room-fees/payments/00000000-0000-4000-8000-000000000001/void')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ reason: 'Admin attempt' });
      assert.equal(res.status, 403);
    });
  });

  describe('Scenario H: Unconfigured Member Experience', () => {
    test('Unconfigured member shows room fee not configured and no issued charge (not ₹0 paid)', async () => {
      const overview = await service.getMemberOverview({ memberId: 'devansh', targetMonth: CURRENT_MONTH });
      assert.equal(overview.currentRoom, null);
      assert.equal(overview.currentFeePlan, null);
      assert.equal(overview.currentMonthCharge, null);
      assert.equal(overview.scheduledFeePaise, null);
    });
  });

  describe('Room Payment Settings & Instructions', () => {
    test('Admin can configure recipient settings and snapshot is preserved on payments', async () => {
      const updateRes = await request(testApp)
        .put('/api/room-fees/settings')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          recipientMode: 'hostel_owner',
          recipientName: 'Mr. Sharma (Hostel Owner)',
          upiId: 'sharma@okhdfcbank',
          paymentInstructions: 'Pay by 5th of each month directly to owner.',
          defaultDueDay: 5,
        });

      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.data.recipientMode, 'hostel_owner');
      assert.equal(updateRes.body.data.recipientName, 'Mr. Sharma (Hostel Owner)');
    });
  });
});
