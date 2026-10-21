import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { createRoomFeeService } from '../src/roomFees/roomFee.service.js';
import { createRoomFeeRouter, createRoomRouter } from '../src/routes/roomFee.routes.js';
import { createStayService } from '../src/stays/stay.service.js';
import { createDepositService } from '../src/stays/deposit.service.js';
import { createLifetimeReportService } from '../src/stays/lifetimeReport.service.js';
import { createLifetimePdfService } from '../src/stays/lifetimePdf.service.js';
import { createStayRouter } from '../src/routes/stay.routes.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { createMealService } from '../src/meals/meal.service.js';
import { InMemoryRoomFeeRepository } from './helpers/inMemoryRoomFeeRepository.js';
import { InMemoryStayRepository } from './helpers/inMemoryStayRepository.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { CLEARANCE_STATUSES, DEPOSIT_TRANSACTION_TYPES, STAY_STATUSES } from '../src/stays/stay.constants.js';

const ORIGIN = 'http://localhost:5173';
const NOW = new Date('2026-10-20T12:00:00.000Z');

// Repositories
const roomRepository = new InMemoryRoomFeeRepository();
const stayRepository = new InMemoryStayRepository();
const mealRepository = new InMemoryMealRepository();

// Room Service
const roomFeesService = createRoomFeeService({
  repository: roomRepository,
  timezone: 'Asia/Kolkata',
  now: () => NOW,
});

// Deposit Service
const depositsService = createDepositService({
  repository: stayRepository,
});

// Mock finance service for checkout review & lifetime aggregation
const mockFinanceService = {
  async getMemberFinancialOverview({ memberId, month }) {
    // Return predictable mock balances
    return {
      memberId,
      month,
      mess: { billPaise: 45000, paidPaise: 45000, remainingPaise: 0 },
      room: {
        status: 'configured',
        issuedChargePaise: 280000,
        paidPaise: 280000,
        remainingPaise: 0,
        roomNumber: '204',
      },
      expenses: {
        spendingSharePaise: 50000,
        owedToOthersPaise: 0,
        owedToMePaise: 0,
      },
      combined: {
        totalTrackedSpendingPaise: 375000,
        outstandingPayablePaise: 0,
        totalReceivablePaise: 0,
      },
      generatedAt: NOW.toISOString(),
    };
  },
};

// Stay Service
const staysService = createStayService({
  repository: stayRepository,
  roomFees: roomFeesService,
  finance: mockFinanceService,
  deposits: depositsService,
});

// Lifetime Report & PDF Services
const lifetimeReportsService = createLifetimeReportService({
  repository: stayRepository,
  finance: mockFinanceService,
  deposits: depositsService,
  roomFees: roomFeesService,
});

const pdfsService = createLifetimePdfService({
  repository: stayRepository,
  lifetimeReports: lifetimeReportsService,
});

const mealServiceInstance = createMealService({
  repository: mealRepository,
  timezone: 'Asia/Kolkata',
  now: () => NOW,
});

// Broadcast tracking
const broadcasts = [];

// Routers
const stayRouter = createStayRouter({
  service: staysService,
  deposits: depositsService,
  lifetimeReports: lifetimeReportsService,
  pdfService: pdfsService,
  broadcastStay: () => broadcasts.push({ type: 'stay' }),
  broadcastDeposit: () => broadcasts.push({ type: 'deposit' }),
  broadcastClearance: () => broadcasts.push({ type: 'clearance' }),
});

const roomFeesRouter = createRoomFeeRouter({
  service: roomFeesService,
  broadcast: () => {},
});

const roomsRouter = createRoomRouter({
  service: roomFeesService,
  broadcast: () => {},
});

const mealsRouter = createMealRouter({
  service: mealServiceInstance,
  stays: staysService,
  broadcast: () => {},
  now: () => NOW,
  timezone: 'Asia/Kolkata',
});

const testApp = createApp({
  stays: stayRouter,
  roomFees: roomFeesRouter,
  rooms: roomsRouter,
  meals: mealsRouter,
});

