/**
 * MealKhata 2.0 - Real MongoDB Replica Set Integration & Concurrency Test Suite
 * Validates MongoDB multi-document transactions, concurrency guards, failure injection,
 * and complete End-to-End User Journeys (A through H).
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import {
  HostelStay,
  HostelDepositAccount,
  HostelDepositTransaction,
  HostelClearance,
} from '../src/stays/stay.model.js';
import { Room } from '../src/roomFees/room.model.js';
import { RoomAssignment } from '../src/roomFees/roomAssignment.model.js';
import { RoomFeePlan } from '../src/roomFees/roomFeePlan.model.js';
import { RoomFeeScheduleState } from '../src/roomFees/roomFeeScheduleState.model.js';
import { RoomCharge } from '../src/roomFees/roomCharge.model.js';
import { RoomPayment } from '../src/roomFees/roomPayment.model.js';
import { RoomPaymentSettings } from '../src/roomFees/roomPaymentSettings.model.js';
import { Expense } from '../src/expenses/expense.model.js';
import { ExpenseReimbursement } from '../src/expenses/expenseReimbursement.model.js';
import { MealDay } from '../src/meals/meal.model.js';
import { MonthlyMealRate } from '../src/billing/monthlyRate.model.js';
import { Payment } from '../src/payments/payment.model.js';
import { UserAccount } from '../src/auth/userAccount.model.js';
import { MemberAccount } from '../src/auth/memberAccount.model.js';
import { MemberAccountAudit } from '../src/members/memberAccountAudit.model.js';
import { PaymentReclassification, UnallocatedCredit } from '../src/stays/paymentReclassification.model.js';

import { createStayService, stayService } from '../src/stays/stay.service.js';
import { defaultStayAttributionService } from '../src/stays/stayAttribution.service.js';
import { depositService } from '../src/stays/deposit.service.js';
import { roomFeeService } from '../src/roomFees/roomFee.service.js';
import { expenseService } from '../src/expenses/expense.service.js';
import { stayRepository } from '../src/stays/stay.repository.js';
import { roomRepository } from '../src/roomFees/room.repository.js';
import { defaultExpenseRepository } from '../src/expenses/expense.repository.js';
import { computeChargeFinancials } from '../src/roomFees/roomFee.serializer.js';
import { paymentRepository } from '../src/payments/payment.repository.js';
import { mealService } from '../src/meals/meal.service.js';
import { createMemberAccountService } from '../src/members/memberAccount.service.js';
import { createMemberService } from '../src/members/member.service.js';

let replSet;

async function ensureRoom(roomNumber, capacity = 2) {
  const existing = await roomRepository.findRoomByNumber(roomNumber);
  if (existing) return existing;
  return roomFeeService.createRoom({
    roomNumber,
    roomLabel: `Room ${roomNumber}`,
    capacity,
    actorRole: 'admin',
  });
}

function createGatedCheckoutService() {
  let releaseTransactionalReview;
  let signalTransactionalReview;
  const transactionalReviewReached = new Promise((resolve) => {
    signalTransactionalReview = resolve;
  });
  const transactionalReviewRelease = new Promise((resolve) => {
    releaseTransactionalReview = resolve;
  });
  const gatedAttribution = {
    async getStayAttributedFinances(args) {
      const result = await defaultStayAttributionService.getStayAttributedFinances(args);
      if (args.session) {
        signalTransactionalReview();
        await transactionalReviewRelease;
      }
      return result;
    },
  };

  return {
    checkoutService: createStayService({
      repository: stayRepository,
      roomFees: roomFeeService,
      deposits: depositService,
      stayAttribution: gatedAttribution,
    }),
    transactionalReviewReached,
    releaseTransactionalReview,
  };
}

function createGatedReviewService() {
  let releaseReview;
  let signalReview;
  const reviewReached = new Promise((resolve) => {
    signalReview = resolve;
  });
  const reviewRelease = new Promise((resolve) => {
    releaseReview = resolve;
  });
  const gatedAttribution = {
    async getStayAttributedFinances(args) {
      const result = await defaultStayAttributionService.getStayAttributedFinances(args);
      signalReview();
      await reviewRelease;
      return result;
    },
  };

  return {
    reviewService: createStayService({
      repository: stayRepository,
      roomFees: roomFeeService,
      deposits: depositService,
      stayAttribution: gatedAttribution,
    }),
    reviewReached,
    releaseReview,
  };
}

async function assertConcurrentMutationInvalidatesCheckout({
  stayId,
  mutation,
  verifyRejectedMutation,
}) {
  const {
    checkoutService,
    transactionalReviewReached,
    releaseTransactionalReview,
  } = createGatedCheckoutService();

  const checkoutPromise = checkoutService.finalizeCheckout({
    stayId,
    actualLeftOn: '2026-10-20',
    allowWithDues: false,
    actorRole: 'admin',
  });
  await transactionalReviewReached;
  const mutationPromise = mutation();
  releaseTransactionalReview();

  const [checkoutResult, mutationResult] = await Promise.allSettled([
    checkoutPromise,
    mutationPromise,
  ]);

  if (checkoutResult.status === 'rejected') {
    assert.equal(checkoutResult.reason.statusCode, 409);
    assert.equal(checkoutResult.reason.details?.code, 'CHECKOUT_FINANCIALS_CHANGED');
    assert.equal(mutationResult.status, 'fulfilled');
    assert.equal(await HostelClearance.countDocuments({ stayId }), 0);
    return;
  }

  assert.equal(checkoutResult.value.clearance.clearanceStatus, 'NO_DUES');
  assert.equal(mutationResult.status, 'rejected');
  assert.equal(mutationResult.reason.statusCode, 409);
  assert.equal(mutationResult.reason.details?.code, 'CLEARANCE_REVIEW_REQUIRED');
  await verifyRejectedMutation();
  assert.equal(await HostelClearance.countDocuments({ stayId }), 1);
}

describe('MealKhata 2.0: Real MongoDB Replica Set Transaction & Concurrency Suite', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = replSet.getUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    await Promise.all([
      Room.init(),
      RoomAssignment.init(),
      RoomFeePlan.init(),
      RoomFeeScheduleState.init(),
      RoomCharge.init(),
      RoomPayment.init(),
      RoomPaymentSettings.init(),
      HostelStay.init(),
      HostelDepositAccount.init(),
      HostelDepositTransaction.init(),
      HostelClearance.init(),
      Expense.init(),
      ExpenseReimbursement.init(),
      MealDay.init(),
      MonthlyMealRate.init(),
      Payment.init(),
      UserAccount.init(),
      MemberAccount.init(),
      MemberAccountAudit.init(),
      PaymentReclassification.init(),
      UnallocatedCredit.init(),
    ]);
  });

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    if (replSet) {
      await replSet.stop();
    }
  });

  beforeEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  });

  describe('Existing Room Assignment compatibility', () => {
    it('reports all three assigned residents without creating Stay or duplicate accommodation records', async () => {
      const lower = await ensureRoom('lower', 1);
      const firstFloor = await ensureRoom('1st Floor Room', 2);
      const assignments = [
        ['gaurav', lower.roomId],
        ['nikhil', firstFloor.roomId],
        ['devansh', firstFloor.roomId],
      ];
      for (const [memberId, roomId] of assignments) {
        await roomFeeService.assignMemberToRoom({
          memberId,
          roomId,
          effectiveFromMonth: '2026-10',
          effectiveFromDate: '2026-10-20',
          actorRole: 'admin',
        });
      }

      const memberService = createMemberService({
        now: () => new Date('2026-10-21T06:30:00.000Z'),
      });
      const roster = await memberService.listMembers();
      const roomByMember = Object.fromEntries(roster.map((member) => [member.memberId, member.room?.roomNumber]));
      assert.deepEqual(roomByMember, {
        gaurav: 'lower',
        nikhil: '1st Floor Room',
        devansh: '1st Floor Room',
      });
      assert.ok(roster.every((member) => member.assignment && member.stay === null));

      for (const [memberId, roomId] of assignments) {
        const overview = await roomFeeService.getMemberOverview({ memberId, targetMonth: '2026-10' });
        assert.equal(overview.currentRoom.roomId, roomId);
        assert.equal(overview.currentAssignment.memberId, memberId);
      }

      assert.equal(await RoomAssignment.countDocuments({}), 3);
      assert.equal(await HostelStay.countDocuments({}), 0);
      assert.equal(await RoomFeePlan.countDocuments({}), 0);
    });
  });

  // =========================================================================
  // 1. CONCURRENT DEPOSIT TRANSACTIONS & FINANCIAL INVARIANTS
  // =========================================================================
  describe('Deposit Concurrency & Invariants', () => {
    it('treats a zero expected deposit as not required without fabricating a transaction', async () => {
      const room = await ensureRoom('no-deposit', 1);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 0,
        actorRole: 'admin',
      });

      const beforeCheckout = await depositService.getDepositSummary(stay.stayId);
      assert.equal(beforeCheckout.account.status, 'NOT_REQUIRED');
      assert.deepEqual(beforeCheckout.summary, {
        expectedPaise: 0,
        receivedPaise: 0,
        refundedPaise: 0,
        deductedPaise: 0,
        heldPaise: 0,
      });
      assert.equal(beforeCheckout.transactions.length, 0);

      const result = await stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        actorRole: 'admin',
      });
      assert.equal(result.clearance.clearanceStatus, 'NO_DUES');
      assert.equal(await HostelDepositTransaction.countDocuments({ stayId: stay.stayId }), 0);
    });

    it('configures optional deposits transactionally without inventing financial movements', async () => {
      const room = await ensureRoom('deposit-config', 1);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 0,
        actorRole: 'admin',
      });
      const initial = await depositService.getDepositSummary(stay.stayId);

      await assert.rejects(
        depositService.configureRequirement({
          stayId: stay.stayId,
          required: true,
          expectedDepositPaise: 500000,
          expectedRevision: initial.account.revision,
          reason: 'Security deposit is now required',
          actorRole: 'admin',
        }),
        (error) => error.statusCode === 403,
      );

      const required = await depositService.configureRequirement({
        stayId: stay.stayId,
        required: true,
        expectedDepositPaise: 500000,
        expectedRevision: initial.account.revision,
        reason: 'Security deposit is now required',
        actorRole: 'superadmin',
      });
      assert.equal(required.status, 'OPEN');
      assert.equal(required.expectedDepositPaise, 500000);

      const notRequired = await depositService.configureRequirement({
        stayId: stay.stayId,
        required: false,
        expectedDepositPaise: 0,
        expectedRevision: required.revision,
        reason: 'Resident is exempt from a security deposit',
        actorRole: 'superadmin',
      });
      assert.equal(notRequired.status, 'NOT_REQUIRED');
      assert.equal(notRequired.expectedDepositPaise, 0);
      assert.equal(await HostelDepositTransaction.countDocuments({ stayId: stay.stayId }), 0);

      const persisted = await HostelDepositAccount.findOne({ stayId: stay.stayId }).lean();
      assert.deepEqual(
        persisted.history.slice(-2).map((entry) => entry.event),
        ['DEPOSIT_REQUIREMENT_CONFIGURED', 'DEPOSIT_MARKED_NOT_REQUIRED'],
      );
    });

    it('refuses to mark a deposit not required while recorded transactions exist', async () => {
      const room = await ensureRoom('deposit-history', 1);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 500000,
        actorRole: 'admin',
      });
      await depositService.recordDepositReceipt({
        stayId: stay.stayId,
        amountPaise: 500000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'superadmin',
      });
      const account = await HostelDepositAccount.findOne({ stayId: stay.stayId }).lean();

      await assert.rejects(
        depositService.configureRequirement({
          stayId: stay.stayId,
          required: false,
          expectedDepositPaise: 0,
          expectedRevision: account.revision,
          reason: 'Correct an erroneously configured deposit',
          actorRole: 'superadmin',
        }),
        (error) => error.statusCode === 409 && error.details?.code === 'DEPOSIT_HISTORY_REQUIRES_RECONCILIATION',
      );
    });

    it('Held ₹5,000: concurrent refunds of ₹4,000 each can NEVER overdraw held balance', async () => {
      const room = await ensureRoom('204', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 500000,
        actorRole: 'admin',
      });

      // Receive ₹5,000 deposit
      await depositService.recordDepositReceipt({
        stayId: stay.stayId,
        amountPaise: 500000,
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });

      const initSummary = await depositService.getDepositSummary(stay.stayId);
      assert.equal(initSummary.summary.heldPaise, 500000);

      // Fire 2 concurrent refunds of ₹4,000 (400,000 paise) each
      const refundPromise1 = depositService.recordDepositRefund({
        stayId: stay.stayId,
        amountPaise: 400000,
        idempotencyKey: randomUUID(),
        actorRole: 'superadmin',
      });
      const refundPromise2 = depositService.recordDepositRefund({
        stayId: stay.stayId,
        amountPaise: 400000,
        idempotencyKey: randomUUID(),
        actorRole: 'superadmin',
      });

      const results = await Promise.allSettled([refundPromise1, refundPromise2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Only one ₹4,000 refund can succeed');
      assert.equal(rejected.length, 1, 'Second refund must be rejected');

      const finalSummary = await depositService.getDepositSummary(stay.stayId);
      assert.equal(finalSummary.summary.refundedPaise, 400000);
      assert.equal(finalSummary.summary.heldPaise, 100000);
      assert.ok(finalSummary.summary.heldPaise >= 0, 'Held balance never negative');
    });

    it('Held ₹5,000: concurrent refund ₹3,000 and deduction ₹3,000 never overdraw', async () => {
      const room = await ensureRoom('204', 2);
      const stay = await stayService.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 500000,
        actorRole: 'admin',
      });

      await depositService.recordDepositReceipt({
        stayId: stay.stayId,
        amountPaise: 500000,
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });

      const p1 = depositService.recordDepositRefund({
        stayId: stay.stayId,
        amountPaise: 300000,
        idempotencyKey: randomUUID(),
        actorRole: 'superadmin',
      });
      const p2 = depositService.recordDepositDeduction({
        stayId: stay.stayId,
        amountPaise: 300000,
        reason: 'Broken lamp',
        idempotencyKey: randomUUID(),
        actorRole: 'superadmin',
      });

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);

      const finalSummary = await depositService.getDepositSummary(stay.stayId);
      assert.equal(finalSummary.summary.heldPaise, 200000);
      assert.ok(finalSummary.summary.heldPaise >= 0);
    });

    it('Deposit voiding: cannot void receipt if funds have already been refunded/deducted', async () => {
      const room = await ensureRoom('204', 2);
      const stay = await stayService.createStay({
        memberId: 'devansh',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 500000,
        actorRole: 'admin',
      });

      const receipt = await depositService.recordDepositReceipt({
        stayId: stay.stayId,
        amountPaise: 500000,
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });

      await depositService.recordDepositRefund({
        stayId: stay.stayId,
        amountPaise: 400000,
        idempotencyKey: randomUUID(),
        actorRole: 'superadmin',
      });

      await assert.rejects(
        depositService.voidTransaction({
          stayId: stay.stayId,
          depositTransactionId: receipt.depositTransactionId,
          reason: 'Erroneous receipt',
          actorRole: 'superadmin',
        }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.match(err.message, /Cannot void receipt/);
          return true;
        },
      );

      const summary = await depositService.getDepositSummary(stay.stayId);
      assert.equal(summary.summary.heldPaise, 100000);
    });
  });

  // =========================================================================
  // 2. EXPENSE REIMBURSEMENT OVERPAYMENT RACE & CONCURRENCY
  // =========================================================================
  describe('Expense Reimbursement Concurrency', () => {
    it('Debt ₹100: concurrent reimbursements of ₹80 each can NEVER exceed ₹100 total', async () => {
      const expense = await expenseService.createExpense({
        month: '2026-10',
        date: '2026-10-05',
        title: 'Groceries',
        category: 'groceries',
        amountPaise: 30000,
        paidByMemberId: 'gaurav',
        splitType: 'equal',
        participants: ['gaurav', 'nikhil', 'devansh'],
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });

      const p1 = expenseService.recordReimbursement({
        expenseId: expense.expenseId,
        fromMemberId: 'nikhil',
        amountPaise: 8000,
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });
      const p2 = expenseService.recordReimbursement({
        expenseId: expense.expenseId,
        fromMemberId: 'nikhil',
        amountPaise: 8000,
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Only one ₹80 reimbursement can succeed');
      assert.equal(rejected.length, 1, 'Second payment must be rejected for exceeding remaining debt');

      const recorded = await defaultExpenseRepository.findReimbursementsByExpenseId(expense.expenseId);
      const active = recorded.filter((r) => r.status === 'recorded');
      const totalPaid = active.reduce((sum, r) => sum + r.amountPaise, 0);
      assert.equal(totalPaid, 8000);
      assert.ok(totalPaid <= 10000);
    });

    it('Idempotency payload conflict: reused key with differing amount throws 409 Conflict', async () => {
      const expense = await expenseService.createExpense({
        month: '2026-10',
        date: '2026-10-06',
        title: 'Snacks',
        category: 'snacks',
        amountPaise: 20000,
        paidByMemberId: 'gaurav',
        splitType: 'equal',
        participants: ['gaurav', 'nikhil'],
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });

      const sharedKey = randomUUID();
      const first = await expenseService.recordReimbursement({
        expenseId: expense.expenseId,
        fromMemberId: 'nikhil',
        amountPaise: 5000,
        idempotencyKey: sharedKey,
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });
      assert.equal(first.amountPaise, 5000);

      const replayed = await expenseService.recordReimbursement({
        expenseId: expense.expenseId,
        fromMemberId: 'nikhil',
        amountPaise: 5000,
        idempotencyKey: sharedKey,
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });
      assert.equal(replayed.reimbursementId, first.reimbursementId);

      await assert.rejects(
        expenseService.recordReimbursement({
          expenseId: expense.expenseId,
          fromMemberId: 'nikhil',
          amountPaise: 3000,
          idempotencyKey: sharedKey,
          actorRole: 'admin',
          actorMemberId: 'gaurav',
        }),
        (err) => {
          assert.equal(err.statusCode, 409);
          assert.match(err.message, /Idempotency key has already been used/);
          return true;
        },
      );
    });

    it('Concurrent expense creation replays one idempotent result without a Stay lock', async () => {
      const idempotencyKey = randomUUID();
      const payload = {
        date: '2026-09-15',
        title: 'Idempotent shared expense',
        category: 'utilities',
        amountPaise: 12000,
        paidByMemberId: 'nikhil',
        splitType: 'equal',
        participants: ['nikhil', 'devansh'],
        idempotencyKey,
        actorRole: 'admin',
        actorMemberId: null,
      };

      const results = await Promise.all([
        expenseService.createExpense(payload),
        expenseService.createExpense(payload),
      ]);

      assert.equal(results[0].expenseId, results[1].expenseId);
      assert.equal(await Expense.countDocuments({ idempotencyKey }), 1);
    });
  });

  // =========================================================================
  // 3. ROOM FEE PAYMENT OVERPAYMENT RACE & CONCURRENCY
  // =========================================================================
  describe('Room Fee Payment Concurrency', () => {
    it('Charge ₹2,800: two concurrent payments of ₹2,000 each can NEVER record ₹4,000', async () => {
      const room = await ensureRoom('101', 2);
      await roomFeeService.assignMemberToRoom({
        roomId: room.roomId,
        memberId: 'gaurav',
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-01',
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        effectiveFromMonth: '2026-10',
        amountPaise: 280000,
        actorRole: 'admin',
      });

      const issued = await roomFeeService.issueCharges('2026-10', 'admin');
      const charge = issued.charges[0];
      assert.equal(charge.finalBillAmountPaise, 280000);

      const p1 = roomFeeService.recordPayment({
        chargeId: charge.chargeId,
        amountPaise: 200000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });
      const p2 = roomFeeService.recordPayment({
        chargeId: charge.chargeId,
        amountPaise: 200000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Only one payment of ₹2,000 can succeed');
      assert.equal(rejected.length, 1, 'Second payment must be rejected for exceeding remaining balance');

      const payments = await roomRepository.findPaymentsForCharge(charge.chargeId);
      const totalPaid = payments.filter((p) => p.status === 'verified').reduce((sum, p) => sum + p.amountPaise, 0);
      assert.equal(totalPaid, 200000);
      assert.ok(totalPaid <= 280000, 'Total recorded payment never exceeds charge');
    });

    it('Room payment idempotency payload mismatch returns 409 Conflict', async () => {
      const room = await ensureRoom('101', 2);
      await roomFeeService.assignMemberToRoom({
        roomId: room.roomId,
        memberId: 'gaurav',
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-01',
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        effectiveFromMonth: '2026-10',
        amountPaise: 280000,
        actorRole: 'admin',
      });
      const issued = await roomFeeService.issueCharges('2026-10', 'admin');
      const charge = issued.charges[0];

      const sharedKey = randomUUID();
      await roomFeeService.recordPayment({
        chargeId: charge.chargeId,
        amountPaise: 100000,
        method: 'upi',
        idempotencyKey: sharedKey,
        actorRole: 'admin',
      });

      await assert.rejects(
        roomFeeService.recordPayment({
          chargeId: charge.chargeId,
          amountPaise: 50000,
          method: 'upi',
          idempotencyKey: sharedKey,
          actorRole: 'admin',
        }),
        (err) => {
          assert.equal(err.statusCode, 409);
          assert.match(err.message, /Idempotency key/);
          return true;
        },
      );
    });

    it('Charge adjustments concurrency: concurrent +₹100 and -₹200 both persist without lost update', async () => {
      const room = await ensureRoom('101', 2);
      await roomFeeService.assignMemberToRoom({
        roomId: room.roomId,
        memberId: 'gaurav',
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-01',
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        effectiveFromMonth: '2026-10',
        amountPaise: 280000,
        actorRole: 'admin',
      });
      const issued = await roomFeeService.issueCharges('2026-10', 'admin');
      const charge = issued.charges[0];

      const adj1 = roomFeeService.adjustCharge({
        chargeId: charge.chargeId,
        amountPaise: 10000,
        reason: 'Late fee surcharge',
        actorRole: 'superadmin',
      });
      const adj2 = roomFeeService.adjustCharge({
        chargeId: charge.chargeId,
        amountPaise: -20000,
        reason: 'Maintenance discount',
        actorRole: 'superadmin',
      });

      await Promise.all([adj1, adj2]);

      const updatedCharge = await roomRepository.findChargeById(charge.chargeId);
      const adjSum = updatedCharge.adjustments.reduce((sum, a) => sum + a.amountPaise, 0);
      assert.equal(updatedCharge.baseAmountPaise + adjSum, 270000);
      assert.equal(updatedCharge.adjustments.length, 2);
    });
  });

  // =========================================================================
  // 4. ROOM TRANSFER & CAPACITY CONCURRENCY
  // =========================================================================
  describe('Room Transfer & Capacity Concurrency', () => {
    it('Capacity 1: two concurrent transfers to Room 301 — at most ONE succeeds', async () => {
      const r301 = await ensureRoom('301', 1);
      const r204 = await ensureRoom('204', 2);

      const stayGaurav = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: r204.roomId,
        actorRole: 'admin',
      });
      const stayNikhil = await stayService.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-10-01',
        initialRoomId: r204.roomId,
        actorRole: 'admin',
      });

      const transfer1 = stayService.transferRoom({
        stayId: stayGaurav.stayId,
        newRoomId: r301.roomId,
        effectiveDate: '2026-10-15',
        actorRole: 'admin',
      });
      const transfer2 = stayService.transferRoom({
        stayId: stayNikhil.stayId,
        newRoomId: r301.roomId,
        effectiveDate: '2026-10-15',
        actorRole: 'admin',
      });

      const results = await Promise.allSettled([transfer1, transfer2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactly one transfer must succeed');
      assert.equal(rejected.length, 1, 'Competing transfer must be rejected due to capacity limit');

      const assignments = await RoomAssignment.find({
        roomId: r301.roomId,
        effectiveFromDate: { $lte: '2026-10-15' },
        $or: [{ effectiveUntilDate: null }, { effectiveUntilDate: { $gte: '2026-10-15' } }],
      });
      assert.equal(assignments.length, 1, 'Occupancy cannot exceed capacity 1 on transfer date');
    });
  });

  describe('Stay cancellation and admission correction transactions', () => {
    it('links a pre-existing assignment and fee plan without creating duplicates', async () => {
      const room = await ensureRoom('396', 1);
      const assignment = await roomFeeService.assignMemberToRoom({
        memberId: 'gaurav',
        roomId: room.roomId,
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-20',
        actorRole: 'admin',
      });
      const feePlan = await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        effectiveFromMonth: '2026-10',
        amountPaise: 280000,
        actorRole: 'admin',
      });

      const linkedStayService = createStayService({
        repository: stayRepository,
        roomFees: roomFeeService,
        now: () => new Date('2026-10-21T06:30:00.000Z'),
      });
      const stay = await linkedStayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-20',
        initialRoomId: room.roomId,
        admissionMode: 'link_existing_assignment',
        assignmentId: assignment.assignmentId,
        actorRole: 'admin',
      });

      assert.equal(stay.admissionAssignmentId, assignment.assignmentId);
      assert.equal(stay.admissionAssignmentOwned, false);
      assert.equal(stay.admissionFeePlanId, feePlan.feePlanId);
      assert.equal(stay.admissionFeePlanOwned, false);
      assert.equal(await RoomAssignment.countDocuments({ memberId: 'gaurav' }), 1);
      assert.equal(await RoomFeePlan.countDocuments({ memberId: 'gaurav' }), 1);
      assert.equal(await HostelStay.countDocuments({ memberId: 'gaurav' }), 1);
      assert.equal(await HostelDepositAccount.countDocuments({ stayId: stay.stayId }), 1);
    });

    it('cancels an empty Stay atomically, releases capacity, and permits a valid re-admission', async () => {
      const room = await ensureRoom('399', 1);
      const erroneous = await stayService.createStay({
        memberId: 'devansh',
        joinedOn: '2026-10-20',
        initialRoomId: room.roomId,
        expectedDepositPaise: 0,
        actorRole: 'superadmin',
      });

      const cancelled = await stayService.cancelIncorrectStay({
        stayId: erroneous.stayId,
        reason: 'Verified accidental admission',
        expectedRevision: erroneous.revision,
        actorRole: 'superadmin',
      });
      assert.equal(cancelled.status, 'CANCELLED');

      const cancelledAssignment = await RoomAssignment.findOne({ assignmentId: erroneous.admissionAssignmentId }).lean();
      const depositAccount = await HostelDepositAccount.findOne({ stayId: erroneous.stayId }).lean();
      assert.ok(cancelledAssignment.cancelledAt);
      assert.equal(depositAccount.status, 'SETTLED');

      const replacement = await stayService.createStay({
        memberId: 'devansh',
        joinedOn: '2026-10-20',
        initialRoomId: room.roomId,
        expectedDepositPaise: 0,
        actorRole: 'superadmin',
      });
      assert.equal(replacement.status, 'ACTIVE');
      assert.notEqual(replacement.stayId, erroneous.stayId);
    });

    it('corrects admission date and room in one transaction when no finance exists', async () => {
      const originalRoom = await ensureRoom('397', 1);
      const correctedRoom = await ensureRoom('398', 1);
      const stay = await stayService.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-10-20',
        initialRoomId: originalRoom.roomId,
        expectedDepositPaise: 0,
        actorRole: 'superadmin',
      });

      const corrected = await stayService.correctAdmissionDetails({
        stayId: stay.stayId,
        joinedOn: '2026-10-10',
        roomId: correctedRoom.roomId,
        reason: 'Verified source record correction',
        expectedRevision: stay.revision,
        actorRole: 'superadmin',
      });
      assert.equal(corrected.joinedOn, '2026-10-10');
      assert.equal(corrected.initialRoomId, correctedRoom.roomId);
      assert.equal(corrected.currentRoomId, correctedRoom.roomId);

      const assignment = await RoomAssignment.findOne({ assignmentId: stay.admissionAssignmentId }).lean();
      const persisted = await HostelStay.findOne({ stayId: stay.stayId }).lean();
      assert.equal(assignment.roomId, correctedRoom.roomId);
      assert.equal(assignment.effectiveFromDate, '2026-10-10');
      assert.equal(persisted.history.at(-1).event, 'ADMISSION_CORRECTED');
    });
  });

  describe('Incorrect checkout restoration', () => {
    async function createCheckedOutRestoreFixture({ roomNumber, memberId = 'gaurav' }) {
      const room = await ensureRoom(roomNumber, 1);
      const stay = await stayService.createStay({
        memberId,
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 0,
        actorRole: 'superadmin',
        historicalReason: 'Verified historical restoration fixture',
      });
      const checkout = await stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        actorRole: 'admin',
      });
      const request = {
        stayId: stay.stayId,
        joinedOn: '2026-10-01',
        occupancyFromDate: '2026-10-01',
        roomId: room.roomId,
        assignmentAction: 'REOPEN_EXISTING',
        assignmentId: stay.admissionAssignmentId,
        expectedRevision: checkout.stay.revision,
        reason: 'Resident never left; correct the recorded checkout',
        actorRole: 'superadmin',
      };
      return { room, stay, checkout, request };
    }

    it('allows LINK_EXISTING only for an uncancelled open assignment covering the approved occupancy date', async () => {
      const ended = await createCheckedOutRestoreFixture({ roomNumber: 'link-ended' });
      const endedPreview = await stayService.previewRestoreResident({
        ...ended.request,
        assignmentAction: 'LINK_EXISTING',
      });
      assert.equal(endedPreview.canApply, false);
      assert.ok(endedPreview.conflicts.some((conflict) => conflict.code === 'ASSIGNMENT_NOT_ACTIVE'));

      const cancelled = await createCheckedOutRestoreFixture({ roomNumber: 'link-cancelled', memberId: 'nikhil' });
      await RoomAssignment.updateOne(
        { assignmentId: cancelled.stay.admissionAssignmentId },
        { $set: { cancelledAt: new Date(), cancelledByRole: 'superadmin', cancelReason: 'Fixture cancellation' } },
      );
      const cancelledPreview = await stayService.previewRestoreResident(cancelled.request);
      assert.equal(cancelledPreview.canApply, false);
      assert.ok(cancelledPreview.conflicts.some((conflict) => conflict.code === 'ASSIGNMENT_CANCELLED'));

      const future = await createCheckedOutRestoreFixture({ roomNumber: 'link-future', memberId: 'devansh' });
      await RoomAssignment.updateOne(
        { assignmentId: future.stay.admissionAssignmentId },
        {
          $set: {
            effectiveFromDate: '2026-11-01',
            effectiveFromMonth: '2026-11',
            effectiveUntilDate: null,
            effectiveUntilMonth: null,
          },
        },
      );
      const futurePreview = await stayService.previewRestoreResident({
        ...future.request,
        assignmentAction: 'LINK_EXISTING',
      });
      assert.equal(futurePreview.canApply, false);
      assert.ok(futurePreview.conflicts.some((conflict) => conflict.code === 'ASSIGNMENT_DOES_NOT_COVER_OCCUPANCY'));
    });

    it('rejects restoration dates later than the current server date', async () => {
      const fixture = await createCheckedOutRestoreFixture({ roomNumber: 'restore-future' });
      await assert.rejects(
        stayService.previewRestoreResident({
          ...fixture.request,
          joinedOn: '2099-01-01',
          occupancyFromDate: '2099-01-01',
        }),
        (error) => error.statusCode === 400 && error.message.includes('future'),
      );
    });

    it('LINK_EXISTING preserves a valid active assignment unchanged', async () => {
      const fixture = await createCheckedOutRestoreFixture({ roomNumber: 'link-valid' });
      await RoomAssignment.updateOne(
        { assignmentId: fixture.stay.admissionAssignmentId },
        { $set: { effectiveUntilDate: null, effectiveUntilMonth: null } },
      );
      const request = { ...fixture.request, assignmentAction: 'LINK_EXISTING' };
      const preview = await stayService.previewRestoreResident(request);
      assert.equal(preview.canApply, true);
      assert.ok(!preview.changes.some((change) => change.collection === 'room_assignments'));

      await stayService.restoreResident({ ...request, previewToken: preview.previewToken });
      const assignment = await RoomAssignment.findOne({ assignmentId: fixture.stay.admissionAssignmentId }).lean();
      assert.equal(assignment.effectiveFromDate, '2026-10-01');
      assert.equal(assignment.effectiveUntilDate, null);
      assert.equal(assignment.cancelledAt, null);
    });

    it('serializes restoration against a concurrent assignment for the same resident in another room', async () => {
      const fixture = await createCheckedOutRestoreFixture({ roomNumber: 'restore-race' });
      const otherRoom = await ensureRoom('restore-race-2', 1);
      const preview = await stayService.previewRestoreResident(fixture.request);

      await Promise.allSettled([
        stayService.restoreResident({ ...fixture.request, previewToken: preview.previewToken }),
        roomFeeService.assignMemberToRoom({
          memberId: 'gaurav',
          roomId: otherRoom.roomId,
          effectiveFromMonth: '2026-10',
          effectiveFromDate: '2026-10-21',
          actorRole: 'admin',
        }),
      ]);

      const assignments = await RoomAssignment.find({ memberId: 'gaurav', cancelledAt: null }).lean();
      const activeOnRaceDate = assignments.filter((assignment) => {
        const from = assignment.effectiveFromDate || `${assignment.effectiveFromMonth}-01`;
        const until = assignment.effectiveUntilDate || '9999-12-31';
        return from <= '2026-10-21' && '2026-10-21' <= until;
      });
      assert.ok(activeOnRaceDate.length <= 1, 'Per-member assignment lock prevents overlapping commits');
    });

    it('rejects restoration when another active Stay already exists for the resident', async () => {
      const fixture = await createCheckedOutRestoreFixture({ roomNumber: 'restore-active' });
      const currentRoom = await ensureRoom('restore-current', 1);
      const activeStay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-21',
        initialRoomId: currentRoom.roomId,
        expectedDepositPaise: 0,
        actorRole: 'superadmin',
        historicalReason: 'Verified replacement Stay fixture',
      });

      const preview = await stayService.previewRestoreResident(fixture.request);
      assert.equal(preview.canApply, false);
      assert.ok(preview.conflicts.some((conflict) => conflict.code === 'ACTIVE_STAY_EXISTS'));
      await assert.rejects(
        stayService.restoreResident({ ...fixture.request, previewToken: preview.previewToken }),
        (error) => error.statusCode === 409 && error.details.code === 'RESTORATION_CONFLICT',
      );
      assert.equal((await HostelStay.findOne({ stayId: fixture.stay.stayId }).lean()).status, 'CHECKED_OUT');
      assert.equal((await HostelStay.findOne({ stayId: activeStay.stayId }).lean()).status, 'ACTIVE');
    });

    it('rejects a stale restoration preview after the Stay revision changes', async () => {
      const fixture = await createCheckedOutRestoreFixture({ roomNumber: 'restore-stale' });
      const preview = await stayService.previewRestoreResident(fixture.request);
      assert.equal(preview.canApply, true);

      await HostelStay.updateOne({ stayId: fixture.stay.stayId }, { $inc: { revision: 1 } });
      await assert.rejects(
        stayService.restoreResident({ ...fixture.request, previewToken: preview.previewToken }),
        (error) => error.statusCode === 409 && error.details.code === 'RESTORATION_PREVIEW_STALE',
      );
      assert.equal((await HostelStay.findOne({ stayId: fixture.stay.stayId }).lean()).status, 'CHECKED_OUT');
    });

    it('rejects restoration when the requested room period exceeds capacity', async () => {
      const fixture = await createCheckedOutRestoreFixture({ roomNumber: 'restore-capacity' });
      await roomFeeService.assignMemberToRoom({
        memberId: 'nikhil',
        roomId: fixture.room.roomId,
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-21',
        actorRole: 'admin',
      });

      const preview = await stayService.previewRestoreResident(fixture.request);
      assert.equal(preview.canApply, false);
      assert.ok(preview.conflicts.some((conflict) => conflict.code === 'ROOM_CAPACITY_CONFLICT'));
      await assert.rejects(
        stayService.restoreResident({ ...fixture.request, previewToken: preview.previewToken }),
        (error) => error.statusCode === 409 && error.details.code === 'RESTORATION_CONFLICT',
      );
      assert.equal((await HostelStay.findOne({ stayId: fixture.stay.stayId }).lean()).status, 'CHECKED_OUT');
    });

    it('warns without mutating a contradictory historical deposit ledger during preview', async () => {
      const room = await ensureRoom('restore-deposit', 1);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 0,
        actorRole: 'superadmin',
        historicalReason: 'Verified historical restoration fixture',
      });
      const checkout = await stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        actorRole: 'admin',
      });
      const account = await HostelDepositAccount.findOneAndUpdate(
        { stayId: stay.stayId },
        { $set: { status: 'OPEN', expectedDepositPaise: 0 } },
        { returnDocument: 'after' },
      ).lean();
      await HostelDepositTransaction.create({
        depositTransactionId: randomUUID(),
        depositAccountId: account.depositAccountId,
        stayId: stay.stayId,
        memberId: 'gaurav',
        type: 'RECEIVED',
        amountPaise: 4_800_000,
        method: 'cash',
        idempotencyKey: randomUUID(),
        recordedByRole: 'superadmin',
      });

      const preview = await stayService.previewRestoreResident({
        stayId: stay.stayId,
        joinedOn: '2026-10-01',
        occupancyFromDate: '2026-10-01',
        roomId: room.roomId,
        assignmentAction: 'REOPEN_EXISTING',
        assignmentId: stay.admissionAssignmentId,
        expectedRevision: checkout.stay.revision,
        reason: 'Resident never left; preserve contradictory deposit ledger for separate review',
        actorRole: 'superadmin',
      });

      assert.deepEqual(preview.warnings.map((warning) => warning.code), [
        'DEPOSIT_LEDGER_PRESERVED',
        'DEPOSIT_EXPECTATION_MISMATCH',
      ]);
      assert.deepEqual(preview.preservedFinancialRecords.deposit, {
        accountStatus: 'OPEN',
        expectedDepositPaise: 0,
        receivedPaise: 4_800_000,
        refundedPaise: 0,
        deductedPaise: 0,
        heldPaise: 4_800_000,
        transactionCount: 1,
      });
      assert.equal(await HostelDepositTransaction.countDocuments({ stayId: stay.stayId }), 1);
    });

    it('restores one checked-out Stay atomically while preserving financial history and revoking its clearance', async () => {
      const room = await ensureRoom('restore-lower', 1);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 0,
        actorRole: 'superadmin',
        historicalReason: 'Verified historical restoration fixture',
      });
      await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        amountPaise: 480000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      const { charges } = await roomFeeService.issueCharges('2026-10', 'admin');
      const charge = charges.find((item) => item.memberId === 'gaurav');
      await roomFeeService.recordPayment({
        chargeId: charge.chargeId,
        amountPaise: 480000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });
      const checkout = await stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        actorRole: 'admin',
      });
      const chargeCount = await RoomCharge.countDocuments({});
      const paymentCount = await RoomPayment.countDocuments({});

      const request = {
        stayId: stay.stayId,
        joinedOn: '2026-10-01',
        occupancyFromDate: '2026-10-01',
        roomId: room.roomId,
        assignmentAction: 'REOPEN_EXISTING',
        assignmentId: stay.admissionAssignmentId,
        expectedRevision: checkout.stay.revision,
        reason: 'Checkout was recorded even though the resident never left',
        actorRole: 'superadmin',
      };
      const preview = await stayService.previewRestoreResident(request);
      assert.equal(preview.canApply, true);
      assert.equal(preview.conflicts.length, 0);
      assert.ok(preview.previewToken);
      assert.ok(preview.changes.some((change) => change.collection === 'hostel_stays'));
      assert.ok(preview.changes.some((change) => change.collection === 'room_assignments'));
      assert.ok(preview.changes.some((change) => change.collection === 'hostel_clearances'));

      const restored = await stayService.restoreResident({
        ...request,
        previewToken: preview.previewToken,
      });
      assert.equal(restored.stay.status, 'ACTIVE');
      assert.equal(restored.stay.actualLeftOn, null);
      assert.equal(restored.stay.currentRoomId, room.roomId);

      const assignment = await RoomAssignment.findOne({ assignmentId: stay.admissionAssignmentId }).lean();
      assert.equal(assignment.effectiveUntilDate, null);
      assert.equal(assignment.effectiveUntilMonth, null);
      const clearance = await HostelClearance.findOne({ clearanceId: checkout.clearance.clearanceId }).lean();
      assert.equal(clearance.validityStatus, 'REVOKED');
      assert.equal(clearance.revocationReason, request.reason);
      assert.equal(await RoomCharge.countDocuments({}), chargeCount);
      assert.equal(await RoomPayment.countDocuments({}), paymentCount);
      assert.equal(await HostelDepositTransaction.countDocuments({ stayId: stay.stayId }), 0);

      const persistedStay = await HostelStay.findOne({ stayId: stay.stayId }).lean();
      const restorationEvent = persistedStay.history.find((entry) => entry.event === 'RESIDENT_RESTORED');
      assert.equal(restorationEvent.details.previousActualLeftOn, '2026-10-20');
      assert.equal(restorationEvent.details.revokedClearanceIds[0], checkout.clearance.clearanceId);
    });
  });

  describe('Current active residence repair', () => {
    async function createActualShapedActiveRepairFixture({ includeOtherResidents = true } = {}) {
      const room = await ensureRoom('lower-repair', 1);
      const firstAssignmentId = randomUUID();
      const currentAssignmentId = randomUUID();
      await RoomAssignment.insertMany([
        {
          assignmentId: firstAssignmentId,
          roomId: room.roomId,
          memberId: 'gaurav',
          effectiveFromMonth: '2026-10',
          effectiveFromDate: '2026-10-01',
          effectiveUntilMonth: '2026-10',
          effectiveUntilDate: '2026-10-19',
          assignedAt: new Date('2026-10-01T00:00:00.000Z'),
          assignedByRole: 'superadmin',
        },
        {
          assignmentId: currentAssignmentId,
          roomId: room.roomId,
          memberId: 'gaurav',
          effectiveFromMonth: '2026-10',
          effectiveFromDate: '2026-10-20',
          effectiveUntilMonth: '2026-10',
          effectiveUntilDate: '2026-10-21',
          assignedAt: new Date('2026-10-20T00:00:00.000Z'),
          assignedByRole: 'superadmin',
        },
      ]);
      const stay = await HostelStay.create({
        stayId: randomUUID(),
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        status: 'ACTIVE',
        initialRoomId: room.roomId,
        currentRoomId: room.roomId,
        admissionAssignmentId: firstAssignmentId,
        admissionAssignmentOwned: false,
        revision: 0,
        financialRevision: 2,
      });
      const feePlanId = randomUUID();
      const chargeId = randomUUID();
      const roomPaymentId = randomUUID();
      await RoomFeePlan.create({
        feePlanId,
        memberId: 'gaurav',
        amountPaise: 480_000,
        effectiveFromMonth: '2026-10',
        effectiveUntilMonth: null,
        dueDay: 5,
        reason: 'Verified current fee plan',
        createdByRole: 'superadmin',
      });
      await RoomCharge.create({
        chargeId,
        memberId: 'gaurav',
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        month: '2026-10',
        feePlanId,
        baseAmountPaise: 480_000,
        dueDate: '2026-10-05',
        status: 'issued',
        issuedAt: new Date('2026-10-01T00:00:00.000Z'),
        issuedByRole: 'superadmin',
      });
      await RoomPayment.create({
        roomPaymentId,
        chargeId,
        memberId: 'gaurav',
        month: '2026-10',
        amountPaise: 480_000,
        method: 'upi',
        recipientSnapshot: {
          recipientMode: 'admin_collector',
          recipientName: 'MealKhata',
        },
        idempotencyKey: randomUUID(),
        status: 'verified',
        recordedAt: new Date('2026-10-05T00:00:00.000Z'),
        recordedByRole: 'superadmin',
      });

      const protectedResidentIds = [];
      if (includeOtherResidents) {
        for (const memberId of ['nikhil', 'devansh']) {
          const protectedRoom = await ensureRoom(`${memberId}-repair`, 1);
          const assignmentId = randomUUID();
          const protectedStayId = randomUUID();
          await RoomAssignment.create({
            assignmentId,
            roomId: protectedRoom.roomId,
            memberId,
            effectiveFromMonth: '2026-10',
            effectiveFromDate: '2026-10-01',
            effectiveUntilMonth: null,
            effectiveUntilDate: null,
            assignedAt: new Date('2026-10-01T00:00:00.000Z'),
            assignedByRole: 'superadmin',
          });
          await HostelStay.create({
            stayId: protectedStayId,
            memberId,
            joinedOn: '2026-10-01',
            status: 'ACTIVE',
            initialRoomId: protectedRoom.roomId,
            currentRoomId: protectedRoom.roomId,
            admissionAssignmentId: assignmentId,
            currentAssignmentId: assignmentId,
            revision: 0,
            financialRevision: 0,
          });
          protectedResidentIds.push({ memberId, assignmentId, stayId: protectedStayId, roomId: protectedRoom.roomId });
        }
      }
      return {
        room,
        stay: stay.toObject(),
        firstAssignmentId,
        currentAssignmentId,
        feePlanId,
        chargeId,
        roomPaymentId,
        protectedResidentIds,
      };
    }

    it('extends the later historical assignment without rewriting its original start or creating another Stay', async () => {
      const fixture = await createActualShapedActiveRepairFixture();
      const request = {
        stayId: fixture.stay.stayId,
        roomId: fixture.room.roomId,
        assignmentAction: 'EXTEND_EXISTING_ASSIGNMENT',
        assignmentId: fixture.currentAssignmentId,
        expectedRevision: fixture.stay.revision,
        reason: 'Verified continuous occupancy in Room lower',
        actorRole: 'superadmin',
      };

      const preview = await stayService.previewRoomAssignmentRepair(request);
      assert.equal(preview.canApply, true);
      assert.equal(preview.proposedAssignment.effectiveFromDate, '2026-10-20');
      assert.equal(preview.proposedAssignment.effectiveUntilDate, null);

      const result = await stayService.repairRoomAssignment({
        ...request,
        previewToken: preview.previewToken,
      });

      assert.equal(result.stay.stayId, fixture.stay.stayId);
      assert.equal(result.stay.joinedOn, '2026-10-01');
      assert.equal(result.stay.currentAssignmentId, fixture.currentAssignmentId);
      assert.equal(await HostelStay.countDocuments({ memberId: 'gaurav' }), 1);
      assert.equal(await RoomAssignment.countDocuments({ memberId: 'gaurav' }), 2);
      assert.equal(await RoomCharge.countDocuments({ chargeId: fixture.chargeId, baseAmountPaise: 480_000 }), 1);
      assert.equal(await RoomPayment.countDocuments({ roomPaymentId: fixture.roomPaymentId, amountPaise: 480_000 }), 1);
      assert.equal(await RoomFeePlan.countDocuments({ feePlanId: fixture.feePlanId, amountPaise: 480_000 }), 1);

      const first = await RoomAssignment.findOne({ assignmentId: fixture.firstAssignmentId }).lean();
      const repaired = await RoomAssignment.findOne({ assignmentId: fixture.currentAssignmentId }).lean();
      assert.equal(first.effectiveUntilDate, '2026-10-19');
      assert.equal(repaired.effectiveFromDate, '2026-10-20');
      assert.equal(repaired.effectiveUntilDate, null);
      assert.equal(result.stay.history.at(-1).event, 'ROOM_ASSIGNMENT_REPAIRED');
      for (const protectedResident of fixture.protectedResidentIds) {
        const protectedStay = await HostelStay.findOne({ stayId: protectedResident.stayId }).lean();
        const protectedAssignment = await RoomAssignment.findOne({ assignmentId: protectedResident.assignmentId }).lean();
        assert.equal(protectedStay.status, 'ACTIVE');
        assert.equal(protectedStay.currentRoomId, protectedResident.roomId);
        assert.equal(protectedStay.revision, 0);
        assert.equal(protectedAssignment.effectiveUntilDate, null);
      }
    });

    it('blocks repair when opening the assignment would exceed room capacity', async () => {
      const fixture = await createActualShapedActiveRepairFixture({ includeOtherResidents: false });
      await RoomAssignment.create({
        assignmentId: randomUUID(),
        roomId: fixture.room.roomId,
        memberId: 'nikhil',
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-22',
        effectiveUntilMonth: null,
        effectiveUntilDate: null,
        assignedAt: new Date(),
        assignedByRole: 'superadmin',
      });

      const preview = await stayService.previewRoomAssignmentRepair({
        stayId: fixture.stay.stayId,
        roomId: fixture.room.roomId,
        assignmentAction: 'EXTEND_EXISTING_ASSIGNMENT',
        assignmentId: fixture.currentAssignmentId,
        expectedRevision: fixture.stay.revision,
        reason: 'Verified continuous occupancy in Room lower',
        actorRole: 'superadmin',
      });

      assert.equal(preview.canApply, false);
      assert.ok(preview.conflicts.some((conflict) => conflict.code === 'ROOM_CAPACITY_CONFLICT'));
    });

    it('rolls back the assignment extension if the Stay update fails later in the transaction', async () => {
      const fixture = await createActualShapedActiveRepairFixture({ includeOtherResidents: false });
      const failingRoomFees = {
        ...roomFeeService,
        async repairActiveStayAssignment(args) {
          await roomFeeService.repairActiveStayAssignment(args);
          throw new Error('Injected Stay update failure');
        },
      };
      const failingService = createStayService({
        roomFees: failingRoomFees,
        stayAttribution: defaultStayAttributionService,
      });
      const request = {
        stayId: fixture.stay.stayId,
        roomId: fixture.room.roomId,
        assignmentAction: 'EXTEND_EXISTING_ASSIGNMENT',
        assignmentId: fixture.currentAssignmentId,
        expectedRevision: fixture.stay.revision,
        reason: 'Verified continuous occupancy in Room lower',
        actorRole: 'superadmin',
      };
      const preview = await failingService.previewRoomAssignmentRepair(request);

      await assert.rejects(
        failingService.repairRoomAssignment({ ...request, previewToken: preview.previewToken }),
        /Injected Stay update failure/,
      );

      const assignment = await RoomAssignment.findOne({ assignmentId: fixture.currentAssignmentId }).lean();
      const stay = await HostelStay.findOne({ stayId: fixture.stay.stayId }).lean();
      assert.equal(assignment.effectiveUntilDate, '2026-10-21');
      assert.equal(stay.currentAssignmentId, null);
      assert.equal(stay.revision, 0);
      assert.equal(stay.history.some((entry) => entry.event === 'ROOM_ASSIGNMENT_REPAIRED'), false);
    });
  });

  describe('Erroneous historical Stay reconciliation', () => {
    async function createHistoricalReconciliationFixture({ heldDepositPaise = 0 } = {}) {
      const room = await ensureRoom('historical-reconcile', 1);
      const historicalStayId = randomUUID();
      const activeStayId = randomUUID();
      await HostelStay.insertMany([
        {
          stayId: historicalStayId,
          memberId: 'gaurav',
          joinedOn: '2026-10-20',
          actualLeftOn: '2026-10-21',
          status: 'CHECKED_OUT',
          initialRoomId: room.roomId,
          currentRoomId: room.roomId,
          checkoutFinalizedAt: new Date('2026-10-20T18:38:33.427Z'),
          checkoutFinalizedByRole: 'superadmin',
          revision: 1,
          clearanceSequence: 1,
        },
        {
          stayId: activeStayId,
          memberId: 'gaurav',
          joinedOn: '2026-10-01',
          status: 'ACTIVE',
          initialRoomId: room.roomId,
          currentRoomId: room.roomId,
          revision: 0,
          financialRevision: 0,
        },
      ]);
      const account = await HostelDepositAccount.create({
        depositAccountId: randomUUID(),
        stayId: historicalStayId,
        memberId: 'gaurav',
        expectedDepositPaise: 0,
        status: heldDepositPaise > 0 ? 'OPEN' : 'NOT_REQUIRED',
      });
      if (heldDepositPaise > 0) {
        await HostelDepositTransaction.create({
          depositTransactionId: randomUUID(),
          depositAccountId: account.depositAccountId,
          stayId: historicalStayId,
          memberId: 'gaurav',
          type: 'RECEIVED',
          amountPaise: heldDepositPaise,
          method: 'upi',
          idempotencyKey: randomUUID(),
          recordedAt: new Date('2026-10-20T17:51:08.171Z'),
          recordedByRole: 'superadmin',
        });
      }
      const clearance = await HostelClearance.create({
        clearanceId: randomUUID(),
        stayId: historicalStayId,
        memberId: 'gaurav',
        sequence: 1,
        joinedOn: '2026-10-20',
        actualLeftOn: '2026-10-21',
        lastRoomId: room.roomId,
        financialAsOf: new Date('2026-10-20T18:38:33.487Z'),
        messSummary: {},
        roomFeeSummary: {},
        expenseSummary: {},
        depositSummary: { heldPaise: heldDepositPaise },
        outstandingObligations: heldDepositPaise > 0
          ? [{ domain: 'SECURITY_DEPOSIT', amountPaise: heldDepositPaise }]
          : [],
        clearanceStatus: heldDepositPaise > 0 ? 'OUTSTANDING_DUES' : 'NO_DUES',
        finalizedAt: new Date('2026-10-20T18:38:33.487Z'),
        finalizedByRole: 'superadmin',
      });
      return {
        historicalStayId,
        activeStayId,
        clearanceId: clearance.clearanceId,
      };
    }

    it('supersedes the erroneous checked-out record without activating it and preserves the clearance snapshot', async () => {
      const fixture = await createHistoricalReconciliationFixture();
      const request = {
        stayId: fixture.historicalStayId,
        supersededByStayId: fixture.activeStayId,
        expectedRevision: 1,
        reason: 'Verified uninterrupted residence represented by the active Stay',
        actorRole: 'superadmin',
      };
      const preview = await stayService.previewHistoricalStayReconciliation(request);
      assert.equal(preview.canApply, true);
      assert.ok(preview.affectedRecords.some((record) => record.documentId === fixture.clearanceId));

      const result = await stayService.reconcileHistoricalStay({
        ...request,
        previewToken: preview.previewToken,
      });
      assert.equal(result.stay.status, 'SUPERSEDED');
      assert.equal(result.stay.supersededByStayId, fixture.activeStayId);
      assert.equal(result.stay.currentRoomId, (await HostelStay.findOne({ stayId: fixture.activeStayId }).lean()).currentRoomId);
      const replacement = await HostelStay.findOne({ stayId: fixture.activeStayId }).lean();
      assert.equal(replacement.status, 'ACTIVE');
      assert.equal(replacement.revision, 1);
      assert.ok(replacement.history.some((entry) => (
        entry.event === 'HISTORICAL_STAY_LINKED'
        && entry.details?.historicalStayId === fixture.historicalStayId
      )));
      assert.equal(await HostelStay.countDocuments({ memberId: 'gaurav', status: 'ACTIVE' }), 1);

      const clearance = await HostelClearance.findOne({ clearanceId: fixture.clearanceId }).lean();
      assert.equal(clearance.validityStatus, 'REVOKED');
      assert.equal(clearance.reconciliationId, result.reconciliationId);
      assert.equal(clearance.joinedOn, '2026-10-20');
      assert.equal(clearance.actualLeftOn, '2026-10-21');

      await assert.rejects(
        depositService.configureRequirement({
          stayId: fixture.historicalStayId,
          required: false,
          expectedDepositPaise: 0,
          expectedRevision: 0,
          reason: 'Superseded history must remain immutable',
          actorRole: 'superadmin',
        }),
        (error) => error.statusCode === 409 && error.details?.code === 'HISTORICAL_STAY_SUPERSEDED',
      );

      const insertedTransactionId = randomUUID();
      const account = await HostelDepositAccount.findOne({ stayId: fixture.historicalStayId }).lean();
      await HostelDepositTransaction.create({
        depositTransactionId: insertedTransactionId,
        depositAccountId: account.depositAccountId,
        stayId: fixture.historicalStayId,
        memberId: 'gaurav',
        type: 'RECEIVED',
        amountPaise: 1_000,
        method: 'cash',
        idempotencyKey: randomUUID(),
        recordedAt: new Date(),
        recordedByRole: 'superadmin',
      });
      await assert.rejects(
        depositService.voidTransaction({
          stayId: fixture.historicalStayId,
          depositTransactionId: insertedTransactionId,
          reason: 'Superseded history must remain immutable',
          actorRole: 'superadmin',
        }),
        (error) => error.statusCode === 409 && error.details?.code === 'HISTORICAL_STAY_SUPERSEDED',
      );
      assert.equal((await HostelDepositTransaction.findOne({ depositTransactionId: insertedTransactionId }).lean()).status, 'recorded');
    });

    it('fails the replacement Stay CAS when its lifecycle revision changes', async () => {
      const fixture = await createHistoricalReconciliationFixture();
      await HostelStay.updateOne({ stayId: fixture.activeStayId }, { $inc: { revision: 1 } });
      const locked = await stayRepository.lockHistoricalReplacementStay(
        fixture.activeStayId,
        {
          memberId: 'gaurav',
          expectedRevision: 0,
          historicalStayId: fixture.historicalStayId,
          reconciliationId: randomUUID(),
          reason: 'Concurrency regression check',
          actorRole: 'superadmin',
          reconciledAt: new Date(),
        },
      );
      assert.equal(locked, null);
    });

    it('rejects reconciliation while the historical Stay still holds real deposit money', async () => {
      const fixture = await createHistoricalReconciliationFixture({ heldDepositPaise: 4_800_000 });
      const preview = await stayService.previewHistoricalStayReconciliation({
        stayId: fixture.historicalStayId,
        supersededByStayId: fixture.activeStayId,
        expectedRevision: 1,
        reason: 'Verified uninterrupted residence represented by the active Stay',
        actorRole: 'superadmin',
      });
      assert.equal(preview.canApply, false);
      assert.ok(preview.conflicts.some((conflict) => conflict.code === 'DEPOSIT_BALANCE_REMAINS'));
    });
  });

  describe('Real-money deposit reclassification', () => {
    async function createMisclassifiedReceiptFixture({
      refundedPaise = 0,
      secondReceiptPaise = 0,
      reference = null,
    } = {}) {
      const room = await ensureRoom('pay-reclass', 1);
      const stayId = randomUUID();
      const depositAccountId = randomUUID();
      const depositTransactionId = randomUUID();
      await HostelStay.create({
        stayId,
        memberId: 'gaurav',
        joinedOn: '2026-10-20',
        actualLeftOn: '2026-10-21',
        status: 'CHECKED_OUT',
        initialRoomId: room.roomId,
        currentRoomId: room.roomId,
        checkoutFinalizedAt: new Date('2026-10-20T18:38:33.427Z'),
        checkoutFinalizedByRole: 'superadmin',
        clearanceReviewOpenedAt: new Date('2026-10-25T00:00:00.000Z'),
        clearanceReviewOpenedByRole: 'superadmin',
        clearanceReviewReason: 'Review misclassified real-money receipt',
        revision: 1,
        financialRevision: 0,
        clearanceSequence: 1,
      });
      await HostelDepositAccount.create({
        depositAccountId,
        stayId,
        memberId: 'gaurav',
        expectedDepositPaise: 0,
        status: 'OPEN',
        revision: 0,
      });
      await HostelDepositTransaction.create({
        depositTransactionId,
        depositAccountId,
        stayId,
        memberId: 'gaurav',
        type: 'RECEIVED',
        amountPaise: 4_800_000,
        method: 'upi',
        reference,
        idempotencyKey: randomUUID(),
        recordedAt: new Date('2026-10-20T17:51:08.171Z'),
        recordedByRole: 'superadmin',
      });
      if (secondReceiptPaise > 0) {
        await HostelDepositTransaction.create({
          depositTransactionId: randomUUID(),
          depositAccountId,
          stayId,
          memberId: 'gaurav',
          type: 'RECEIVED',
          amountPaise: secondReceiptPaise,
          method: 'upi',
          idempotencyKey: randomUUID(),
          recordedAt: new Date('2026-10-20T18:00:00.000Z'),
          recordedByRole: 'superadmin',
        });
      }
      if (refundedPaise > 0) {
        await HostelDepositTransaction.create({
          depositTransactionId: randomUUID(),
          depositAccountId,
          stayId,
          memberId: 'gaurav',
          type: 'REFUNDED',
          amountPaise: refundedPaise,
          method: 'upi',
          idempotencyKey: randomUUID(),
          recordedAt: new Date('2026-10-21T00:00:00.000Z'),
          recordedByRole: 'superadmin',
        });
      }
      const clearance = await HostelClearance.create({
        clearanceId: randomUUID(),
        stayId,
        memberId: 'gaurav',
        sequence: 1,
        joinedOn: '2026-10-20',
        actualLeftOn: '2026-10-21',
        lastRoomId: room.roomId,
        financialAsOf: new Date('2026-10-20T18:38:33.487Z'),
        messSummary: {},
        roomFeeSummary: {},
        expenseSummary: {},
        depositSummary: { heldPaise: 4_800_000 },
        outstandingObligations: [{ domain: 'SECURITY_DEPOSIT', amountPaise: 4_800_000 }],
        clearanceStatus: 'OUTSTANDING_DUES',
        finalizedAt: new Date('2026-10-20T18:38:33.487Z'),
        finalizedByRole: 'superadmin',
      });
      return { stayId, depositAccountId, depositTransactionId, clearanceId: clearance.clearanceId };
    }

    function reclassificationRequest(fixture, overrides = {}) {
      return {
        stayId: fixture.stayId,
        sourceDepositTransactionId: fixture.depositTransactionId,
        expectedAccountRevision: 0,
        allocations: [{
          category: 'UNALLOCATED_CREDIT',
          memberId: 'gaurav',
          targetAccount: 'PENDING_CLASSIFICATION',
          amountPaise: 4_800_000,
        }],
        reason: 'Receipt is real money but its final business purpose is not yet verified',
        idempotencyKey: randomUUID(),
        actorRole: 'superadmin',
        ...overrides,
      };
    }

    it('moves the full receipt effect to one auditable unallocated credit and marks the zero account not required', async () => {
      const fixture = await createMisclassifiedReceiptFixture();
      const request = reclassificationRequest(fixture);
      const preview = await depositService.previewPaymentReclassification(request);
      assert.equal(preview.canApply, true);
      assert.equal(preview.moneyConservation.sourceAmountPaise, 4_800_000);
      assert.equal(preview.moneyConservation.allocatedAmountPaise, 4_800_000);

      const result = await depositService.reclassifyPayment({
        ...request,
        previewToken: preview.previewToken,
      });
      const source = await HostelDepositTransaction.findOne({
        depositTransactionId: fixture.depositTransactionId,
      }).lean();
      assert.equal(source.status, 'reclassified');
      assert.equal(source.reclassificationId, result.reclassificationId);
      assert.equal((await HostelDepositAccount.findOne({ depositAccountId: fixture.depositAccountId }).lean()).status, 'NOT_REQUIRED');
      const persistedSummary = await depositService.getDepositSummary(fixture.stayId);
      assert.equal(persistedSummary.summary.heldPaise, 0);
      assert.equal(persistedSummary.transactions.length, 1);
      assert.equal(persistedSummary.transactions[0].status, 'reclassified');
      assert.equal(persistedSummary.reclassifications.length, 1);
      assert.equal(persistedSummary.unallocatedCredits.length, 1);
      assert.equal(persistedSummary.unallocatedCredits[0].amountPaise, 4_800_000);
      assert.equal(await mongoose.connection.collection('payment_reclassifications').countDocuments({}), 1);
      assert.equal(await mongoose.connection.collection('unallocated_credits').countDocuments({}), 1);

      const credit = await mongoose.connection.collection('unallocated_credits').findOne({
        reclassificationId: result.reclassificationId,
      });
      assert.equal(credit.amountPaise, 4_800_000);
      assert.equal(credit.sourceDepositTransactionId, fixture.depositTransactionId);
      const clearance = await HostelClearance.findOne({ clearanceId: fixture.clearanceId }).lean();
      assert.equal(clearance.validityStatus, 'REVOKED');
      assert.equal(clearance.reconciliationId, result.reclassificationId);

      const retry = await depositService.reclassifyPayment({
        ...request,
        previewToken: preview.previewToken,
      });
      assert.equal(retry.reclassificationId, result.reclassificationId);
      assert.equal(await mongoose.connection.collection('unallocated_credits').countDocuments({}), 1);
    });

    it('rejects unsupported destinations and any allocation that does not conserve the exact source amount', async () => {
      const fixture = await createMisclassifiedReceiptFixture();
      const invalidTarget = await depositService.previewPaymentReclassification(reclassificationRequest(fixture, {
        allocations: [{
          category: 'ROOM_PAYMENT',
          memberId: 'gaurav',
          targetAccount: 'already-paid-charge',
          amountPaise: 4_800_000,
        }],
      }));
      assert.equal(invalidTarget.canApply, false);
      assert.ok(invalidTarget.conflicts.some((conflict) => conflict.code === 'UNSUPPORTED_DESTINATION'));

      const shortAllocation = await depositService.previewPaymentReclassification(reclassificationRequest(fixture, {
        allocations: [{
          category: 'UNALLOCATED_CREDIT',
          memberId: 'gaurav',
          targetAccount: 'PENDING_CLASSIFICATION',
          amountPaise: 4_700_000,
        }],
      }));
      assert.equal(shortAllocation.canApply, false);
      assert.ok(shortAllocation.conflicts.some((conflict) => conflict.code === 'MONEY_CONSERVATION_FAILED'));
    });

    it('revalidates allocation invariants against the source loaded inside the transaction', async () => {
      const fixture = await createMisclassifiedReceiptFixture();
      await assert.rejects(
        stayRepository.executeAtomicPaymentReclassification({
          stayId: fixture.stayId,
          sourceDepositTransactionId: fixture.depositTransactionId,
          expectedAccountRevision: 0,
          allocations: [{
            category: 'UNALLOCATED_CREDIT',
            memberId: 'gaurav',
            targetAccount: 'PENDING_CLASSIFICATION',
            amountPaise: 4_700_000,
          }],
          reason: 'Direct repository call must preserve money exactly',
          idempotencyKey: randomUUID(),
          requestFingerprint: 'transactional-invariant-regression',
          actorRole: 'superadmin',
        }),
        (error) => error.statusCode === 409 && error.details?.code === 'MONEY_CONSERVATION_FAILED',
      );
      assert.equal(await PaymentReclassification.countDocuments({}), 0);
      assert.equal(await UnallocatedCredit.countDocuments({}), 0);
      assert.equal((await HostelDepositTransaction.findOne({
        depositTransactionId: fixture.depositTransactionId,
      }).lean()).status, 'recorded');
    });

    it('rejects reclassification after any refund or deduction consumed part of the receipt', async () => {
      const fixture = await createMisclassifiedReceiptFixture({
        secondReceiptPaise: 200_000,
        refundedPaise: 100_000,
      });
      const preview = await depositService.previewPaymentReclassification(reclassificationRequest(fixture));
      assert.equal(preview.canApply, false);
      assert.ok(preview.conflicts.some((conflict) => conflict.code === 'SOURCE_FUNDS_ALREADY_DISPOSED'));
    });

    it('rejects a receipt reference that is already active in another payment ledger', async () => {
      const reference = 'UPI-GAURAV-48000';
      const fixture = await createMisclassifiedReceiptFixture({ reference });
      await Payment.create({
        paymentId: randomUUID(),
        month: '2026-10',
        memberId: 'gaurav',
        amountPaise: 4_800_000,
        method: 'upi',
        upiReference: reference,
        billAmountAtPaymentPaise: 4_800_000,
        periodTypeAtPayment: 'current',
        payeeSnapshot: { receiverName: 'MealKhata' },
        recordedAt: new Date('2026-10-20T17:51:08.171Z'),
        recordedByRole: 'superadmin',
        idempotencyKey: randomUUID(),
      });

      const preview = await depositService.previewPaymentReclassification(reclassificationRequest(fixture));
      assert.equal(preview.canApply, false);
      assert.ok(preview.conflicts.some((conflict) => conflict.code === 'DUPLICATE_PAYMENT_REFERENCE'));
    });

    it('detects the same external reference in an expense reimbursement for another member', async () => {
      const reference = ' UPI-CROSS-MEMBER-48000 ';
      const fixture = await createMisclassifiedReceiptFixture({ reference });
      await ExpenseReimbursement.create({
        reimbursementId: randomUUID(),
        expenseId: randomUUID(),
        expenseMonth: '2026-10',
        fromMemberId: 'nikhil',
        toMemberId: 'devansh',
        amountPaise: 10_000,
        method: 'upi',
        reference: 'upi-cross-member-48000',
        idempotencyKey: randomUUID(),
        status: 'recorded',
        recordedAt: new Date('2026-10-20T17:51:08.171Z'),
        recordedByRole: 'superadmin',
      });

      const preview = await depositService.previewPaymentReclassification(reclassificationRequest(fixture));
      assert.equal(preview.canApply, false);
      assert.ok(preview.conflicts.some((conflict) => (
        conflict.code === 'DUPLICATE_PAYMENT_REFERENCE'
        && conflict.duplicate?.collection === 'expense_reimbursements'
      )));
    });

    it('serializes a concurrent reclassification and cross-ledger write using one external reference claim', async () => {
      const reference = 'UPI-CONCURRENT-CROSS-LEDGER';
      const fixture = await createMisclassifiedReceiptFixture({ reference });
      const request = reclassificationRequest(fixture);
      const preview = await depositService.previewPaymentReclassification(request);
      const messPayment = {
        paymentId: randomUUID(),
        month: '2026-10',
        memberId: 'gaurav',
        amountPaise: 10_000,
        method: 'upi',
        upiReference: reference,
        billAmountAtPaymentPaise: 10_000,
        periodTypeAtPayment: 'current',
        payeeSnapshot: { receiverName: 'MealKhata' },
        recordedAt: new Date('2026-10-20T17:51:09.171Z'),
        recordedByRole: 'superadmin',
        idempotencyKey: randomUUID(),
      };

      const outcomes = await Promise.allSettled([
        depositService.reclassifyPayment({ ...request, previewToken: preview.previewToken }),
        paymentRepository.create(messPayment),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
      assert.equal(await Payment.countDocuments({ upiReference: reference }), 0);
      assert.equal(await PaymentReclassification.countDocuments({}), 1);
    });

    it('never allows a reclassified source receipt to enter the ordinary void path', async () => {
      const fixture = await createMisclassifiedReceiptFixture({ secondReceiptPaise: 4_800_000 });
      const request = reclassificationRequest(fixture);
      const preview = await depositService.previewPaymentReclassification(request);
      const result = await depositService.reclassifyPayment({ ...request, previewToken: preview.previewToken });

      await assert.rejects(
        depositService.voidTransaction({
          stayId: fixture.stayId,
          depositTransactionId: fixture.depositTransactionId,
          reason: 'Must not break the correction journal link',
          actorRole: 'superadmin',
        }),
        (error) => error.statusCode === 409 && error.details?.code === 'DEPOSIT_TRANSACTION_NOT_ACTIVE',
      );
      const source = await HostelDepositTransaction.findOne({
        depositTransactionId: fixture.depositTransactionId,
      }).lean();
      assert.equal(source.status, 'reclassified');
      assert.equal(source.reclassificationId, result.reclassificationId);
      assert.equal(await PaymentReclassification.countDocuments({ reclassificationId: result.reclassificationId }), 1);
      assert.equal(await UnallocatedCredit.countDocuments({ reclassificationId: result.reclassificationId }), 1);
    });

    it('rolls back the correction journal when destination credit creation fails', async () => {
      const fixture = await createMisclassifiedReceiptFixture();
      const request = reclassificationRequest(fixture);
      const preview = await depositService.previewPaymentReclassification(request);
      const originalInsertMany = UnallocatedCredit.insertMany;
      UnallocatedCredit.insertMany = async () => {
        throw new Error('Injected destination write failure');
      };

      try {
        await assert.rejects(
          depositService.reclassifyPayment({ ...request, previewToken: preview.previewToken }),
          /Injected destination write failure/,
        );
      } finally {
        UnallocatedCredit.insertMany = originalInsertMany;
      }

      const source = await HostelDepositTransaction.findOne({
        depositTransactionId: fixture.depositTransactionId,
      }).lean();
      const account = await HostelDepositAccount.findOne({
        depositAccountId: fixture.depositAccountId,
      }).lean();
      assert.equal(source.status, 'recorded');
      assert.equal(source.reclassificationId, null);
      assert.equal(account.status, 'OPEN');
      assert.equal(account.revision, 0);
      assert.equal(await PaymentReclassification.countDocuments({}), 0);
      assert.equal(await UnallocatedCredit.countDocuments({}), 0);
    });

    it('allows only one of two concurrent corrections for the same source receipt', async () => {
      const fixture = await createMisclassifiedReceiptFixture();
      const first = reclassificationRequest(fixture);
      const second = reclassificationRequest(fixture);
      const [firstPreview, secondPreview] = await Promise.all([
        depositService.previewPaymentReclassification(first),
        depositService.previewPaymentReclassification(second),
      ]);
      const outcomes = await Promise.allSettled([
        depositService.reclassifyPayment({ ...first, previewToken: firstPreview.previewToken }),
        depositService.reclassifyPayment({ ...second, previewToken: secondPreview.previewToken }),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
      assert.equal(await mongoose.connection.collection('payment_reclassifications').countDocuments({}), 1);
      assert.equal(await mongoose.connection.collection('unallocated_credits').countDocuments({}), 1);
    });
  });

  describe('Fee Plan reconciliation', () => {
    it('previews six legacy overlap pairs and preserves referenced plans while applying the approved schedule', async () => {
      const room = await ensureRoom('fee-reconcile', 1);
      const assignment = await roomFeeService.assignMemberToRoom({
        memberId: 'gaurav',
        roomId: room.roomId,
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-01',
        actorRole: 'admin',
      });
      const planIds = Array.from({ length: 4 }, () => randomUUID());
      await RoomFeePlan.insertMany(planIds.map((feePlanId, index) => ({
        feePlanId,
        memberId: 'gaurav',
        amountPaise: index === 1 ? 250000 : 480000,
        effectiveFromMonth: '2026-10',
        effectiveUntilMonth: null,
        dueDay: 5,
        reason: `Legacy plan ${index + 1}`,
        createdByRole: 'superadmin',
      })));
      const chargeId = randomUUID();
      await RoomCharge.create({
        chargeId,
        memberId: 'gaurav',
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        feePlanId: planIds[2],
        month: '2026-10',
        baseAmountPaise: 480000,
        dueDate: '2026-10-05',
        status: 'issued',
        issuedByRole: 'superadmin',
      });

      const request = {
        memberId: 'gaurav',
        schedule: [{
          effectiveFromMonth: '2026-10',
          effectiveUntilMonth: null,
          amountPaise: 450000,
          dueDay: 5,
        }],
        reason: 'Apply the verified historical rent schedule',
        actorRole: 'superadmin',
      };
      const preview = await roomFeeService.previewFeePlanReconciliation(request);
      assert.equal(preview.overlappingPairs.length, 6);
      assert.equal(preview.canApply, true);
      assert.ok(preview.previewToken);
      assert.equal(preview.referencedPlans[0].feePlanId, planIds[2]);
      assert.equal(preview.referencedPlans[0].chargeIds[0], chargeId);

      const result = await roomFeeService.reconcileFeePlans({
        ...request,
        previewToken: preview.previewToken,
      });
      assert.equal(result.createdPlans.length, 1);
      assert.equal(result.supersededPlanIds.length, 4);

      const historicalPlans = await RoomFeePlan.find({ feePlanId: { $in: planIds } }).lean();
      assert.equal(historicalPlans.length, 4);
      assert.ok(historicalPlans.every((plan) => plan.supersededAt));
      const activePlans = await RoomFeePlan.find({ memberId: 'gaurav', supersededAt: null }).lean();
      assert.equal(activePlans.length, 1);
      assert.equal(activePlans[0].amountPaise, 450000);
      const preservedCharge = await RoomCharge.findOne({ chargeId }).lean();
      assert.equal(preservedCharge.feePlanId, planIds[2]);
      assert.equal(preservedCharge.baseAmountPaise, 480000);
    });

    it('serializes concurrent Fee Plan changes for one member', async () => {
      const changes = await Promise.allSettled([
        roomFeeService.createFeePlan({
          memberId: 'gaurav',
          amountPaise: 450000,
          effectiveFromMonth: '2026-10',
          reason: 'First verified schedule',
          actorRole: 'superadmin',
        }),
        roomFeeService.createFeePlan({
          memberId: 'gaurav',
          amountPaise: 480000,
          effectiveFromMonth: '2026-10',
          reason: 'Concurrent verified schedule',
          actorRole: 'superadmin',
        }),
      ]);

      assert.equal(changes.filter((change) => change.status === 'fulfilled').length, 1);
      assert.equal(changes.filter((change) => change.status === 'rejected').length, 1);
      assert.equal(changes.find((change) => change.status === 'rejected').reason.statusCode, 409);
      assert.equal(await RoomFeePlan.countDocuments({ memberId: 'gaurav', supersededAt: null }), 1);
    });
  });

  describe('Canonical member-account persistence', () => {
    it('concurrent provisioning cannot create duplicate identities and audit rolls back with the loser', async () => {
      const accounts = createMemberAccountService({
        verifyActorPassword: async () => {},
        now: () => new Date('2026-10-21T06:30:00.000Z'),
      });
      const actor = { role: 'superadmin', userId: 'root-1' };
      const results = await Promise.allSettled([
        accounts.provisionAccount({
          memberId: 'gaurav',
          email: 'gaurav.one@example.com',
          newPassword: 'FirstStrong!234',
          currentPassword: 'verified',
          actor,
        }),
        accounts.provisionAccount({
          memberId: 'gaurav',
          email: 'gaurav.two@example.com',
          newPassword: 'SecondStrong!234',
          currentPassword: 'verified',
          actor,
        }),
      ]);

      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      assert.equal(await UserAccount.countDocuments({ memberId: 'gaurav' }), 1);
      assert.equal(await MemberAccountAudit.countDocuments({ memberId: 'gaurav' }), 1);
    });
  });

  // =========================================================================
  // 5. CHECKOUT FINALIZATION ATOMICITY & CONCURRENCY
  // =========================================================================
  describe('Checkout Finalization & Clearance Concurrency', () => {
    it('Concurrent checkout finalizations: exactly ONE commits, preventing duplicate checkout', async () => {
      const room = await ensureRoom('401', 1);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });

      const final1 = stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        isException: true,
        allowWithDues: true,
        exceptionReason: 'Finalized with zero dues',
        actorRole: 'superadmin',
      });
      const final2 = stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        isException: true,
        allowWithDues: true,
        exceptionReason: 'Finalized with zero dues',
        actorRole: 'superadmin',
      });

      const results = await Promise.allSettled([final1, final2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Only one finalize checkout can commit');
      assert.equal(rejected.length, 1, 'Second request rejected with conflict');

      const finalStay = await stayRepository.findStayById(stay.stayId);
      assert.equal(finalStay.status, 'CHECKED_OUT');
      assert.equal(finalStay.actualLeftOn, '2026-10-20');

      const clearances = await stayRepository.findClearancesByStayId(stay.stayId);
      assert.equal(clearances.length, 1);
      assert.equal(clearances[0].sequence, 1);
    });

    it('Reissue clearance creates sequential immutable clearances without overwrite', async () => {
      const room = await ensureRoom('401', 1);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'superadmin',
        historicalReason: 'Verified historical clearance fixture',
      });

      await stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        isException: true,
        allowWithDues: true,
        exceptionReason: 'Finalized with zero dues',
        actorRole: 'superadmin',
      });

      const c2 = await stayService.reissueClearance({
        stayId: stay.stayId,
        reissueReason: 'Post-departure verification statement',
        actorRole: 'superadmin',
      });
      assert.equal(c2.sequence, 2);

      const all = await stayRepository.findClearancesByStayId(stay.stayId);
      assert.equal(all.length, 2);
      assert.equal(all[0].sequence, 2);
      assert.equal(all[0].validityStatus, 'ACTIVE');
      assert.equal(all[1].sequence, 1);
      assert.equal(all[1].validityStatus, 'SUPERSEDED');
      assert.equal(all[1].supersededByClearanceId, c2.clearanceId);
      assert.equal(all[1].supersessionReason, 'Post-departure verification statement');
      assert.ok(all[1].supersededAt);
      assert.equal(all[1].supersededByRole, 'superadmin');
    });
  });

  // =========================================================================
  // 6. MULTI-DOCUMENT TRANSACTION FAILURE INJECTION (ALL-OR-NOTHING)
  // =========================================================================
  describe('Multi-Document Failure Injection Tests', () => {
    it('Stay Onboarding: failure during fee plan creation rolls back assignment, stay, and deposit account', async () => {
      const room = await ensureRoom('501', 1);

      // Create custom stay service that injects failure on fee plan creation
      const failureStayService = createStayService({
        repository: stayRepository,
        roomFees: {
          ...roomFeeService,
          createFeePlan: async () => {
            throw new Error('SIMULATED_DB_FAILURE_IN_FEE_PLAN');
          },
        },
      });

      await assert.rejects(
        failureStayService.createStay({
          memberId: 'devansh',
          joinedOn: '2026-10-01',
          initialRoomId: room.roomId,
          monthlyFeePaise: 250000,
          expectedDepositPaise: 500000,
          actorRole: 'admin',
        }),
        /SIMULATED_DB_FAILURE_IN_FEE_PLAN/,
      );

      const stays = await HostelStay.find({ memberId: 'devansh', joinedOn: '2026-10-01' });
      assert.equal(stays.length, 0, 'No Stay document committed');

      const deposits = await HostelDepositAccount.find({ memberId: 'devansh' });
      assert.equal(deposits.length, 0, 'No DepositAccount document committed');

      const assignments = await RoomAssignment.find({ memberId: 'devansh', roomId: room.roomId });
      assert.equal(assignments.length, 0, 'No RoomAssignment document committed');
    });

    it('Checkout Finalization: failure during clearance snapshot creation rolls back stay update and assignment closing', async () => {
      const room = await ensureRoom('204', 2);
      const stay = await stayService.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });

      const failureCheckoutService = createStayService({
        repository: {
          ...stayRepository,
          createClearance: async () => {
            throw new Error('SIMULATED_DB_CLEARANCE_FAILURE');
          },
        },
        roomFees: roomFeeService,
      });

      await assert.rejects(
        failureCheckoutService.finalizeCheckout({
          stayId: stay.stayId,
          actualLeftOn: '2026-10-25',
          isException: true,
          allowWithDues: true,
          exceptionReason: 'Finalized',
          actorRole: 'superadmin',
        }),
        /SIMULATED_DB_CLEARANCE_FAILURE/,
      );

      const freshStay = await stayRepository.findStayById(stay.stayId);
      assert.equal(freshStay.status, 'ACTIVE');
      assert.equal(freshStay.actualLeftOn, null);

      const assignment = await RoomAssignment.findOne({ memberId: 'nikhil', roomId: room.roomId, effectiveUntilDate: null });
      assert.ok(assignment, 'Room assignment was not prematurely closed');
    });
  });

  // =========================================================================
  // 7. COMPLETE END-TO-END USER JOURNEYS (A through H)
  // =========================================================================
  describe('Complete End-to-End User Journeys (A through H)', () => {
    it('Executes Journeys A -> H sequentially: Joining, Rent Payment, Shared Expense, Transfer, Checkout, Rejoin, and Historical Correction', async () => {
      // -------------------------------------------------------------
      // Journey A — Joining
      // -------------------------------------------------------------
      const r601 = await ensureRoom('601', 1);
      const stay1 = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: r601.roomId,
        monthlyFeePaise: 280000,
        expectedDepositPaise: 500000,
        actorRole: 'admin',
      });

      assert.equal(stay1.memberId, 'gaurav');
      assert.equal(stay1.status, 'ACTIVE');

      const assignment1 = await RoomAssignment.findOne({ memberId: 'gaurav', roomId: r601.roomId }).lean();
      assert.ok(assignment1);
      assert.equal(assignment1.effectiveFromDate, '2026-10-01');

      const plan1 = await RoomFeePlan.findOne({ memberId: 'gaurav' }).lean();
      assert.ok(plan1);
      assert.equal(plan1.amountPaise, 280000);

      const dep1 = await HostelDepositAccount.findOne({ stayId: stay1.stayId }).lean();
      assert.ok(dep1);
      assert.equal(dep1.expectedDepositPaise, 500000);

      // -------------------------------------------------------------
      // Journey B — Rent Payment
      // -------------------------------------------------------------
      const issued = await roomFeeService.issueCharges('2026-10', 'admin');
      const charge = issued.charges.find((c) => c.memberId === 'gaurav');
      assert.ok(charge);

      // Partial payment ₹1,800
      const p1 = await roomFeeService.recordPayment({
        chargeId: charge.chargeId,
        amountPaise: 180000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });
      assert.equal(p1.amountPaise, 180000);

      const payments1 = await roomRepository.findPaymentsForCharge(charge.chargeId);
      const chargeCheck1 = await roomRepository.findChargeById(charge.chargeId);
      const fin1 = computeChargeFinancials({ charge: chargeCheck1, payments: payments1 });
      assert.equal(fin1.paidAmountPaise, 180000);
      assert.equal(fin1.paymentStatus, 'partial');

      // Final payment ₹1,000
      const p2 = await roomFeeService.recordPayment({
        chargeId: charge.chargeId,
        amountPaise: 100000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });
      assert.equal(p2.amountPaise, 100000);

      const payments2 = await roomRepository.findPaymentsForCharge(charge.chargeId);
      const chargeCheck2 = await roomRepository.findChargeById(charge.chargeId);
      const fin2 = computeChargeFinancials({ charge: chargeCheck2, payments: payments2 });
      assert.equal(fin2.paidAmountPaise, 280000);
      assert.equal(fin2.paymentStatus, 'paid');

      // -------------------------------------------------------------
      // Journey C — Shared Expense
      // -------------------------------------------------------------
      const expense = await expenseService.createExpense({
        month: '2026-10',
        date: '2026-10-10',
        title: 'Weekly Vegetables',
        category: 'groceries',
        amountPaise: 30000,
        paidByMemberId: 'gaurav',
        splitType: 'equal',
        participants: ['gaurav', 'nikhil', 'devansh'],
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });

      // Nikhil reimburses ₹60 (6,000 paise)
      const reimb = await expenseService.recordReimbursement({
        expenseId: expense.expenseId,
        fromMemberId: 'nikhil',
        amountPaise: 6000,
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });
      assert.equal(reimb.amountPaise, 6000);

      const activeReimbursements = await defaultExpenseRepository.findReimbursementsByExpenseId(expense.expenseId);
      const totalPaid = activeReimbursements.reduce((sum, r) => sum + r.amountPaise, 0);
      assert.equal(totalPaid, 6000);
      const remainingDebt = 10000 - totalPaid;
      assert.equal(remainingDebt, 4000);

      // -------------------------------------------------------------
      // Journey D — Room Transfer
      // -------------------------------------------------------------
      const r602 = await ensureRoom('602', 1);

      // Transfer from 601 to 602 on Oct 19
      await stayService.transferRoom({
        stayId: stay1.stayId,
        newRoomId: r602.roomId,
        effectiveDate: '2026-10-19',
        actorRole: 'admin',
      });

      // Previous assignment in 601 ends on Oct 18 (inclusive exact date model)
      const oldAssignment = await RoomAssignment.findOne({ memberId: 'gaurav', roomId: r601.roomId }).lean();
      assert.equal(oldAssignment.effectiveUntilDate, '2026-10-18');

      // New assignment in 602 begins on Oct 19
      const newAssignment = await RoomAssignment.findOne({ memberId: 'gaurav', roomId: r602.roomId }).lean();
      assert.equal(newAssignment.effectiveFromDate, '2026-10-19');
      assert.equal(newAssignment.effectiveUntilDate, null);

      // -------------------------------------------------------------
      // Journey E & F — Checkout with Settled Dues
      // -------------------------------------------------------------
      const finalCheckoutRes = await stayService.finalizeCheckout({
        stayId: stay1.stayId,
        actualLeftOn: '2026-10-25',
        actorRole: 'superadmin',
      });

      assert.equal(finalCheckoutRes.stay.status, 'CHECKED_OUT');
      assert.equal(finalCheckoutRes.clearance.clearanceStatus, 'NO_DUES');
      assert.equal(finalCheckoutRes.clearance.sequence, 1);

      // Assignment closed with departure date
      const closedAssignment = await RoomAssignment.findOne({ memberId: 'gaurav', roomId: r602.roomId }).lean();
      assert.equal(closedAssignment.effectiveUntilDate, '2026-10-25');

      // -------------------------------------------------------------
      // Journey G — Rejoin: Gaurav rejoins in Stay #2
      // -------------------------------------------------------------
      const stay2 = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-11-01',
        initialRoomId: r602.roomId,
        actorRole: 'admin',
      });

      assert.ok(stay2);
      assert.equal(stay2.status, 'ACTIVE');

      // Review for Stay #1 must strictly end at 2026-10 and NOT include November bills
      const reviewStay1 = await stayService.getCheckoutReview(stay1.stayId);
      const monthsReviewed = reviewStay1.monthlyOverviews.map((m) => m.month);
      assert.ok(monthsReviewed.includes('2026-10'));
      assert.ok(!monthsReviewed.includes('2026-11'), 'Stay #1 review never bleeds into Stay #2 November period');

      // -------------------------------------------------------------
      // Journey H — Historical Correction: Reissue Clearance for Stay #1
      // -------------------------------------------------------------
      const reissued = await stayService.reissueClearance({
        stayId: stay1.stayId,
        reissueReason: 'Post-departure verified clearance copy',
        actorRole: 'superadmin',
      });

      assert.equal(reissued.sequence, 2);
      assert.equal(reissued.clearanceStatus, 'NO_DUES');

      const allClearances = await stayRepository.findClearancesByStayId(stay1.stayId);
      assert.equal(allClearances.length, 2);
      assert.equal(allClearances[0].sequence, 2);
      assert.equal(allClearances[1].sequence, 1);
    });
  });

  // =========================================================================
  // 8. ROOM FEES MONGODB PERSISTENCE, CRUD & FINANCIAL INTEGRITY
  // =========================================================================
  describe('Room Fees MongoDB Persistence & Financial Invariants', () => {
    it('Room CRUD: create, query, edit, capacity conflict guard, and archive in real MongoDB', async () => {
      // 1. Create Room 204
      const created = await roomFeeService.createRoom({
        roomNumber: '204',
        roomLabel: 'Standard 204',
        capacity: 2,
        actorRole: 'admin',
      });
      assert.ok(created.roomId);
      assert.equal(created.roomNumber, '204');
      assert.equal(created.capacity, 2);

      // Verify persistence in MongoDB
      const foundInDb = await Room.findOne({ roomId: created.roomId }).lean();
      assert.ok(foundInDb);
      assert.equal(foundInDb.roomLabel, 'Standard 204');

      // 2. Assign members Gaurav and Nikhil
      await roomFeeService.assignMemberToRoom({
        roomId: created.roomId,
        memberId: 'gaurav',
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      await roomFeeService.assignMemberToRoom({
        roomId: created.roomId,
        memberId: 'nikhil',
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });

      // 3. Reject reducing capacity below active occupancy (2 active occupants)
      await assert.rejects(
        async () => {
          await roomFeeService.updateRoom(created.roomId, { capacity: 1 }, 'admin');
        },
        (err) => err.statusCode === 409
      );

      // 4. Update room label successfully
      const updated = await roomFeeService.updateRoom(
        created.roomId,
        { roomLabel: 'Deluxe Room 204' },
        'admin'
      );
      assert.equal(updated.roomLabel, 'Deluxe Room 204');
      const updatedInDb = await Room.findOne({ roomId: created.roomId }).lean();
      assert.equal(updatedInDb.roomLabel, 'Deluxe Room 204');

      // 5. Archive room
      const archived = await roomFeeService.updateRoom(created.roomId, { active: false }, 'admin');
      assert.equal(archived.active, false);
      const archivedInDb = await Room.findOne({ roomId: created.roomId }).lean();
      assert.equal(archivedInDb.active, false);
    });

    it('Fee Plans: independent member rates and future rate change preserves past rates', async () => {
      // Configure initial rates for Gaurav (₹3,500), Nikhil (₹2,500), Devansh (₹2,800)
      await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        amountPaise: 350000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'nikhil',
        amountPaise: 250000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'devansh',
        amountPaise: 280000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });

      // Verify active plan for October
      const nikhilOct = await roomFeeService.getActiveFeePlan('nikhil', '2026-10');
      assert.equal(nikhilOct.amountPaise, 250000);

      // Change Nikhil's rate effective next month (2026-11) to ₹3,000
      await roomFeeService.createFeePlan({
        memberId: 'nikhil',
        amountPaise: 300000,
        effectiveFromMonth: '2026-11',
        actorRole: 'admin',
      });

      // Past rate for October remains unchanged
      const nikhilOctAfter = await roomFeeService.getActiveFeePlan('nikhil', '2026-10');
      assert.equal(nikhilOctAfter.amountPaise, 250000);

      // Future rate for November is ₹3,000
      const nikhilNov = await roomFeeService.getActiveFeePlan('nikhil', '2026-11');
      assert.equal(nikhilNov.amountPaise, 300000);

      // History contains both plans
      const allPlans = await roomFeeService.getFeePlansForMember('nikhil');
      assert.equal(allPlans.length, 2);
    });

    it('Monthly Charges: preview and idempotent issuance in MongoDB', async () => {
      const room = await ensureRoom('205', 2);
      await roomFeeService.assignMemberToRoom({
        roomId: room.roomId,
        memberId: 'nikhil',
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'nikhil',
        amountPaise: 250000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });

      // Preview charges
      const preview = await roomFeeService.previewCharges('2026-10', 'admin');
      assert.ok(Array.isArray(preview.members));
      const nikhilPreview = preview.members.find((m) => m.memberId === 'nikhil');
      assert.ok(nikhilPreview);
      assert.equal(nikhilPreview.amountPaise, 250000);
      assert.equal(nikhilPreview.status, 'ready_to_issue');

      // Issue charges
      const issued = await roomFeeService.issueCharges('2026-10', 'admin');
      assert.ok(issued.charges.length >= 1);
      const chargeInDb = await RoomCharge.findOne({ memberId: 'nikhil', month: '2026-10' }).lean();
      assert.ok(chargeInDb);
      assert.equal(chargeInDb.baseAmountPaise, 250000);

      // Duplicate issuance produces 0 new charges
      const duplicateIssued = await roomFeeService.issueCharges('2026-10', 'admin');
      assert.equal(duplicateIssued.charges.length, 0);
    });

    it('Room Payments: records payment with chargeId, rejects invalid UUID / overpayment, and voids safely', async () => {
      const room = await ensureRoom('206', 2);
      await roomFeeService.assignMemberToRoom({
        roomId: room.roomId,
        memberId: 'devansh',
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'devansh',
        amountPaise: 280000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      await roomFeeService.issueCharges('2026-10', 'admin');
      const charge = await RoomCharge.findOne({ memberId: 'devansh', month: '2026-10' }).lean();
      assert.ok(charge);

      // Reject payment without valid chargeId
      await assert.rejects(
        async () => {
          await roomFeeService.recordPayment({
            chargeId: 'non-existent-charge',
            memberId: 'devansh',
            month: '2026-10',
            amountPaise: 100000,
            method: 'upi',
            idempotencyKey: randomUUID(),
            actorRole: 'admin',
          });
        },
        (err) => err.statusCode === 404
      );

      // Reject payment with non-UUID idempotency key
      await assert.rejects(
        async () => {
          await roomFeeService.recordPayment({
            chargeId: charge.chargeId,
            memberId: 'devansh',
            month: '2026-10',
            amountPaise: 100000,
            method: 'upi',
            idempotencyKey: 'pay-devansh-2026-10-12345',
            actorRole: 'admin',
          });
        },
        (err) => err.statusCode === 400
      );

      // Record valid partial payment of ₹1,000 (100,000 paise)
      const validPayment = await roomFeeService.recordPayment({
        chargeId: charge.chargeId,
        memberId: 'devansh',
        month: '2026-10',
        amountPaise: 100000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });
      assert.equal(validPayment.amountPaise, 100000);

      // Verify remaining balance is ₹1,800
      const summary = await roomFeeService.getMonthlySummary('2026-10', 'admin');
      const devanshSummary = summary.members.find((m) => m.memberId === 'devansh');
      assert.equal(devanshSummary.charge.paidAmountPaise, 100000);
      assert.equal(devanshSummary.charge.remainingAmountPaise, 180000);

      // Reject overpayment (> ₹1,800)
      await assert.rejects(
        async () => {
          await roomFeeService.recordPayment({
            chargeId: charge.chargeId,
            memberId: 'devansh',
            month: '2026-10',
            amountPaise: 200000,
            method: 'upi',
            idempotencyKey: randomUUID(),
            actorRole: 'admin',
          });
        },
        (err) => err.statusCode === 400
      );

      // Super Admin voids payment
      const voidResult = await roomFeeService.voidPayment({
        roomPaymentId: validPayment.roomPaymentId,
        reason: 'Entered payment against wrong room charge',
        actorRole: 'superadmin',
      });
      assert.equal(voidResult.status, 'voided');

      // Balance restores to ₹2,800 remaining
      const summaryAfterVoid = await roomFeeService.getMonthlySummary('2026-10', 'admin');
      const devanshAfterVoid = summaryAfterVoid.members.find((m) => m.memberId === 'devansh');
      assert.equal(devanshAfterVoid.charge.paidAmountPaise, 0);
      assert.equal(devanshAfterVoid.charge.remainingAmountPaise, 280000);
    });

    it('Room Payment Settings: persist and correctly nullify cleared optional fields', async () => {
      // Save settings with UPI and payment instructions
      const saved = await roomFeeService.updatePaymentSettings(
        {
          recipientMode: 'hostel_owner',
          recipientName: 'Gaurav Kumar',
          upiId: 'gaurav@upi',
          paymentInstructions: 'Pay by 5th of each month',
          defaultDueDay: 5,
        },
        'admin'
      );
      assert.equal(saved.upiId, 'gaurav@upi');
      assert.equal(saved.paymentInstructions, 'Pay by 5th of each month');

      // Reload directly from MongoDB
      const reloaded = await roomFeeService.getPaymentSettings();
      assert.equal(reloaded.upiId, 'gaurav@upi');
      assert.equal(reloaded.paymentInstructions, 'Pay by 5th of each month');

      // Update with cleared/null optional fields
      await roomFeeService.updatePaymentSettings(
        {
          recipientMode: 'hostel_owner',
          recipientName: 'Gaurav Kumar',
          upiId: null,
          paymentInstructions: null,
          defaultDueDay: 5,
        },
        'admin'
      );

      // Reload and confirm fields are cleared
      const cleared = await roomFeeService.getPaymentSettings();
      assert.equal(cleared.upiId, null);
      assert.equal(cleared.paymentInstructions, null);
    });
  });

  // =========================================================================
  // 9. SUPER ADMIN EXPENSE CORRECTIONS, AUDIT & REIMBURSEMENT PROTECTION
  // =========================================================================
  describe('Super Admin Expense Corrections & Deletion Suite', () => {
    it('Audited correction: amount edit without reimbursements preserves history and recomputes shares', async () => {
      // 1. Create expense ₹180 (18,000 paise) split equally 3 ways
      const expense = await expenseService.createExpense({
        date: '2026-10-20',
        title: 'Evening Samosas',
        category: 'snacks',
        amountPaise: 18000,
        paidByMemberId: 'gaurav',
        splitType: 'equal',
        participants: ['gaurav', 'nikhil', 'devansh'],
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });
      assert.ok(expense.revision);
      assert.equal(expense.amountPaise, 18000);

      // 2. Reject non-SuperAdmin editing
      await assert.rejects(
        async () => {
          await expenseService.correctExpense(expense.expenseId, {
            reason: 'Correction attempt',
            changes: { amountPaise: 15000 },
            expectedRevision: expense.revision,
            actorRole: 'admin',
          });
        },
        (err) => err.statusCode === 403
      );

      // 3. Super Admin corrects amount to ₹150 (15,000 paise)
      const corrected = await expenseService.correctExpense(expense.expenseId, {
        reason: 'Original amount entered incorrectly',
        changes: { amountPaise: 15000 },
        expectedRevision: expense.revision,
        actorRole: 'superadmin',
      });
      assert.ok(corrected.revision);
      assert.notEqual(corrected.revision, expense.revision);
      assert.equal(corrected.amountPaise, 15000);
      assert.equal(corrected.corrections.length, 1);
      assert.equal(corrected.corrections[0].reason, 'Original amount entered incorrectly');
      assert.equal(corrected.corrections[0].previousSnapshot.amountPaise, 18000);
      assert.equal(corrected.allocations.reduce((sum, a) => sum + a.amountPaise, 0), 15000);

      // 4. Stale revision concurrency conflict
      await assert.rejects(
        async () => {
          await expenseService.correctExpense(expense.expenseId, {
            reason: 'Concurrent edit with old revision',
            changes: { title: 'Evening Samosas Updated' },
            expectedRevision: expense.revision, // Outdated original revision
            actorRole: 'superadmin',
          });
        },
        (err) => err.statusCode === 409
      );
    });

    it('Reimbursement lock: blocks financial edits and voiding when active reimbursements exist', async () => {
      // 1. Create expense ₹300 (30,000 paise) split equally 3 ways
      const expense = await expenseService.createExpense({
        date: '2026-10-21',
        title: 'Groceries',
        category: 'groceries',
        amountPaise: 30000,
        paidByMemberId: 'gaurav',
        splitType: 'equal',
        participants: ['gaurav', 'nikhil', 'devansh'],
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });

      // 2. Nikhil reimburses ₹80 (8,000 paise)
      const reimb = await expenseService.recordReimbursement({
        expenseId: expense.expenseId,
        fromMemberId: 'nikhil',
        amountPaise: 8000,
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });
      assert.ok(reimb);

      // Fetch latest expense to get current revision after reimbursement
      const expenseAfterReimb = await expenseService.getExpenseById(expense.expenseId, {
        actorRole: 'superadmin',
      });

      // 3. Financial edit blocked because active reimbursement exists
      await assert.rejects(
        async () => {
          await expenseService.correctExpense(expense.expenseId, {
            reason: 'Try changing amount with active reimbursement',
            changes: { amountPaise: 25000 },
            expectedRevision: expenseAfterReimb.revision,
            actorRole: 'superadmin',
          });
        },
        (err) => err.statusCode === 409
      );

      // 4. Voiding expense blocked because active reimbursement exists
      await assert.rejects(
        async () => {
          await expenseService.voidExpense(expense.expenseId, {
            reason: 'Try voiding with active reimbursement',
            actorRole: 'superadmin',
          });
        },
        (err) => err.statusCode === 409
      );

      // 5. Metadata-only edit (title & note) succeeds even with active reimbursement
      const metaCorrected = await expenseService.correctExpense(expense.expenseId, {
        reason: 'Updating title and description',
        changes: { title: 'Supermarket Groceries', description: 'Includes soap and detergent' },
        expectedRevision: expenseAfterReimb.revision,
        actorRole: 'superadmin',
      });
      assert.equal(metaCorrected.title, 'Supermarket Groceries');
      assert.equal(metaCorrected.description, 'Includes soap and detergent');
      assert.equal(metaCorrected.amountPaise, 30000); // Unchanged

      // 6. Super Admin voids the reimbursement
      await expenseService.voidReimbursement(reimb.reimbursementId, {
        reason: 'Payment adjustment before expense deletion',
        actorRole: 'superadmin',
      });

      // 7. Now expense voiding succeeds
      const voided = await expenseService.voidExpense(expense.expenseId, {
        reason: 'Entered twice by mistake',
        actorRole: 'superadmin',
      });
      assert.equal(voided.status, 'voided');
      assert.equal(voided.voidReason, 'Entered twice by mistake');

      // Excluded from active totals
      const activeExpenses = await expenseService.listExpensesByMonth('2026-10', {
        actorRole: 'superadmin',
        status: 'active',
      });
      assert.ok(!activeExpenses.some((e) => e.expenseId === expense.expenseId));

      // Retained in MongoDB and history
      const fetchedById = await expenseService.getExpenseById(expense.expenseId, {
        actorRole: 'superadmin',
      });
      assert.equal(fetchedById.status, 'voided');
      assert.equal(fetchedById.voidReason, 'Entered twice by mistake');
    });
  });

  // =========================================================================
  // 5. P0 ADVANCED CONCURRENCY & CANONICAL STAY ATTRIBUTION (FINAL RELEASE PASS)
  // =========================================================================
  describe('P0 Advanced Concurrency & Stay Attribution Guarantees', () => {
    it('Exact date-based room occupancy interval sweep allows non-overlapping intervals within capacity', async () => {
      // Room 205 has capacity 2
      const room = await ensureRoom('205', 2);

      // A: 2026-10-01 to 2026-10-10
      await roomFeeService.assignMemberToRoom({
        roomId: room.roomId,
        memberId: 'gaurav',
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-01',
        effectiveUntilDate: '2026-10-10',
        actorRole: 'admin',
      });

      // B: 2026-10-11 to 2026-10-20
      await roomFeeService.assignMemberToRoom({
        roomId: room.roomId,
        memberId: 'nikhil',
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-11',
        effectiveUntilDate: '2026-10-20',
        actorRole: 'admin',
      });

      // C: 2026-10-01 to 2026-10-20 (Simultaneous occupancy is 2: A+C on Oct 1-10, B+C on Oct 11-20)
      const assignmentC = await roomFeeService.assignMemberToRoom({
        roomId: room.roomId,
        memberId: 'devansh',
        effectiveFromMonth: '2026-10',
        effectiveFromDate: '2026-10-01',
        effectiveUntilDate: '2026-10-20',
        actorRole: 'admin',
      });
      assert.ok(assignmentC);
      assert.equal(assignmentC.memberId, 'devansh');

      // Now create a 4th member resident attempt spanning 2026-10-05 to 2026-10-15
      // This MUST fail because on Oct 5-10, simultaneous occupancy would reach 3 (A, C, and D)
      await assert.rejects(
        async () => {
          await roomFeeService.assignMemberToRoom({
            roomId: room.roomId,
            memberId: 'gaurav', // gaurav re-attempting or conflicting
            effectiveFromMonth: '2026-10',
            effectiveFromDate: '2026-10-05',
            effectiveUntilDate: '2026-10-15',
            actorRole: 'admin',
          });
        },
        (err) => err.statusCode === 409
      );
    });

    it('Concurrent room assignments to a 1-capacity room accept at most one', async () => {
      const room = await ensureRoom('301', 1);

      const results = await Promise.allSettled([
        roomFeeService.assignMemberToRoom({
          roomId: room.roomId,
          memberId: 'gaurav',
          effectiveFromMonth: '2026-10',
          actorRole: 'admin',
        }),
        roomFeeService.assignMemberToRoom({
          roomId: room.roomId,
          memberId: 'nikhil',
          effectiveFromMonth: '2026-10',
          actorRole: 'admin',
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactly one concurrent assignment succeeds');
      assert.equal(rejected.length, 1, 'The competing assignment is rejected');
      const rejErr = rejected[0].reason;
      assert.ok(
        rejErr.statusCode === 409 || rejErr.code === 112 || rejErr.name === 'MongoServerError' || (rejErr.message && rejErr.message.includes('capacity')),
        'Competing assignment rejected via 409 capacity limit or transactional serialization'
      );

      // Verify in DB that only 1 assignment exists
      const assignments = await RoomAssignment.find({ roomId: room.roomId }).lean();
      assert.equal(assignments.length, 1);
    });

    it('Concurrent Expense void vs reimbursement race guarantees no reimbursement against voided expense', async () => {
      const exp = await expenseService.createExpense({
        title: 'Weekly Groceries',
        category: 'groceries',
        amountPaise: 30000,
        paidByMemberId: 'gaurav',
        date: '2026-10-05',
        splitType: 'equal',
        participants: ['gaurav', 'nikhil'],
        actorMemberId: 'gaurav',
        actorRole: 'admin',
      });

      // Concurrently run voidExpense and recordReimbursement
      const [voidResult, reimbResult] = await Promise.allSettled([
        expenseService.voidExpense(exp.expenseId, {
          reason: 'Duplicate purchase',
          actorRole: 'superadmin',
        }),
        expenseService.recordReimbursement(exp.expenseId, {
          fromMemberId: 'nikhil',
          amountPaise: 15000,
          paymentMethod: 'upi',
          actorRole: 'admin',
        }),
      ]);

      // Either:
      // Case 1: void succeeded first -> reimbursement must fail
      // Case 2: reimbursement succeeded first -> void must fail
      if (voidResult.status === 'fulfilled') {
        assert.equal(reimbResult.status, 'rejected', 'Reimbursement against voided expense must be rejected');
      } else {
        assert.equal(reimbResult.status, 'fulfilled', 'Reimbursement succeeded so void must be rejected');
        assert.equal(voidResult.status, 'rejected', 'Void with active reimbursement must be rejected');
      }

      // Final check: if expense is voided, NO active reimbursements exist
      const finalExp = await Expense.findOne({ expenseId: exp.expenseId }).lean();
      const reimbs = await ExpenseReimbursement.find({ expenseId: exp.expenseId, status: { $ne: 'voided' } }).lean();
      if (finalExp.status === 'voided') {
        assert.equal(reimbs.length, 0, 'No active reimbursement can exist on a voided expense');
      }
    });

    it('Concurrent Clearance Reissues receive unique and consecutive sequences', async () => {
      const room = await ensureRoom('206', 2);
      const stay = await stayService.createStay({
        memberId: 'devansh',
        joinedOn: '2026-09-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });

      // Finalize checkout without dues -> Clearance #1 generated
      const checkoutResult = await stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-09-30',
        allowWithDues: false,
        actorRole: 'admin',
      });
      assert.equal(checkoutResult.clearance.sequence, 1);

      // Concurrently reissue clearance twice
      const [reissue1, reissue2] = await Promise.allSettled([
        stayService.reissueClearance({
          stayId: stay.stayId,
          reissueReason: 'Updated contact details',
          actorRole: 'superadmin',
        }),
        stayService.reissueClearance({
          stayId: stay.stayId,
          reissueReason: 'Corrected departure certificate',
          actorRole: 'superadmin',
        }),
      ]);

      assert.equal(reissue1.status, 'fulfilled');
      assert.equal(reissue2.status, 'fulfilled');

      const seqs = [reissue1.value.sequence, reissue2.value.sequence].sort((a, b) => a - b);
      assert.deepEqual(seqs, [2, 3], 'Concurrently reissued clearances must have sequential unique sequences (2 and 3)');

      const totalClearances = await HostelClearance.find({ stayId: stay.stayId }).lean();
      assert.equal(totalClearances.length, 3, 'Total 3 immutable clearance records exist');
    });

    it('Checkout No-Dues consistency under a truly concurrent financial adjustment', async () => {
      const room = await ensureRoom('207', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });

      // Issue room fee charge for October: ₹2,800
      await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        amountPaise: 280000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      const issueResult = await roomFeeService.issueCharges('2026-10', 'admin');
      const charge = issueResult.charges[0];
      assert.ok(charge);

      // Pay the charge in full
      await roomFeeService.recordPayment({
        chargeId: charge.chargeId,
        amountPaise: 280000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });

      // Verify checkout review reports ₹0 dues initially
      const reviewBefore = await stayService.getCheckoutReview(stay.stayId);
      assert.equal(reviewBefore.isEligibleForNoDues, true);
      assert.equal(reviewBefore.totalOutstandingPayablePaise, 0);

      await assertConcurrentMutationInvalidatesCheckout({
        stayId: stay.stayId,
        mutation: () => roomFeeService.adjustCharge({
          chargeId: charge.chargeId,
          amountPaise: 50000,
          reason: 'Late electricity surcharges',
          actorRole: 'superadmin',
        }),
        verifyRejectedMutation: async () => {
          const unchanged = await RoomCharge.findOne({ chargeId: charge.chargeId }).lean();
          assert.equal(unchanged.adjustments.length, 0);
        },
      });
    });

    it('Checkout No-Dues consistency under concurrent Expense creation', async () => {
      const room = await ensureRoom('207-expense-create', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });

      assert.equal((await stayService.getCheckoutReview(stay.stayId)).isEligibleForNoDues, true);
      await assertConcurrentMutationInvalidatesCheckout({
        stayId: stay.stayId,
        mutation: () => expenseService.createExpense({
          date: '2026-10-10',
          title: 'Late shared utility',
          category: 'utilities',
          amountPaise: 50000,
          paidByMemberId: 'nikhil',
          splitType: 'equal',
          participants: ['gaurav'],
          actorRole: 'admin',
          actorMemberId: 'gaurav',
        }),
        verifyRejectedMutation: async () => {
          assert.equal(await Expense.countDocuments({ title: 'Late shared utility' }), 0);
        },
      });
    });

    it('Checkout No-Dues consistency under a concurrent meal participation change', async () => {
      const room = await ensureRoom('207-meal-change', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });

      assert.equal((await stayService.getCheckoutReview(stay.stayId)).isEligibleForNoDues, true);
      await assertConcurrentMutationInvalidatesCheckout({
        stayId: stay.stayId,
        mutation: () => mealService.changeStatus({
          date: '2026-10-10',
          mealType: 'morning',
          memberId: 'gaurav',
          status: 'taking',
          actorRole: 'admin',
          actorMemberId: 'gaurav',
        }),
        verifyRejectedMutation: async () => {
          const day = await MealDay.findOne({ date: '2026-10-10' }).lean();
          assert.notEqual(day?.meals?.morning?.gaurav, 'taking');
        },
      });
    });

    it('Checkout No-Dues consistency under concurrent room-charge issuance', async () => {
      const room = await ensureRoom('207-charge-issue', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        amountPaise: 280000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });

      assert.equal((await stayService.getCheckoutReview(stay.stayId)).isEligibleForNoDues, true);
      await assertConcurrentMutationInvalidatesCheckout({
        stayId: stay.stayId,
        mutation: () => roomFeeService.issueCharges('2026-10', 'admin'),
        verifyRejectedMutation: async () => {
          assert.equal(await RoomCharge.countDocuments({ memberId: 'gaurav', month: '2026-10' }), 0);
        },
      });
    });

    it('Checkout No-Dues consistency under a concurrent room-payment void', async () => {
      const room = await ensureRoom('207-payment-void', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        amountPaise: 280000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      const { charges } = await roomFeeService.issueCharges('2026-10', 'admin');
      const payment = await roomFeeService.recordPayment({
        chargeId: charges[0].chargeId,
        amountPaise: 280000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });

      assert.equal((await stayService.getCheckoutReview(stay.stayId)).isEligibleForNoDues, true);
      await assertConcurrentMutationInvalidatesCheckout({
        stayId: stay.stayId,
        mutation: () => roomFeeService.voidPayment({
          roomPaymentId: payment.roomPaymentId,
          reason: 'Payment was recorded against the wrong receipt',
          actorRole: 'superadmin',
        }),
        verifyRejectedMutation: async () => {
          const unchanged = await RoomPayment.findOne({ roomPaymentId: payment.roomPaymentId }).lean();
          assert.equal(unchanged.status, 'verified');
        },
      });
    });

    it('Checkout No-Dues consistency under a concurrent mess-payment void', async () => {
      const room = await ensureRoom('207-mess', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });
      await MonthlyMealRate.create({
        month: '2026-10',
        morningPricePaise: 10000,
        nightPricePaise: 0,
      });
      await MealDay.create({
        date: '2026-10-10',
        meals: {
          morning: { gaurav: 'taking', nikhil: 'skip', devansh: 'skip' },
          night: { gaurav: 'skip', nikhil: 'skip', devansh: 'skip' },
        },
      });
      const payment = await Payment.create({
        paymentId: randomUUID(),
        month: '2026-10',
        memberId: 'gaurav',
        amountPaise: 10000,
        method: 'upi',
        upiReference: null,
        billAmountAtPaymentPaise: 10000,
        periodTypeAtPayment: 'past',
        payeeSnapshot: { receiverName: 'Hostel Admin', upiId: null, receiverMobile: null },
        recordedAt: new Date('2026-10-10T12:00:00.000Z'),
        recordedByRole: 'admin',
        recordedByMemberId: null,
        idempotencyKey: randomUUID(),
        status: 'recorded',
      });

      assert.equal((await stayService.getCheckoutReview(stay.stayId)).isEligibleForNoDues, true);
      await assertConcurrentMutationInvalidatesCheckout({
        stayId: stay.stayId,
        mutation: () => paymentRepository.voidIfRecorded({
          paymentId: payment.paymentId,
          voidedAt: new Date('2026-10-20T12:00:00.000Z'),
          voidedByRole: 'superadmin',
          voidReason: 'UPI transfer was reversed',
        }),
        verifyRejectedMutation: async () => {
          const unchanged = await Payment.findOne({ paymentId: payment.paymentId }).lean();
          assert.equal(unchanged.status, 'recorded');
        },
      });
    });

    it('Checkout No-Dues consistency under a concurrent financial expense correction', async () => {
      const room = await ensureRoom('207-expense', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });
      const expense = await expenseService.createExpense({
        date: '2026-10-10',
        title: 'Member-paid supplies',
        category: 'groceries',
        amountPaise: 10000,
        paidByMemberId: 'gaurav',
        splitType: 'equal',
        participants: ['gaurav'],
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });

      assert.equal((await stayService.getCheckoutReview(stay.stayId)).isEligibleForNoDues, true);
      await assertConcurrentMutationInvalidatesCheckout({
        stayId: stay.stayId,
        mutation: () => expenseService.correctExpense(expense.expenseId, {
          reason: 'Correct the member who paid',
          changes: { paidByMemberId: 'nikhil' },
          expectedRevision: expense.revision,
          actorRole: 'superadmin',
        }),
        verifyRejectedMutation: async () => {
          const unchanged = await Expense.findOne({ expenseId: expense.expenseId }).lean();
          assert.equal(unchanged.paidByMemberId, 'gaurav');
          assert.equal(unchanged.corrections.length, 0);
        },
      });
    });

    it('Checkout snapshot consistency under a concurrent deposit refund', async () => {
      const room = await ensureRoom('207-deposit-refund', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        expectedDepositPaise: 10000,
        actorRole: 'admin',
      });
      await depositService.recordDepositReceipt({
        stayId: stay.stayId,
        amountPaise: 10000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });

      const {
        checkoutService,
        transactionalReviewReached,
        releaseTransactionalReview,
      } = createGatedCheckoutService();
      const checkoutPromise = checkoutService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        allowWithDues: true,
        exceptionReason: 'Deposit settlement is being completed',
        actorRole: 'superadmin',
      });
      await transactionalReviewReached;
      const refundPromise = depositService.recordDepositRefund({
        stayId: stay.stayId,
        amountPaise: 10000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });
      releaseTransactionalReview();

      const [checkoutResult, refundResult] = await Promise.allSettled([checkoutPromise, refundPromise]);
      if (checkoutResult.status === 'rejected') {
        assert.equal(checkoutResult.reason.statusCode, 409);
        assert.equal(refundResult.status, 'fulfilled');
        assert.equal(await HostelClearance.countDocuments({ stayId: stay.stayId }), 0);
      } else {
        assert.equal(checkoutResult.value.clearance.clearanceStatus, 'OUTSTANDING_DUES');
        assert.equal(refundResult.status, 'rejected');
        assert.equal(refundResult.reason.statusCode, 409);
        assert.equal(refundResult.reason.details?.code, 'CLEARANCE_REVIEW_REQUIRED');
        assert.equal(await HostelDepositTransaction.countDocuments({
          stayId: stay.stayId,
          type: 'REFUNDED',
          status: 'recorded',
        }), 0);
        assert.equal(await HostelClearance.countDocuments({ stayId: stay.stayId }), 1);
      }
    });

    it('Checkout No-Dues consistency under a concurrent reimbursement void', async () => {
      const room = await ensureRoom('207-reimb', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });
      const expense = await expenseService.createExpense({
        date: '2026-10-10',
        title: 'Shared supplies',
        category: 'groceries',
        amountPaise: 10000,
        paidByMemberId: 'nikhil',
        splitType: 'equal',
        participants: ['gaurav'],
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });
      const reimbursement = await expenseService.recordReimbursement({
        expenseId: expense.expenseId,
        fromMemberId: 'gaurav',
        amountPaise: 10000,
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
        actorMemberId: 'gaurav',
      });

      assert.equal((await stayService.getCheckoutReview(stay.stayId)).isEligibleForNoDues, true);
      await assertConcurrentMutationInvalidatesCheckout({
        stayId: stay.stayId,
        mutation: () => expenseService.voidReimbursement(reimbursement.reimbursementId, {
          reason: 'Bank transfer was reversed',
          actorRole: 'superadmin',
        }),
        verifyRejectedMutation: async () => {
          const unchanged = await ExpenseReimbursement.findOne({
            reimbursementId: reimbursement.reimbursementId,
          }).lean();
          assert.equal(unchanged.status, 'recorded');
        },
      });
    });

    it('Completed-Stay corrections require an audited Super Admin review and immutable reissue', async () => {
      const room = await ensureRoom('207-clearance-review', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });
      await roomFeeService.createFeePlan({
        memberId: 'gaurav',
        amountPaise: 280000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      const { charges } = await roomFeeService.issueCharges('2026-10', 'admin');
      const charge = charges.find((item) => item.memberId === 'gaurav');

      const checkout = await stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        isException: true,
        exceptionReason: 'Authorized departure with room dues pending',
        actorRole: 'superadmin',
      });
      assert.equal(checkout.clearance.clearanceStatus, 'OUTSTANDING_DUES');

      await assert.rejects(
        roomFeeService.recordPayment({
          chargeId: charge.chargeId,
          amountPaise: 280000,
          method: 'upi',
          idempotencyKey: randomUUID(),
          actorRole: 'superadmin',
        }),
        (error) => error.statusCode === 409 && error.details?.code === 'CLEARANCE_REVIEW_REQUIRED',
      );

      const reviewStay = await stayService.openClearanceReview({
        stayId: stay.stayId,
        reason: 'Settle the outstanding room charge and issue a fresh clearance',
        actorRole: 'superadmin',
      });
      assert.ok(reviewStay.clearanceReviewOpenedAt);

      const payment = await roomFeeService.recordPayment({
        chargeId: charge.chargeId,
        amountPaise: 280000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'superadmin',
      });

      const reissued = await stayService.reissueClearance({
        stayId: stay.stayId,
        reissueReason: 'Outstanding room charge settled and verified',
        actorRole: 'superadmin',
      });
      assert.equal(reissued.sequence, 2);
      assert.equal(reissued.clearanceStatus, 'NO_DUES');

      const freshStay = await stayRepository.findStayById(stay.stayId);
      assert.equal(freshStay.clearanceReviewOpenedAt, null);
      assert.equal(await HostelClearance.countDocuments({ stayId: stay.stayId }), 2);

      await assert.rejects(
        roomFeeService.voidPayment({
          roomPaymentId: payment.roomPaymentId,
          reason: 'Attempt after the review was closed',
          actorRole: 'superadmin',
        }),
        (error) => error.statusCode === 409 && error.details?.code === 'CLEARANCE_REVIEW_REQUIRED',
      );
    });

    it('Clearance reissue serializes against a concurrent reviewed financial mutation', async () => {
      const room = await ensureRoom('207-reissue-race', 2);
      const stay = await stayService.createStay({
        memberId: 'gaurav',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });
      await stayService.finalizeCheckout({
        stayId: stay.stayId,
        actualLeftOn: '2026-10-20',
        actorRole: 'admin',
      });
      await stayService.openClearanceReview({
        stayId: stay.stayId,
        reason: 'Record a late verified shared expense',
        actorRole: 'superadmin',
      });

      const { reviewService, reviewReached, releaseReview } = createGatedReviewService();
      const reissuePromise = reviewService.reissueClearance({
        stayId: stay.stayId,
        reissueReason: 'Include the late verified shared expense',
        actorRole: 'superadmin',
      });
      await reviewReached;
      const expensePromise = expenseService.createExpense({
        date: '2026-10-10',
        title: 'Late verified utility',
        category: 'utilities',
        amountPaise: 50000,
        paidByMemberId: 'nikhil',
        splitType: 'equal',
        participants: ['gaurav'],
        actorRole: 'superadmin',
        actorMemberId: 'gaurav',
      });
      releaseReview();

      const [reissueResult, expenseResult] = await Promise.allSettled([
        reissuePromise,
        expensePromise,
      ]);
      assert.equal(reissueResult.status, 'fulfilled');
      assert.equal(reissueResult.value.clearanceStatus, 'NO_DUES');
      assert.equal(expenseResult.status, 'rejected');
      assert.equal(expenseResult.reason.statusCode, 409);
      assert.equal(expenseResult.reason.details?.code, 'CLEARANCE_REVIEW_REQUIRED');
      assert.equal(await HostelClearance.countDocuments({ stayId: stay.stayId }), 2);
    });

    it('Same-month dual stays produce strictly isolated statements without cross-contamination', async () => {
      const room = await ensureRoom('208', 2);

      // Stay 1: Oct 1 to Oct 10
      const stay1 = await stayService.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-10-01',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });

      // Expense 1 recorded on 2026-10-05 (during Stay 1)
      const exp1 = await expenseService.createExpense({
        title: 'Stay 1 Breakfast Groceries',
        category: 'groceries',
        amountPaise: 40000,
        paidByMemberId: 'nikhil',
        date: '2026-10-05',
        splitType: 'equal',
        participants: ['nikhil'],
        actorMemberId: 'nikhil',
        actorRole: 'admin',
      });

      await roomFeeService.createFeePlan({
        memberId: 'nikhil',
        amountPaise: 280000,
        effectiveFromMonth: '2026-10',
        actorRole: 'admin',
      });
      const { charges } = await roomFeeService.issueCharges('2026-10', 'admin');
      const roomCharge = charges.find((charge) => charge.memberId === 'nikhil');
      await roomFeeService.recordPayment({
        chargeId: roomCharge.chargeId,
        amountPaise: 280000,
        method: 'upi',
        idempotencyKey: randomUUID(),
        actorRole: 'admin',
      });
      await MonthlyMealRate.create({
        month: '2026-10',
        morningPricePaise: 10000,
        nightPricePaise: 0,
      });
      await MealDay.create({
        date: '2026-10-05',
        meals: {
          morning: { gaurav: 'skip', nikhil: 'taking', devansh: 'skip' },
          night: { gaurav: 'skip', nikhil: 'skip', devansh: 'skip' },
        },
      });
      await Payment.create({
        paymentId: randomUUID(),
        month: '2026-10',
        memberId: 'nikhil',
        amountPaise: 10000,
        method: 'upi',
        upiReference: null,
        billAmountAtPaymentPaise: 10000,
        periodTypeAtPayment: 'past',
        payeeSnapshot: { receiverName: 'Hostel Admin', upiId: null, receiverMobile: null },
        recordedAt: new Date('2026-10-05T12:00:00.000Z'),
        recordedByRole: 'admin',
        recordedByMemberId: null,
        idempotencyKey: randomUUID(),
        status: 'recorded',
      });

      // Checkout Stay 1 on 2026-10-10
      await stayService.finalizeCheckout({
        stayId: stay1.stayId,
        actualLeftOn: '2026-10-10',
        allowWithDues: true,
        exceptionReason: 'Temporary exit',
        actorRole: 'admin',
      });

      // Stay 2: Oct 20 onwards
      const stay2 = await stayService.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-10-20',
        initialRoomId: room.roomId,
        actorRole: 'admin',
      });

      // Expense 2 recorded on 2026-10-25 (during Stay 2)
      const exp2 = await expenseService.createExpense({
        title: 'Stay 2 Dinner Groceries',
        category: 'groceries',
        amountPaise: 70000,
        paidByMemberId: 'nikhil',
        date: '2026-10-25',
        splitType: 'equal',
        participants: ['nikhil'],
        actorMemberId: 'nikhil',
        actorRole: 'admin',
      });

      // Fetch checkout review for Stay 1
      const review1 = await stayService.getCheckoutReview(stay1.stayId);
      // Fetch checkout review for Stay 2
      const review2 = await stayService.getCheckoutReview(stay2.stayId);

      // Verify that Stay 1 tracked spending contains only exp1 (₹400), not exp2 (₹700)
      assert.equal(review1.totalExpenseSharePaise, 40000, 'Stay 1 only accounts for Oct 1-10 spending');
      assert.equal(review2.totalExpenseSharePaise, 70000, 'Stay 2 only accounts for Oct 20+ spending');
      assert.equal(review1.totalMessBilledPaise + review2.totalMessBilledPaise, 0);
      assert.equal(review1.totalRoomBilledPaise + review2.totalRoomBilledPaise, 0);
      const unresolvedMessBill = review1.monthlyOverviews[0].unattributed.mess.billPaise;
      assert.ok(unresolvedMessBill > 0);
      assert.equal(review2.monthlyOverviews[0].unattributed.mess.billPaise, unresolvedMessBill);
      assert.equal(review1.monthlyOverviews[0].unattributed.room.issuedChargePaise, 280000);
      assert.equal(review2.monthlyOverviews[0].unattributed.room.issuedChargePaise, 280000);
      assert.ok(review1.attributionWarnings.some((warning) => warning.domain === 'MESS'));
      assert.ok(review1.attributionWarnings.some((warning) => warning.domain === 'ROOM_FEES'));
      assert.equal(review1.isEligibleForNoDues, false);
      assert.equal(review2.isEligibleForNoDues, false);
    });
  });
});
