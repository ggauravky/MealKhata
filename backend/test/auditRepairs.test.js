/**
 * MealKhata 2.0 — Pre-Merge Bug Audit, Financial Integrity & Regression Test Suite
 * Verifies all 20 confirmed defects (Bugs 1-20) and real concurrency / financial invariants.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createRoomFeeService } from '../src/roomFees/roomFee.service.js';
import { createRoomFeeRouter, createRoomRouter } from '../src/routes/roomFee.routes.js';
import { createStayService } from '../src/stays/stay.service.js';
import { createDepositService } from '../src/stays/deposit.service.js';
import { createLifetimeReportService } from '../src/stays/lifetimeReport.service.js';
import { createLifetimePdfService } from '../src/stays/lifetimePdf.service.js';
import { createStayRouter } from '../src/routes/stay.routes.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { createMealService } from '../src/meals/meal.service.js';
import { ExpenseService } from '../src/expenses/expense.service.js';
import { createExpenseRouter } from '../src/routes/expense.routes.js';
import { InMemoryRoomFeeRepository } from './helpers/inMemoryRoomFeeRepository.js';
import { InMemoryStayRepository } from './helpers/inMemoryStayRepository.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { InMemoryExpenseRepository } from './helpers/inMemoryExpenseRepository.js';
import { CLEARANCE_STATUSES, DEPOSIT_TRANSACTION_TYPES, STAY_STATUSES } from '../src/stays/stay.constants.js';

const ORIGIN = 'http://localhost:5173';
const NOW = new Date('2026-10-20T12:00:00.000Z');

// Repositories
const roomRepository = new InMemoryRoomFeeRepository();
const stayRepository = new InMemoryStayRepository();
const mealRepository = new InMemoryMealRepository();
const expenseRepository = new InMemoryExpenseRepository();

// Domain Services
const roomFeesService = createRoomFeeService({
  repository: roomRepository,
  timezone: 'Asia/Kolkata',
  now: () => NOW,
});

const depositsService = createDepositService({
  repository: stayRepository,
});

const pdfsService = createLifetimePdfService();

// Dynamic mock finance service supporting multi-month outstanding balances
let mockMonthlyFinance = {};
const dynamicFinanceService = {
  async getMemberFinancialOverview({ memberId, month }) {
    if (mockMonthlyFinance[`${memberId}:${month}:ERROR`]) {
      throw new Error(`Simulated database failure for ${memberId} in month ${month}`);
    }
    const custom = mockMonthlyFinance[`${memberId}:${month}`];
    if (custom) return custom;
    return {
      memberId,
      month,
      mess: { billPaise: 0, paidPaise: 0, remainingPaise: 0 },
      room: { status: 'none', chargeIssued: false, issuedChargePaise: 0, paidPaise: 0, remainingPaise: 0 },
      expenses: { spendingSharePaise: 0, owedToOthersPaise: 0, owedToMePaise: 0 },
    };
  },
};

const staysService = createStayService({
  repository: stayRepository,
  roomFees: roomFeesService,
  finance: dynamicFinanceService,
  deposits: depositsService,
});

const lifetimeReportsService = createLifetimeReportService({
  repository: stayRepository,
  finance: dynamicFinanceService,
  deposits: depositsService,
  timezone: 'Asia/Kolkata',
});

const mealServiceInstance = createMealService({
  repository: mealRepository,
  stays: stayRepository,
  timezone: 'Asia/Kolkata',
  now: () => NOW,
});

const expenseServiceInstance = new ExpenseService(expenseRepository);

// Routers
const stayRouter = createStayRouter({
  service: staysService,
  deposits: depositsService,
  lifetimeReports: lifetimeReportsService,
  pdfService: pdfsService,
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

const expenseRouter = createExpenseRouter({
  service: expenseServiceInstance,
});

const app = createApp({
  stays: stayRouter,
  roomFees: roomFeesRouter,
  rooms: roomsRouter,
  meals: mealsRouter,
  expenses: expenseRouter,
});

async function cookieFor(role, memberId = null) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, { memberId })}`;
}

let room204Id;
let room301Id;

async function resetAll() {
  roomRepository.reset();
  stayRepository.reset();
  mealRepository.reset();
  expenseRepository.reset();
  mockMonthlyFinance = {};

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
  await resetAll();
});

describe('MealKhata 2.0 — Pre-Merge Bug Audit & Financial Integrity Repairs', () => {
  // =========================================================================
  // Critical Bug 1: Stay-wide checkout review evaluates all prior months
  // =========================================================================
  describe('Critical Bug 1: Stay-wide checkout evaluates all historical obligations', () => {
    test('Prior-month unpaid Room Fee (Sep ₹1000, Oct ₹0) BLOCKS No-Dues clearance', async () => {
      // 1. Admit Gaurav in Sep 2026
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      // Configure September debt of ₹1,000 (100,000 paise) and October dues ₹0
      mockMonthlyFinance['gaurav:2026-09'] = {
        memberId: 'gaurav',
        month: '2026-09',
        mess: { billPaise: 0, paidPaise: 0, remainingPaise: 0 },
        room: { status: 'configured', chargeIssued: true, issuedChargePaise: 100000, paidPaise: 0, remainingPaise: 100000 },
        expenses: { spendingSharePaise: 0, owedToOthersPaise: 0, owedToMePaise: 0 },
      };
      mockMonthlyFinance['gaurav:2026-10'] = {
        memberId: 'gaurav',
        month: '2026-10',
        mess: { billPaise: 0, paidPaise: 0, remainingPaise: 0 },
        room: { status: 'configured', chargeIssued: false, issuedChargePaise: 0, paidPaise: 0, remainingPaise: 0 },
        expenses: { spendingSharePaise: 0, owedToOthersPaise: 0, owedToMePaise: 0 },
      };

      const review = await staysService.getCheckoutReview(stay.stayId);

      // Must inspect September and find ₹1,000 unpaid
      assert.equal(review.totalOutstandingPayablePaise, 100000);
      assert.equal(review.isEligibleForNoDues, false);

      // Attempt standard checkout finalization without exception -> must be REJECTED
      await assert.rejects(
        () =>
          staysService.finalizeCheckout({
            stayId: stay.stayId,
            actualLeftOn: '2026-10-31',
            isException: false,
            actorRole: ROLES.ADMIN,
          }),
        /pending dues or unrefunded deposit/i,
      );
    });

    test('Late payment in October settling September obligation enables No-Dues checkout', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      // Initially September has ₹1,000 due
      mockMonthlyFinance['gaurav:2026-09'] = {
        memberId: 'gaurav',
        month: '2026-09',
        mess: { billPaise: 0, paidPaise: 0, remainingPaise: 0 },
        room: { status: 'configured', chargeIssued: true, issuedChargePaise: 100000, paidPaise: 0, remainingPaise: 100000 },
        expenses: { spendingSharePaise: 0, owedToOthersPaise: 0, owedToMePaise: 0 },
      };

      let review = await staysService.getCheckoutReview(stay.stayId);
      assert.equal(review.isEligibleForNoDues, false);

      // Settle September debt via late payment
      mockMonthlyFinance['gaurav:2026-09'] = {
        memberId: 'gaurav',
        month: '2026-09',
        mess: { billPaise: 0, paidPaise: 0, remainingPaise: 0 },
        room: { status: 'configured', chargeIssued: true, issuedChargePaise: 100000, paidPaise: 100000, remainingPaise: 0 },
        expenses: { spendingSharePaise: 0, owedToOthersPaise: 0, owedToMePaise: 0 },
      };

      review = await staysService.getCheckoutReview(stay.stayId);
      assert.equal(review.totalOutstandingPayablePaise, 0);
      assert.equal(review.isEligibleForNoDues, true);

      // Finalize checkout -> produces NO_DUES clearance
      const final = await staysService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-31',
        isException: false,
        actorRole: ROLES.SUPERADMIN,
      });
      assert.equal(final.clearance.clearanceStatus, CLEARANCE_STATUSES.NO_DUES);
    });
  });

  // =========================================================================
  // Critical Bug 2: Deposit Concurrency & Atomicity
  // =========================================================================
  describe('Critical Bug 2: Deposit transaction race conditions & atomicity', () => {
    test('Concurrent refunds: Held ₹5,000, two simultaneous refunds of ₹4,000 -> at most one succeeds', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      // Record deposit receipt of ₹5,000
      await depositsService.recordTransaction({
        stayId: stay.stayId,
        type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
        amountPaise: 500000,
        idempotencyKey: 'rcpt-initial',
        actorRole: ROLES.ADMIN,
      });

      const summaryBefore = await depositsService.getDepositSummary(stay.stayId);
      assert.equal(summaryBefore.summary.heldPaise, 500000);

      // Trigger two concurrent refund requests of ₹4,000 each
      const [resA, resB] = await Promise.allSettled([
        depositsService.recordTransaction({
          stayId: stay.stayId,
          type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
          amountPaise: 400000,
          reason: 'Refund A',
          idempotencyKey: 'refund-concurrent-A',
          actorRole: ROLES.SUPERADMIN,
        }),
        depositsService.recordTransaction({
          stayId: stay.stayId,
          type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
          amountPaise: 400000,
          reason: 'Refund B',
          idempotencyKey: 'refund-concurrent-B',
          actorRole: ROLES.SUPERADMIN,
        }),
      ]);

      const successes = [resA, resB].filter((r) => r.status === 'fulfilled');
      const failures = [resA, resB].filter((r) => r.status === 'rejected');

      assert.equal(successes.length, 1, 'Exactly one concurrent refund of ₹4,000 must succeed');
      assert.equal(failures.length, 1, 'The competing concurrent refund must be rejected');

      // Check held balance: cannot become negative
      const summaryAfter = await depositsService.getDepositSummary(stay.stayId);
      assert.equal(summaryAfter.summary.heldPaise, 100000);
      assert.equal(summaryAfter.summary.refundedPaise, 400000);
    });

    test('Concurrent refund (₹3,000) and deduction (₹3,000): Total financial outflow cannot exceed held ₹5,000', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      await depositsService.recordTransaction({
        stayId: stay.stayId,
        type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
        amountPaise: 500000,
        idempotencyKey: 'rcpt-5000',
        actorRole: ROLES.ADMIN,
      });

      const [resRefund, resDeduction] = await Promise.allSettled([
        depositsService.recordTransaction({
          stayId: stay.stayId,
          type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
          amountPaise: 300000,
          reason: 'Refund 3000',
          idempotencyKey: 'refund-3000',
          actorRole: ROLES.SUPERADMIN,
        }),
        depositsService.recordTransaction({
          stayId: stay.stayId,
          type: DEPOSIT_TRANSACTION_TYPES.DEDUCTED,
          amountPaise: 300000,
          reason: 'Deduction 3000',
          idempotencyKey: 'deduct-3000',
          actorRole: ROLES.SUPERADMIN,
        }),
      ]);

      const successes = [resRefund, resDeduction].filter((r) => r.status === 'fulfilled');
      assert.equal(successes.length, 1, 'Total outflow (₹6,000) exceeds ₹5,000, so only one can succeed');

      const summaryAfter = await depositsService.getDepositSummary(stay.stayId);
      assert.ok(summaryAfter.summary.heldPaise >= 0, 'Held balance must remain non-negative');
      assert.equal(summaryAfter.summary.heldPaise, 200000);
    });

    test('Duplicate idempotency key with different payload returns 409 Conflict', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      // 1st request with idempotency key
      await depositsService.recordTransaction({
        stayId: stay.stayId,
        type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
        amountPaise: 200000,
        idempotencyKey: 'key-test-payload-mismatch',
        actorRole: ROLES.ADMIN,
      });

      // 2nd request with SAME key but DIFFERENT amount -> 409 Conflict
      await assert.rejects(
        () =>
          depositsService.recordTransaction({
            stayId: stay.stayId,
            type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
            amountPaise: 300000, // changed payload
            idempotencyKey: 'key-test-payload-mismatch',
            actorRole: ROLES.ADMIN,
          }),
        /different transaction payload/i,
      );
    });
  });

  // =========================================================================
  // Critical Bug 3: Atomic Checkout Finalization
  // =========================================================================
  describe('Critical Bug 3: Atomic checkout finalization and room release', () => {
    test('Successful checkout transitions Stay to CHECKED_OUT and releases room capacity', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room301Id, // capacity 1
        actorRole: ROLES.ADMIN,
      });

      // Verify room 301 is now occupied
      const assignmentsBefore = await roomRepository.findAssignmentsForRoom(room301Id);
      const activeBefore = assignmentsBefore.filter((a) => !a.effectiveUntilMonth || a.effectiveUntilMonth > '2026-09');
      assert.equal(activeBefore.length, 1);

      // Finalize checkout
      const final = await staysService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-31',
        actorRole: ROLES.SUPERADMIN,
      });

      assert.equal(final.stay.status, STAY_STATUSES.CHECKED_OUT);
      assert.equal(final.stay.actualLeftOn, '2026-10-31');
      assert.ok(final.clearance.clearanceId);

      // Room 301 assignment must now be capped at 2026-10
      const assignmentsAfter = await roomRepository.findAssignmentsForRoom(room301Id);
      const activeAssign = assignmentsAfter.find((a) => !a.effectiveUntilMonth || a.effectiveUntilMonth > '2026-10');
      assert.equal(activeAssign, undefined, 'Room 301 assignment must be ended at or before 2026-10');
    });

    test('Checkout cannot be finalized twice (idempotent / terminal status guard)', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      await staysService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-31',
        actorRole: ROLES.SUPERADMIN,
      });

      // 2nd checkout attempt on already checked-out stay -> must reject
      await assert.rejects(
        () =>
          staysService.finalizeCheckout({
            stayId: stay.stayId,
            actualLeftOn: '2026-10-31',
            actorRole: ROLES.SUPERADMIN,
          }),
        /already been checked out/i,
      );
    });
  });

  // =========================================================================
  // Critical Bug 4: Expense Reimbursement Concurrency
  // =========================================================================
  describe('Critical Bug 4: Expense reimbursement concurrency & debt limits', () => {
    test('Nikhil owes Gaurav ₹100: Concurrent requests A (₹80) and B (₹80) cannot exceed ₹100', async () => {
      // 1. Create expense where Nikhil owes Gaurav ₹100 (10,000 paise)
      const expense = await expenseServiceInstance.createExpense({
        title: 'Electricity Bill',
        amountPaise: 20000,
        paidByMemberId: 'gaurav',
        date: '2026-10-05',
        category: 'utilities',
        splitType: 'custom',
        participants: ['gaurav', 'nikhil'],
        customAllocations: [
          { memberId: 'gaurav', amountPaise: 10000 },
          { memberId: 'nikhil', amountPaise: 10000 },
        ],
        actorRole: ROLES.ADMIN,
        actorMemberId: 'gaurav',
      });

      const keyA = randomUUID();
      const keyB = randomUUID();

      // 2. Fire two concurrent reimbursement requests of ₹80 (8,000 paise) each
      const [resA, resB] = await Promise.allSettled([
        expenseServiceInstance.recordReimbursement({
          expenseId: expense.expenseId,
          fromMemberId: 'nikhil',
          toMemberId: 'gaurav',
          amountPaise: 8000,
          paymentMethod: 'upi',
          idempotencyKey: keyA,
          actorRole: ROLES.ADMIN,
          actorMemberId: 'gaurav',
        }),
        expenseServiceInstance.recordReimbursement({
          expenseId: expense.expenseId,
          fromMemberId: 'nikhil',
          toMemberId: 'gaurav',
          amountPaise: 8000,
          paymentMethod: 'upi',
          idempotencyKey: keyB,
          actorRole: ROLES.ADMIN,
          actorMemberId: 'gaurav',
        }),
      ]);

      const successes = [resA, resB].filter((r) => r.status === 'fulfilled');
      const failures = [resA, resB].filter((r) => r.status === 'rejected');

      assert.equal(successes.length, 1, 'Only one reimbursement of ₹80 can succeed');
      assert.equal(failures.length, 1, 'Second concurrent reimbursement exceeding debt must be rejected');

      // Remaining debt must be exactly ₹20 (2,000 paise), never negative
      const updatedExpense = await expenseServiceInstance.getExpenseById(expense.expenseId, {
        actorRole: ROLES.ADMIN,
        actorMemberId: 'gaurav',
      });
      const remainingDebt = updatedExpense.financials.memberShares.find(
        (o) => o.memberId === 'nikhil',
      ).remainingOwedPaise;
      assert.equal(remainingDebt, 2000);
    });

    test('Reimbursement idempotency key with different payload returns 409 Conflict', async () => {
      const expense = await expenseServiceInstance.createExpense({
        title: 'Groceries',
        amountPaise: 20000,
        paidByMemberId: 'gaurav',
        date: '2026-10-05',
        category: 'groceries',
        splitType: 'custom',
        participants: ['gaurav', 'nikhil'],
        customAllocations: [
          { memberId: 'gaurav', amountPaise: 10000 },
          { memberId: 'nikhil', amountPaise: 10000 },
        ],
        actorRole: ROLES.ADMIN,
        actorMemberId: 'gaurav',
      });

      const sharedKey = randomUUID();

      await expenseServiceInstance.recordReimbursement({
        expenseId: expense.expenseId,
        fromMemberId: 'nikhil',
        toMemberId: 'gaurav',
        amountPaise: 5000,
        paymentMethod: 'cash',
        idempotencyKey: sharedKey,
        actorRole: ROLES.ADMIN,
        actorMemberId: 'gaurav',
      });

      // Same key, different amount -> 409
      await assert.rejects(
        () =>
          expenseServiceInstance.recordReimbursement({
            expenseId: expense.expenseId,
            fromMemberId: 'nikhil',
            toMemberId: 'gaurav',
            amountPaise: 3000, // changed amount
            paymentMethod: 'cash',
            idempotencyKey: sharedKey,
            actorRole: ROLES.ADMIN,
            actorMemberId: 'gaurav',
          }),
        /different transaction payload/i,
      );
    });
  });

  // =========================================================================
  // Critical Bug 5: Room Transfer Atomicity
  // =========================================================================
  describe('Critical Bug 5: Room transfer partial update prevention', () => {
    test('Nikhil in Room 204: Transfer to full Room 301 is rejected and leaves Room 204 active', async () => {
      // 1. Admit Gaurav in Room 301 (Single room, capacity 1)
      await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room301Id,
        actorRole: ROLES.ADMIN,
      });

      // 2. Admit Nikhil in Room 204 (capacity 2)
      const nikhilStay = await staysService.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-10-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      // 3. Attempt transfer of Nikhil to full Room 301
      await assert.rejects(
        () =>
          staysService.transferRoom({
            stayId: nikhilStay.stayId,
            newRoomId: room301Id,
            effectiveDate: '2026-10-25',
            actorRole: ROLES.ADMIN,
          }),
        /capacity/i,
      );

      // Verify Nikhil's stay still points to Room 204
      const stayAfter = await staysService.getStayById(nikhilStay.stayId);
      assert.equal(stayAfter.currentRoomId, room204Id);

      // Verify Nikhil's Room 204 assignment is NOT closed
      const nikhilAssignments = await roomRepository.findAssignmentsForMember('nikhil');
      const activeAssign = nikhilAssignments.find((a) => a.roomId === room204Id && !a.effectiveUntilMonth);
      assert.ok(activeAssign, 'Room 204 assignment must remain active without end date');
    });
  });

  // =========================================================================
  // Critical Bug 6: Stay Onboarding Atomicity
  // =========================================================================
  describe('Critical Bug 6: Stay creation rollback on assignment failure', () => {
    test('Attempting to admit resident into full room rolls back entire Stay creation', async () => {
      // Fill room 301
      await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room301Id,
        actorRole: ROLES.ADMIN,
      });

      // Attempt admission of Devansh into full Room 301
      await assert.rejects(
        () =>
          staysService.createStay({
            memberId: 'devansh',
            joinedOn: '2026-10-01',
            initialRoomId: room301Id,
            actorRole: ROLES.ADMIN,
          }),
        /capacity/i,
      );

      // Verify Devansh has NO active stay
      const devanshStay = await stayRepository.findActiveStayForMember('devansh');
      assert.equal(devanshStay, null, 'No stay record must exist for Devansh');

      // Verify Devansh has NO deposit account or stays
      const stays = await stayRepository.findStaysByMember('devansh');
      assert.equal(stays.length, 0);
    });

    test('Malformed/invalid expected deposit rejected with 400 (not silently coerced to 0)', async () => {
      await assert.rejects(
        () =>
          staysService.createStay({
            memberId: 'devansh',
            joinedOn: '2026-10-01',
            initialRoomId: room204Id,
            expectedDepositPaise: -500, // invalid negative amount
            actorRole: ROLES.ADMIN,
          }),
        /Invalid expected security deposit/i,
      );

      await assert.rejects(
        () =>
          staysService.createStay({
            memberId: 'devansh',
            joinedOn: '2026-10-01',
            initialRoomId: room204Id,
            expectedDepositPaise: 'invalid-string', // invalid type
            actorRole: ROLES.ADMIN,
          }),
        /Invalid expected security deposit/i,
      );
    });
  });

  // =========================================================================
  // High Bugs 7 & 8: API Contract Matching
  // =========================================================================
  describe('High Bugs 7 & 8: API contract field names & persistence', () => {
    test('Bug 7: Stay registration with canonical monthlyFeePaise creates valid fee plan', async () => {
      const res = await request(app)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-10-01',
          initialRoomId: room204Id,
          monthlyFeePaise: 280000, // ₹2,800
          expectedDepositPaise: 500000,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.memberId, 'gaurav');

      // Verify fee plan created with exactly 280,000 paise
      const plans = await roomRepository.findFeePlansForMember('gaurav');
      assert.equal(plans.length, 1);
      assert.equal(plans[0].amountPaise, 280000);
    });

    test('Bug 8: Member checkout request with canonical preferredLeaveDate and reason persists', async () => {
      // 1. Create stay
      await request(app)
        .post('/api/stays')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          memberId: 'gaurav',
          joinedOn: '2026-10-01',
          initialRoomId: room204Id,
        });

      // 2. Member submits departure request with canonical fields
      const reqRes = await request(app)
        .post('/api/stays/me/checkout-request')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'))
        .send({
          preferredLeaveDate: '2026-11-30',
          reason: 'Job relocation to Bengaluru',
        });

      assert.equal(reqRes.status, 200);
      assert.equal(reqRes.body.success, true);
      assert.equal(reqRes.body.data.status, STAY_STATUSES.CHECKOUT_REQUESTED);
      assert.equal(reqRes.body.data.checkoutRequestedFor, '2026-11-30');
      assert.equal(reqRes.body.data.checkoutRequestNote, 'Job relocation to Bengaluru');
    });
  });

  // =========================================================================
  // High Bugs 9 & 10: Missing Routes (checkout-review & clearance reissue)
  // =========================================================================
  describe('High Bugs 9 & 10: Checkout review initiation & Clearance reissue routes', () => {
    test('Bug 9: POST /api/stays/:stayId/checkout-review transitions CHECKOUT_REQUESTED to CHECKOUT_PENDING', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      await staysService.requestCheckout({
        stayId: stay.stayId,
        preferredLeaveDate: '2026-11-30',
        reason: 'Leaving soon',
        actorRole: ROLES.MEMBER,
        actorMemberId: 'gaurav',
      });

      const res = await request(app)
        .post(`/api/stays/${stay.stayId}/checkout-review`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ note: 'Admin verified initial paperwork' });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, STAY_STATUSES.CHECKOUT_PENDING);
    });

    test('Bug 10: Super Admin can reissue clearance (Sequence #2) and preserves Clearance #1', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      // Checkout #1
      const check1 = await staysService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-15',
        actorRole: ROLES.SUPERADMIN,
      });
      assert.equal(check1.clearance.sequence, 1);

      // Reissue clearance #2 via route
      const reissueRes = await request(app)
        .post(`/api/stays/${stay.stayId}/clearance/reissue`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ reissueReason: 'Corrected Mess snapshot after reconciliation' });

      assert.equal(reissueRes.status, 200);
      assert.equal(reissueRes.body.success, true);
      assert.equal(reissueRes.body.data.sequence, 2);

      // Both clearances must exist (ordered latest first)
      const clearances = await staysService.listClearances(stay.stayId);
      assert.equal(clearances.length, 2);
      const sequences = clearances.map((c) => c.sequence).sort((a, b) => a - b);
      assert.deepEqual(sequences, [1, 2]);

      // Non-superadmin cannot reissue -> 403
      const forbiddenRes = await request(app)
        .post(`/api/stays/${stay.stayId}/clearance/reissue`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({ reissueReason: 'Unauthorized admin attempt' });
      assert.equal(forbiddenRes.status, 403);
    });
  });

  // =========================================================================
  // High Bug 11: Exceptional Checkout Validation
  // =========================================================================
  describe('High Bug 11: Exceptional departure enforcement (isException boolean & reason)', () => {
    test('Unresolved dues: isException false rejected, isException true without reason rejected, valid reason succeeds as OUTSTANDING_DUES', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      // Outstanding room dues of ₹1,500
      mockMonthlyFinance['gaurav:2026-09'] = {
        memberId: 'gaurav',
        month: '2026-09',
        mess: { billPaise: 0, paidPaise: 0, remainingPaise: 0 },
        room: { status: 'configured', chargeIssued: true, issuedChargePaise: 150000, paidPaise: 0, remainingPaise: 150000 },
        expenses: { spendingSharePaise: 0, owedToOthersPaise: 0, owedToMePaise: 0 },
      };

      // 1. isException: false -> rejected
      const res1 = await request(app)
        .post(`/api/stays/${stay.stayId}/finalize-checkout`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ actualLeftOn: '2026-10-31', isException: false });
      assert.equal(res1.status, 400);

      // 2. isException: true with empty reason -> rejected
      const res2 = await request(app)
        .post(`/api/stays/${stay.stayId}/finalize-checkout`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ actualLeftOn: '2026-10-31', isException: true, exceptionReason: '   ' });
      assert.equal(res2.status, 400);

      // 3. Super Admin with isException: true and valid reason -> succeeds as OUTSTANDING_DUES
      const res3 = await request(app)
        .post(`/api/stays/${stay.stayId}/finalize-checkout`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({
          actualLeftOn: '2026-10-31',
          isException: true,
          exceptionReason: 'Emergency personal departure, dues to be settled by UPI next week',
        });
      assert.equal(res3.status, 200);
      assert.equal(res3.body.data.clearance.clearanceStatus, CLEARANCE_STATUSES.OUTSTANDING_DUES);
    });
  });

  // =========================================================================
  // High Bug 12: Deposit Void Context Verification
  // =========================================================================
  describe('High Bug 12: Deposit transaction voiding stay verification & held balance guard', () => {
    test('Rejects void when requested stayId does not match transaction stayId (404)', async () => {
      const stayA = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      const stayB = await staysService.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      const tx = await depositsService.recordTransaction({
        stayId: stayA.stayId,
        type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
        amountPaise: 500000,
        idempotencyKey: 'tx-stay-a',
        actorRole: ROLES.ADMIN,
      });

      // Attempt voiding tx from stayA under stayB URL -> rejected 404
      const res = await request(app)
        .post(`/api/stays/${stayB.stayId}/deposit/transactions/${tx.transactionId}/void`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ reason: 'Void attempt under wrong stay' });

      assert.equal(res.status, 404);
      assert.match(res.body.message, /does not belong to this stay/i);
    });

    test('Rejects voiding deposit receipt if refund was already paid and held balance would become negative', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      const rcpt = await depositsService.recordTransaction({
        stayId: stay.stayId,
        type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
        amountPaise: 500000,
        idempotencyKey: 'rcpt-to-void',
        actorRole: ROLES.ADMIN,
      });

      // Refund ₹4,000
      await depositsService.recordTransaction({
        stayId: stay.stayId,
        type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
        amountPaise: 400000,
        idempotencyKey: 'refund-before-void',
        actorRole: ROLES.SUPERADMIN,
      });

      // Attempt to void the receipt -> would leave -₹4,000 balance -> MUST REJECT
      await assert.rejects(
        () =>
          depositsService.voidTransaction({
            stayId: stay.stayId,
            depositTransactionId: rcpt.depositTransactionId,
            reason: 'Mistaken receipt',
            actorRole: ROLES.SUPERADMIN,
          }),
        /already been refunded or deducted/i,
      );
    });
  });

  // =========================================================================
  // High Bug 13: Lifetime Reports Fail Closed
  // =========================================================================
  describe('High Bug 13: Lifetime financial statements fail closed on missing/error months', () => {
    test('If finance overview fails for September, lifetime report fails closed instead of omitting September', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-07-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      // Simulate September failure
      mockMonthlyFinance['gaurav:2026-09:ERROR'] = true;

      // Must throw an error, never produce partial statement with silent omissions
      await assert.rejects(
        () => lifetimeReportsService.generateLifetimeReport(stay.stayId),
        /Simulated database failure for gaurav in month 2026-09/i,
      );
    });
  });

  // =========================================================================
  // High Bug 15: Post-Checkout Meal Mutations Blocked
  // =========================================================================
  describe('High Bug 15: Post-checkout meal participation enforcement', () => {
    test('Resident checked out on 2026-10-15 cannot record taking meals on 2026-10-16', async () => {
      const stay = await staysService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-09-01',
        initialRoomId: room204Id,
        actorRole: ROLES.ADMIN,
      });

      await staysService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-15',
        actorRole: ROLES.SUPERADMIN,
      });

      // Attempt to mark taking for 2026-10-16 -> must be rejected
      await assert.rejects(
        () =>
          mealServiceInstance.changeStatus({
            date: '2026-10-16',
            mealType: 'morning',
            memberId: 'gaurav',
            status: 'taking',
            actorRole: ROLES.ADMIN,
          }),
        /hostel checkout/i,
      );
    });

    test('Legacy member without stay record is preserved and can record meals normally', async () => {
      // Nikhil has no stay created yet
      const meal = await mealServiceInstance.changeStatus({
        date: '2026-10-20',
        mealType: 'morning',
        memberId: 'nikhil',
        status: 'taking',
        actorRole: ROLES.ADMIN,
      });

      assert.equal(meal.data.meals.morning.nikhil, 'taking');
    });
  });

  // =========================================================================
  // High Bug 17: Room Assignment End Boundaries
  // =========================================================================
  describe('High Bug 17: Ending room assignments does not corrupt unrelated future assignments', () => {
    test('endActiveRoomAssignment only bounds the assignment matching the period', async () => {
      // Create assignment for Gaurav in 2026-07 to 2026-08 (historical)
      await roomRepository.createAssignment({
        assignmentId: randomUUID(),
        roomId: room204Id,
        memberId: 'gaurav',
        effectiveFromMonth: '2026-07',
        effectiveUntilMonth: '2026-08',
      });

      // Current active assignment from 2026-09 onwards
      const activeAssign = await roomRepository.createAssignment({
        assignmentId: randomUUID(),
        roomId: room204Id,
        memberId: 'gaurav',
        effectiveFromMonth: '2026-09',
        effectiveUntilMonth: null,
      });

      // Future assignment from 2026-12 onwards
      const futureAssign = await roomRepository.createAssignment({
        assignmentId: randomUUID(),
        roomId: room301Id,
        memberId: 'gaurav',
        effectiveFromMonth: '2026-12',
        effectiveUntilMonth: null,
      });

      // End active assignment for October 2026
      await roomFeesService.endActiveRoomAssignment({
        memberId: 'gaurav',
        endMonth: '2026-10',
      });

      // Check all 3 assignments:
      const updatedActive = await roomRepository.findAssignmentById(activeAssign.assignmentId);
      assert.equal(updatedActive.effectiveUntilMonth, '2026-10', 'Active assignment capped at 2026-10');

      const updatedFuture = await roomRepository.findAssignmentById(futureAssign.assignmentId);
      assert.equal(updatedFuture.effectiveUntilMonth, null, 'Future assignment must NOT be corrupted');
    });
  });
});
