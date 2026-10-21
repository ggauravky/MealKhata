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
import { RoomCharge } from '../src/roomFees/roomCharge.model.js';
import { RoomPayment } from '../src/roomFees/roomPayment.model.js';
import { RoomPaymentSettings } from '../src/roomFees/roomPaymentSettings.model.js';
import { Expense } from '../src/expenses/expense.model.js';
import { ExpenseReimbursement } from '../src/expenses/expenseReimbursement.model.js';
import { MealDay } from '../src/meals/meal.model.js';
import { UserAccount } from '../src/auth/userAccount.model.js';
import { MemberAccount } from '../src/auth/memberAccount.model.js';
import { MemberAccountAudit } from '../src/members/memberAccountAudit.model.js';

import { createStayService, stayService } from '../src/stays/stay.service.js';
import { depositService } from '../src/stays/deposit.service.js';
import { roomFeeService } from '../src/roomFees/roomFee.service.js';
import { expenseService } from '../src/expenses/expense.service.js';
import { stayRepository } from '../src/stays/stay.repository.js';
import { roomRepository } from '../src/roomFees/room.repository.js';
import { defaultExpenseRepository } from '../src/expenses/expense.repository.js';
import { computeChargeFinancials } from '../src/roomFees/roomFee.serializer.js';
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
      UserAccount.init(),
      MemberAccount.init(),
      MemberAccountAudit.init(),
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
        actorRole: 'admin',
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
      assert.equal(all[1].sequence, 1);
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

    it('Checkout No-Dues consistency under concurrent financial mutation', async () => {
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

      // Super Admin adjusts the charge to ₹3,300 (creating ₹500 outstanding due)
      await roomFeeService.adjustCharge({
        chargeId: charge.chargeId,
        amountPaise: 50000,
        reason: 'Late electricity surcharges',
        actorRole: 'superadmin',
      });

      // Attempting to finalize checkout with allowWithDues: false MUST fail because dues exist
      await assert.rejects(
        async () => {
          await stayService.finalizeCheckout({
            stayId: stay.stayId,
            actualLeftOn: '2026-10-20',
            allowWithDues: false,
            actorRole: 'admin',
          });
        },
        (err) => err.statusCode === 403 || err.statusCode === 409
      );

      // Clearance is NOT issued
      const clearance = await HostelClearance.findOne({ stayId: stay.stayId }).lean();
      assert.equal(clearance, null, 'No false No-Dues clearance can be issued with outstanding dues');
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
    });
  });
});