async function cookieFor(role, memberId = null) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, { memberId })}`;
}

let room204Id;
let room301Id;

async function resetState() {
  roomRepository.reset();
  stayRepository.reset();
  mealRepository.reset();
  broadcasts.length = 0;

  // Create initial rooms in roomRepository
  const r204 = await roomFeesService.createRoom({
    roomNumber: '204',
    roomLabel: 'Double Deluxe 204',
    capacity: 2,
    actorRole: ROLES.ADMIN,
  });
  room204Id = r204.roomId;

  const r301 = await roomFeesService.createRoom({
    roomNumber: '301',
    roomLabel: 'Single Suite 301',
    capacity: 1,
    actorRole: ROLES.ADMIN,
  });
  room301Id = r301.roomId;
}

beforeEach(async () => {
  await resetState();
});

describe('MealKhata 2.0 — Phase 4: Complete Hostel Lifecycle, Security Deposits & Clearances', () => {
  // ==========================================
  // 1. Stay Creation & Admission Invariants
  // ==========================================
  describe('Stay Lifecycle: Admission & Active Stay Constraints', () => {
    test('Admin can register a new hostel stay with room fee and deposit expected', async () => {
      const res = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-07-15',
          initialRoomId: room204Id,
          monthlyRatePaise: 280000,
          expectedDepositPaise: 500000,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.memberId, 'gaurav');
      assert.equal(res.body.data.status, STAY_STATUSES.ACTIVE);
      assert.equal(res.body.data.joinedOn, '2026-07-15');
      assert.equal(res.body.data.currentRoomId, room204Id);

      // Verify deposit account created with expectedDepositPaise
      const depRes = await request(testApp)
        .get(`/api/stays/${res.body.data.stayId}/deposit`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));

      assert.equal(depRes.status, 200);
      assert.equal(depRes.body.data.summary.expectedPaise, 500000);
      assert.equal(depRes.body.data.summary.receivedPaise, 0); // Expected is NOT received funds!
      assert.equal(depRes.body.data.summary.heldPaise, 0);
    });

    test('Rejects invalid memberId and invalid joining date format', async () => {
      const res1 = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'stranger',
          joinedOn: '2026-07-15',
          initialRoomId: room204Id,
        });

      assert.equal(res1.status, 400);

      const res2 = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '15-07-2026', // invalid format
          initialRoomId: room204Id,
        });

      assert.equal(res2.status, 400);
    });

    test('Rejects duplicate active stay for the same resident', async () => {
      // First stay
      await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-07-15',
          initialRoomId: room204Id,
        });

      // Second simultaneous stay for Gaurav must be rejected
      const res = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-08-01',
          initialRoomId: room204Id,
        });

      assert.equal(res.status, 409);
      assert.match(res.body.message, /already has an active or pending hostel stay/i);
    });

    test('Member can view own stay, but cannot view another member stay', async () => {
      const stayRes = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-07-15',
          initialRoomId: room204Id,
        });
      const stayId = stayRes.body.data.stayId;

      // Gaurav viewing his own stay
      const gauravRes = await request(testApp)
        .get(`/api/stays/${stayId}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'));
      assert.equal(gauravRes.status, 200);
      assert.equal(gauravRes.body.data.stayId, stayId);

      // Nikhil attempting to view Gaurav's stay
      const nikhilRes = await request(testApp)
        .get(`/api/stays/${stayId}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'nikhil'));
      assert.equal(nikhilRes.status, 403);
    });
  });

  // ==========================================
  // 2. Room Transfers & Capacity Validation
  // ==========================================
  describe('Auditable Room Transfers', () => {
    test('Admin transfers Nikhil from Room 204 to Room 301 and preserves history', async () => {
      const stayRes = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          memberId: 'nikhil',
          joinedOn: '2026-10-01',
          initialRoomId: room204Id,
          monthlyRatePaise: 250000,
        });
      const stayId = stayRes.body.data.stayId;

      // Perform transfer effective 2026-11-01 to Room 301 with new rate ₹3,000
      const transferRes = await request(testApp)
        .post(`/api/stays/${stayId}/transfers`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          newRoomId: room301Id,
          effectiveDate: '2026-11-01',
          newMonthlyRatePaise: 300000,
          reason: 'Moved to single suite for privacy',
        });

      assert.equal(transferRes.status, 200);
      assert.equal(transferRes.body.data.currentRoomId, room301Id);

      // Verify room history timeline has both assignments
      const historyRes = await request(testApp)
        .get(`/api/stays/${stayId}/room-history`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));

      assert.equal(historyRes.status, 200);
      assert.equal(historyRes.body.data.timeline.length, 2);
      assert.equal(historyRes.body.data.timeline[0].roomNumber, '204');
      assert.equal(historyRes.body.data.timeline[0].effectiveUntilMonth, '2026-10'); // Previous assignment capped!
      assert.equal(historyRes.body.data.timeline[1].roomNumber, '301');
      assert.equal(historyRes.body.data.timeline[1].effectiveFromMonth, '2026-11');
    });

    test('Rejects room transfer when destination room capacity is exceeded', async () => {
      // Room 301 has capacity 1. Assign Devansh to Room 301 first.
      await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          memberId: 'devansh',
          joinedOn: '2026-10-01',
          initialRoomId: room301Id,
        });

      // Nikhil joins Room 204
      const stayRes = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          memberId: 'nikhil',
          joinedOn: '2026-10-01',
          initialRoomId: room204Id,
        });
      const stayId = stayRes.body.data.stayId;

      // Nikhil tries to transfer into Room 301 which is already at max capacity (1)
      const transferRes = await request(testApp)
        .post(`/api/stays/${stayId}/transfers`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          newRoomId: room301Id,
          effectiveDate: '2026-11-01',
          reason: 'Wants room 301',
        });

      assert.equal(transferRes.status, 409);
      assert.match(transferRes.body.message, /capacity/i);
    });

    test('Rejects transfer to the same room', async () => {
      const stayRes = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-07-15',
          initialRoomId: room204Id,
        });

      const res = await request(testApp)
        .post(`/api/stays/${stayRes.body.data.stayId}/transfers`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          newRoomId: room204Id,
          effectiveDate: '2026-11-01',
          reason: 'No-op transfer',
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /already assigned to this room/i);
    });
  });

  // ==========================================
  // 3. Security Deposit Accounting & Invariants
  // ==========================================
  describe('Security Deposit Accounting & Invariants', () => {
    let stayId;

    beforeEach(async () => {
      await resetState();
      const stayRes = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-07-15',
          initialRoomId: room204Id,
          expectedDepositPaise: 500000, // ₹5,000
        });
      if (!stayRes.body.data) {
        console.error('STAY CREATE FAILED:', stayRes.status, stayRes.body);
      }
      stayId = stayRes.body.data.stayId;
    });

    test('Scenario C: Deposit receipts accumulate and held balance is exact integer paise', async () => {
      // 1st receipt: ₹3,000
      const r1 = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
          amountPaise: 300000,
          method: 'upi',
          reference: 'UPI-DEP-001',
          reason: 'Initial deposit instalment',
          idempotencyKey: 'idemp-dep-1',
        });

      assert.equal(r1.status, 201);
      assert.equal(r1.body.data.amountPaise, 300000);

      // Check balance: received ₹3,000, held ₹3,000
      let balRes = await request(testApp)
        .get(`/api/stays/${stayId}/deposit`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));
      assert.equal(balRes.body.data.summary.receivedPaise, 300000);
      assert.equal(balRes.body.data.summary.heldPaise, 300000);

      // 2nd receipt: ₹2,000
      const r2 = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
          amountPaise: 200000,
          method: 'cash',
          reference: 'REC-DEP-002',
          reason: 'Final deposit instalment',
          idempotencyKey: 'idemp-dep-2',
        });

      assert.equal(r2.status, 201);

      // Check balance: received ₹5,000, held ₹5,000
      balRes = await request(testApp)
        .get(`/api/stays/${stayId}/deposit`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));
      assert.equal(balRes.body.data.summary.receivedPaise, 500000);
      assert.equal(balRes.body.data.summary.heldPaise, 500000);
      assert.equal(balRes.body.data.summary.expectedPaise, 500000);
    });

    test('Scenario C: Super Admin records damage deduction and refund (held balance becomes 0)', async () => {
      // Receive ₹5,000
      await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
          amountPaise: 500000,
          method: 'upi',
          idempotencyKey: 'idemp-c-1',
        });

      // Deduct ₹800 for damage (Super Admin only)
      const dedRes = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.DEDUCTED,
          amountPaise: 80000,
          reason: 'Wall repair and repainting for nail damage',
          idempotencyKey: 'idemp-c-2',
        });

      assert.equal(dedRes.status, 201);

      // Check balance: received ₹5,000, deducted ₹800, held ₹4,200
      let balRes = await request(testApp)
        .get(`/api/stays/${stayId}/deposit`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));
      assert.equal(balRes.body.data.summary.heldPaise, 420000);
      assert.equal(balRes.body.data.summary.deductedPaise, 80000);

      // Refund remaining ₹4,200 (Super Admin only)
      const refRes = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
          amountPaise: 420000,
          method: 'upi',
          reference: 'UPI-REF-001',
          reason: 'Full remaining deposit refund upon departure',
          idempotencyKey: 'idemp-c-3',
        });

      assert.equal(refRes.status, 201);

      // Final balance: held ₹0, received ₹5,000, deducted ₹800, refunded ₹4,200
      balRes = await request(testApp)
        .get(`/api/stays/${stayId}/deposit`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));
      assert.equal(balRes.body.data.summary.heldPaise, 0);
      assert.equal(balRes.body.data.summary.refundedPaise, 420000);
      assert.equal(balRes.body.data.summary.deductedPaise, 80000);
    });

    test('Hard Invariant: Rejects refund or deduction that exceeds currently held deposit balance', async () => {
      // Receive ₹2,000
      await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
          amountPaise: 200000,
          idempotencyKey: 'idemp-inv-1',
        });

      // Attempt to refund ₹2,500 when only ₹2,000 is held
      const res = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
          amountPaise: 250000,
          method: 'upi',
          idempotencyKey: 'idemp-inv-2',
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /currently held/i);
    });

    test('Permissions: Member cannot record deposit transactions; Admin cannot record refund or deduction', async () => {
      // Member attempts to record own deposit receipt
      const memRes = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
          amountPaise: 500000,
        });
      assert.equal(memRes.status, 403);

      // Admin attempts to record a refund
      const admRes = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
          amountPaise: 100000,
        });
      assert.equal(admRes.status, 403);
    });

    test('Idempotency prevents duplicate deposit transactions on retries', async () => {
      const payload = {
        type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
        amountPaise: 150000,
        method: 'upi',
        idempotencyKey: 'unique-idemp-12345',
      };

      const res1 = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send(payload);
      assert.equal(res1.status, 201);

      // Retry exact request
      const res2 = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send(payload);
      assert.equal(res2.status, 201);
      assert.equal(res2.body.data.depositTransactionId, res1.body.data.depositTransactionId);

      // Total balance must be ₹1,500, NOT ₹3,000
      const balRes = await request(testApp)
        .get(`/api/stays/${stayId}/deposit`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));
      assert.equal(balRes.body.data.summary.heldPaise, 150000);
    });

    test('Super Admin can void a deposit transaction with audit reason and recalculates balance', async () => {
      const r1 = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
          amountPaise: 200000,
          idempotencyKey: 'tx-to-void',
        });
      const txId = r1.body.data.depositTransactionId;

      // Void the transaction
      const voidRes = await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions/${txId}/void`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ reason: 'Bank transaction bounced' });

      assert.equal(voidRes.status, 200);
      assert.equal(voidRes.body.data.status, 'voided');

      // Held balance should return to 0
      const balRes = await request(testApp)
        .get(`/api/stays/${stayId}/deposit`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));
      assert.equal(balRes.body.data.summary.heldPaise, 0);
    });
  });

  // ==========================================
  // 4. Checkout Workflow & Immutable Clearances
  // ==========================================
  describe('Checkout Workflow & Immutable Clearances', () => {
    let stayId;

    beforeEach(async () => {
      await resetState();
      const stayRes = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-07-01',
          initialRoomId: room204Id,
          expectedDepositPaise: 500000,
        });
      stayId = stayRes.body.data.stayId;
    });

    test('Member requests departure, and can cancel before admin finalization', async () => {
      // Gaurav requests checkout
      const reqRes = await request(testApp)
        .post('/api/stays/me/checkout-request')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'))
        .send({
          preferredLeaveDate: '2026-11-30',
          reason: 'Job relocation to Bengaluru',
        });

      assert.equal(reqRes.status, 200);
      assert.equal(reqRes.body.data.status, STAY_STATUSES.CHECKOUT_REQUESTED);

      // Gaurav cancels checkout request
      const cancelRes = await request(testApp)
        .delete('/api/stays/me/checkout-request')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'))
        .send({ reason: 'Offer delayed' });

      assert.equal(cancelRes.status, 200);
      assert.equal(cancelRes.body.data.status, STAY_STATUSES.ACTIVE);
    });

    test('Financial review separates Mess, Room, Expenses, and Security Deposit', async () => {
      // Put stay into checkout pending
      await request(testApp)
        .post(`/api/stays/${stayId}/checkout-review`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));

      const reviewRes = await request(testApp)
        .get(`/api/stays/${stayId}/financial-review`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));

      assert.equal(reviewRes.status, 200);
      const data = reviewRes.body.data;
      assert.ok(data.financialOverview.mess);
      assert.ok(data.financialOverview.room);
      assert.ok(data.financialOverview.expenses);
      assert.ok(data.depositOverview);
      assert.equal(typeof data.isEligibleForNoDues, 'boolean');
    });

    test('Scenario D: Checkout with unresolved dues blocks No-Dues clearance, but Super Admin can finalize exception', async () => {
      // Configure mock finance service to return dues
      const duesFinanceService = {
        async getMemberFinancialOverview() {
          return {
            mess: { remainingPaise: 50000 }, // ₹500 mess due
            room: { remainingPaise: 100000 }, // ₹1,000 room due
            expenses: { owedToOthersPaise: 20000, owedToMePaise: 0 }, // ₹200 expense owed
            combined: { outstandingPayablePaise: 170000, totalReceivablePaise: 0 },
            generatedAt: NOW.toISOString(),
          };
        },
      };

      const customStaysService = createStayService({
        repository: stayRepository,
        roomFees: roomFeesService,
        finance: duesFinanceService,
        deposits: depositsService,
      });

      const customRouter = createStayRouter({
        service: customStaysService,
        deposits: depositsService,
        lifetimeReports: lifetimeReportsService,
        pdfService: pdfsService,
      });

      const customApp = createApp({ stays: customRouter });

      // Attempt standard checkout finalization without exception flag -> REJECTED
      const failRes = await request(customApp)
        .post(`/api/stays/${stayId}/finalize-checkout`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          actualLeftOn: '2026-11-30',
          isException: false,
        });

      assert.equal(failRes.status, 400);
      assert.match(failRes.body.message, /unresolved obligations/i);

      // Finalize with Super Admin exception and mandatory reason
      const exceptionRes = await request(customApp)
        .post(`/api/stays/${stayId}/finalize-checkout`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          actualLeftOn: '2026-11-30',
          isException: true,
          exceptionReason: 'Member had emergency departure; promised to clear ₹1,700 via UPI next week.',
        });

      assert.equal(exceptionRes.status, 200);
      assert.equal(exceptionRes.body.data.stay.status, STAY_STATUSES.CHECKED_OUT);
      assert.equal(exceptionRes.body.data.clearance.clearanceStatus, CLEARANCE_STATUSES.OUTSTANDING_DUES);
      assert.equal(exceptionRes.body.data.clearance.sequence, 1);
    });

    test('Scenario A & E: Fully cleared resident receives No-Dues clearance, room capacity is freed, and history is preserved', async () => {
      // Settle deposit: receive ₹5,000, refund ₹5,000 (held = 0)
      await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
          amountPaise: 500000,
          idempotencyKey: 'no-dues-dep-recv',
        });

      await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
          amountPaise: 500000,
          idempotencyKey: 'no-dues-dep-ref',
        });

      // Finalize checkout
      const finalRes = await request(testApp)
        .post(`/api/stays/${stayId}/finalize-checkout`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          actualLeftOn: '2026-11-30',
        });

      assert.equal(finalRes.status, 200);
      assert.equal(finalRes.body.data.stay.status, STAY_STATUSES.CHECKED_OUT);
      assert.equal(finalRes.body.data.clearance.clearanceStatus, CLEARANCE_STATUSES.NO_DUES);

      // Verify room 204 capacity is released
      const roomAssignments = await roomRepository.findAssignmentsForRoom(room204Id);
      const activeAssignments = roomAssignments.filter((a) => !a.effectiveUntilMonth || a.effectiveUntilMonth >= '2026-12');
      assert.equal(activeAssignments.length, 0); // No active assignments after November!

      // Checked-out member can still view their history
      const meRes = await request(testApp)
        .get('/api/stays/me')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'));

      assert.equal(meRes.status, 200);
      assert.equal(meRes.body.isActive, false);
      assert.equal(meRes.body.data.status, STAY_STATUSES.CHECKED_OUT);
    });
  });

  // ==========================================
  // 5. Lifetime Financial Report & Vector PDF Statements
  // ==========================================
  describe('Lifetime Financial Report & Vector PDF Generation', () => {
    let stayId;

    beforeEach(async () => {
      await resetState();
      const stayRes = await request(testApp)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-07-01',
          initialRoomId: room204Id,
          expectedDepositPaise: 500000,
        });
      stayId = stayRes.body.data.stayId;

      await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
          amountPaise: 500000,
          idempotencyKey: 'lifetime-dep-recv',
        });
    });

    test('Lifetime financial summary aggregates stay duration data accurately', async () => {
      const res = await request(testApp)
        .get(`/api/stays/${stayId}/lifetime-summary`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'));

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.member.id, 'gaurav');
      assert.ok(res.body.data.lifetimeTotals);
      assert.ok(res.body.data.depositOverview);
      assert.equal(res.body.data.depositOverview.summary.receivedPaise, 500000);
    });

    test('Generates downloadable vector Lifetime Statement PDF with valid PDF stream headers', async () => {
      const res = await request(testApp)
        .get(`/api/stays/${stayId}/lifetime-statement.pdf`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'));

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/pdf');
      assert.match(res.headers['content-disposition'], /MealKhata-Lifetime-Statement-gaurav/);
      assert.ok(res.body.length > 0);
      // Validate PDF signature %PDF
      const header = res.body.slice(0, 4).toString('utf-8');
      assert.equal(header, '%PDF');
    });

    test('Generates Clearance Certificate PDF upon finalization', async () => {
      // Refund deposit and finalize
      await request(testApp)
        .post(`/api/stays/${stayId}/deposit/transactions`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
          amountPaise: 500000,
          idempotencyKey: 'lifetime-dep-ref',
        });

      const finRes = await request(testApp)
        .post(`/api/stays/${stayId}/finalize-checkout`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ actualLeftOn: '2026-11-30' });

      const clearanceId = finRes.body.data.clearance.clearanceId;

      const pdfRes = await request(testApp)
        .get(`/api/stays/${stayId}/clearances/${clearanceId}.pdf`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'));

      assert.equal(pdfRes.status, 200);
      assert.equal(pdfRes.headers['content-type'], 'application/pdf');
      assert.match(pdfRes.headers['content-disposition'], /MealKhata-Clearance-gaurav-1/);
      const header = pdfRes.body.slice(0, 4).toString('utf-8');
      assert.equal(header, '%PDF');
    });
  });
});
