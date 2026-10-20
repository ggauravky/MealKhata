/**
 * MealKhata 2.0 - Hostel Stay Lifecycle Domain Service
 * Manages admission, active stays, room history & transfers, checkout review, and final clearance.
 */

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';
import { isValidLogicalDate, getLogicalDateInTimeZone } from '../utils/date.js';
import { isValidLogicalMonth } from '../utils/month.js';
import { roomFeeService } from '../roomFees/roomFee.service.js';
import { financialOverviewService } from '../finance/financialOverview.service.js';
import { depositService } from './deposit.service.js';
import { stayRepository } from './stay.repository.js';
import { createStayAttributionService, defaultStayAttributionService } from './stayAttribution.service.js';
import {
  CLEARANCE_STATUSES,
  DEPOSIT_ACCOUNT_STATUSES,
  DEPOSIT_HOLDER_TYPES,
  MAX_DEPOSIT_PAISE,
  STAY_STATUSES,
} from './stay.constants.js';

function getMonthsRange(startMonth, endMonth) {
  const months = [];
  let current = startMonth;
  while (current <= endMonth) {
    months.push(current);
    const [yStr, mStr] = current.split('-');
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    current = `${y}-${String(m).padStart(2, '0')}`;
  }
  return months;
}

export class StayDomainError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'StayDomainError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function createStayService({
  repository = stayRepository,
  roomFees = roomFeeService,
  finance = financialOverviewService,
  deposits = depositService,
  stayAttribution = null,
} = {}) {
  const attributionService =
    stayAttribution ||
    createStayAttributionService({
      stayRepo: repository,
      finance,
      deposits,
      roomFees,
    });
  return {
    /**
     * Create a new hostel stay (admission / onboarding)
     */
    async createStay({
      memberId,
      joinedOn,
      expectedLeaveOn = null,
      initialRoomId,
      monthlyFeePaise: rawMonthlyFee = null,
      monthlyRatePaise = null,
      expectedDepositPaise = 0,
      actorRole,
    }) {
      const monthlyFeePaise = rawMonthlyFee ?? monthlyRatePaise ?? null;
      if (!MEMBER_IDS.includes(memberId)) {
        throw new StayDomainError(`Invalid member ID: ${memberId}`, 400);
      }
      if (!joinedOn || !isValidLogicalDate(joinedOn)) {
        throw new StayDomainError('Valid joining date in YYYY-MM-DD format is required.', 400);
      }
      if (expectedLeaveOn && !isValidLogicalDate(expectedLeaveOn)) {
        throw new StayDomainError('Expected leave date must be in YYYY-MM-DD format.', 400);
      }
      if (expectedLeaveOn && expectedLeaveOn < joinedOn) {
        throw new StayDomainError('Expected leave date cannot be earlier than joining date.', 400);
      }
      if (!initialRoomId || !initialRoomId.trim()) {
        throw new StayDomainError('Initial room is required.', 400);
      }
      if (
        expectedDepositPaise !== undefined &&
        expectedDepositPaise !== null &&
        (!Number.isInteger(expectedDepositPaise) || expectedDepositPaise < 0 || expectedDepositPaise > MAX_DEPOSIT_PAISE)
      ) {
        throw new StayDomainError('Invalid expected security deposit amount.', 400);
      }
      if (monthlyFeePaise !== null && monthlyFeePaise !== undefined) {
        if (!Number.isInteger(monthlyFeePaise) || monthlyFeePaise <= 0) {
          throw new StayDomainError('Monthly fee must be a positive integer in paise.', 400);
        }
      }

      // Invariant: At most ONE active or pending stay per member!
      const activeStay = await repository.findActiveStayForMember(memberId);
      if (activeStay) {
        throw new StayDomainError(
          `Member ${memberId} already has an active or pending hostel stay (${activeStay.stayId}).`,
          409,
          { activeStayId: activeStay.stayId },
        );
      }

      const joinMonth = joinedOn.slice(0, 7);
      const stayId = randomUUID();
      const depositAccountId = randomUUID();

      let createdAssignment = null;
      let createdStay = null;
      let createdDepositAccount = null;
      let createdFeePlan = null;
      let session = null;

      if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
          session = await mongoose.startSession();
          session.startTransaction();
        } catch (_err) {
          session = null;
        }
      }

      try {
        if (roomFees && typeof roomFees.assignMemberToRoom === 'function') {
          createdAssignment = await roomFees.assignMemberToRoom({
            roomId: initialRoomId.trim(),
            memberId,
            effectiveFromMonth: joinMonth,
            effectiveFromDate: joinedOn,
            actorRole,
            isAdmission: true,
            session,
          });
        }

        createdStay = await repository.createStay({
          stayId,
          memberId,
          joinedOn,
          expectedLeaveOn: expectedLeaveOn || null,
          actualLeftOn: null,
          status: STAY_STATUSES.ACTIVE,
          initialRoomId: initialRoomId.trim(),
          currentRoomId: initialRoomId.trim(),
          history: [
            {
              event: 'STAY_CREATED',
              timestamp: new Date(),
              actorRole,
              note: `Hostel stay created from ${joinedOn} in Room ${initialRoomId}`,
              details: { initialRoomId, monthlyFeePaise, expectedDepositPaise: expectedDepositPaise || 0 },
            },
          ],
        }, { session });

        createdDepositAccount = await repository.createDepositAccount({
          depositAccountId,
          stayId,
          memberId,
          expectedDepositPaise: expectedDepositPaise || 0,
          holderType: DEPOSIT_HOLDER_TYPES.ADMIN_COLLECTOR,
          holderName: 'Hostel Administration',
          status: DEPOSIT_ACCOUNT_STATUSES.OPEN,
          history: [
            {
              event: 'DEPOSIT_ACCOUNT_OPENED',
              timestamp: new Date(),
              actorRole,
              note: `Deposit account initialized for stay ${stayId}`,
              details: { expectedDepositPaise: expectedDepositPaise || 0 },
            },
          ],
        }, { session });

        if (monthlyFeePaise && roomFees && typeof roomFees.createFeePlan === 'function') {
          createdFeePlan = await roomFees.createFeePlan({
            memberId,
            effectiveFromMonth: joinMonth,
            amountPaise: monthlyFeePaise,
            reason: `Initial fee plan on admission in Room ${initialRoomId}`,
            actorRole,
            isAdmission: true,
            session,
          });
        }

        if (session) {
          await session.commitTransaction();
        }

        return createdStay;
      } catch (err) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        if (!session) {
          // Rollback all created entities on in-memory / non-transactional test environments
          if (createdFeePlan?.feePlanId && typeof roomFees?.deleteFeePlan === 'function') {
            try { await roomFees.deleteFeePlan(createdFeePlan.feePlanId); } catch (_err) { /* rollback best-effort */ }
          }
          if (createdDepositAccount && typeof repository?.deleteDepositAccount === 'function') {
            try { await repository.deleteDepositAccount(depositAccountId); } catch (_err) { /* rollback best-effort */ }
          }
          if (createdStay && typeof repository?.deleteStay === 'function') {
            try { await repository.deleteStay(stayId); } catch (_err) { /* rollback best-effort */ }
          }
          if (createdAssignment?.assignmentId && typeof roomFees?.deleteAssignment === 'function') {
            try { await roomFees.deleteAssignment(createdAssignment.assignmentId, 'superadmin'); } catch (_err) { /* rollback best-effort */ }
          }
        }
        if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
          throw new StayDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
        }
        throw err;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    },

    /**
     * Get stay by ID
     */
    async getStayById(stayId) {
      const stay = await repository.findStayById(stayId);
      if (!stay) {
        throw new StayDomainError('Hostel stay not found.', 404);
      }
      return stay;
    },

    /**
     * Get active stay for a specific member
     */
    async getActiveStayForMember(memberId) {
      return repository.findActiveStayForMember(memberId);
    },

    /**
     * List all stays
     */
    async listStays({ status = null, memberId = null } = {}) {
      return repository.listAllStays({ status, memberId });
    },

    /**
     * List stays for a specific member
     */
    async listStaysForMember(memberId) {
      return repository.findStaysByMember(memberId);
    },

    /**
     * Member requests checkout
     */
    async requestCheckout({
      stayId,
      memberId,
      actorMemberId,
      actorRole = 'member',
      preferredDate,
      preferredLeaveDate,
      reason,
      note = null,
    }) {
      const stay = await this.getStayById(stayId);
      const targetMemberId = memberId || actorMemberId || (actorRole !== 'member' ? stay.memberId : null);
      if (stay.memberId !== targetMemberId && actorRole === 'member') {
        throw new StayDomainError('You cannot request checkout for another member.', 403);
      }
      if (stay.status !== STAY_STATUSES.ACTIVE) {
        throw new StayDomainError(`Cannot request checkout when stay status is ${stay.status}.`, 400);
      }
      const leaveDate = preferredLeaveDate || preferredDate;
      if (!leaveDate || !isValidLogicalDate(leaveDate)) {
        throw new StayDomainError('Valid departure date in YYYY-MM-DD format is required.', 400);
      }
      if (leaveDate < stay.joinedOn) {
        throw new StayDomainError('Preferred departure date cannot precede joining date.', 400);
      }

      const requestNote = (reason || note)?.trim() || null;

      const updated = await repository.updateStay(
        stayId,
        {
          status: STAY_STATUSES.CHECKOUT_REQUESTED,
          checkoutRequestedAt: new Date(),
          checkoutRequestedFor: leaveDate,
          checkoutRequestNote: requestNote,
        },
        stay.revision,
      );

      if (!updated) {
        throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
      }

      await repository.addStayHistory(stayId, {
        event: 'CHECKOUT_REQUESTED',
        timestamp: new Date(),
        actorRole,
        actorMemberId: targetMemberId,
        note: `Checkout requested for ${leaveDate}${requestNote ? `: ${requestNote}` : ''}`,
      });

      return updated;
    },

    /**
     * Member or Admin cancels pending checkout request
     */
    async cancelCheckoutRequest({
      stayId,
      memberId,
      actorMemberId,
      actorRole = 'member',
      reason = null,
    }) {
      const stay = await this.getStayById(stayId);
      const targetMemberId = memberId || actorMemberId || (actorRole !== 'member' ? stay.memberId : null);
      if (stay.memberId !== targetMemberId && actorRole === 'member') {
        throw new StayDomainError('You cannot cancel another member’s checkout request.', 403);
      }
      if (stay.status !== STAY_STATUSES.CHECKOUT_REQUESTED && stay.status !== STAY_STATUSES.CHECKOUT_PENDING) {
        throw new StayDomainError('No pending checkout request to cancel.', 400);
      }

      const updated = await repository.updateStay(
        stayId,
        {
          status: STAY_STATUSES.ACTIVE,
          checkoutRequestedAt: null,
          checkoutRequestedFor: null,
          checkoutRequestNote: null,
        },
        stay.revision,
      );

      if (!updated) {
        throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
      }

      await repository.addStayHistory(stayId, {
        event: 'CHECKOUT_REQUEST_CANCELLED',
        timestamp: new Date(),
        actorRole,
        actorMemberId: targetMemberId,
        note: reason ? `Checkout request cancelled: ${reason}` : 'Checkout request cancelled',
      });

      return updated;
    },

    /**
     * Transfer member between rooms
     */
    async transferRoom({
      stayId,
      newRoomId,
      effectiveDate,
      newMonthlyRatePaise = null,
      monthlyFeePaise = null,
      reason = null,
      actorRole,
    }) {
      const finalMonthlyRate = monthlyFeePaise ?? newMonthlyRatePaise ?? null;
      if (actorRole !== 'admin' && actorRole !== 'superadmin') {
        throw new StayDomainError('Only administrators can perform room transfers.', 403);
      }
      const stay = await this.getStayById(stayId);
      if (stay.status === STAY_STATUSES.CHECKED_OUT) {
        throw new StayDomainError('Cannot transfer a member who is already checked out.', 400);
      }
      if (!newRoomId || !newRoomId.trim()) {
        throw new StayDomainError('Destination room ID required.', 400);
      }
      if (stay.currentRoomId === newRoomId.trim()) {
        throw new StayDomainError('Member is already assigned to this room.', 400);
      }
      if (!effectiveDate || !isValidLogicalDate(effectiveDate)) {
        throw new StayDomainError('Effective transfer date in YYYY-MM-DD format is required.', 400);
      }
      if (effectiveDate < stay.joinedOn) {
        throw new StayDomainError('Transfer date cannot precede admission date.', 400);
      }
      if (finalMonthlyRate !== null && (!Number.isInteger(finalMonthlyRate) || finalMonthlyRate <= 0)) {
        throw new StayDomainError('Monthly fee must be a positive integer in paise.', 400);
      }

      const transferMonth = effectiveDate.slice(0, 7);
      const oldRoomId = stay.currentRoomId || stay.initialRoomId;

      let newAssignment = null;
      let newPlan = null;
      let session = null;
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
          session = await mongoose.startSession();
          session.startTransaction();
        } catch (_err) {
          session = null;
        }
      }

      try {
        // 1. Assign to new room via roomFeeService (which validates capacity and closes old assignment)
        newAssignment = await roomFees.assignMemberToRoom({
          roomId: newRoomId.trim(),
          memberId: stay.memberId,
          effectiveFromMonth: transferMonth,
          effectiveFromDate: effectiveDate,
          actorRole,
          session,
        });

        // 2. Update fee plan if provided
        if (Number.isInteger(finalMonthlyRate) && finalMonthlyRate > 0) {
          newPlan = await roomFees.createFeePlan({
            memberId: stay.memberId,
            effectiveFromMonth: transferMonth,
            amountPaise: finalMonthlyRate,
            reason: `Updated rate upon room transfer from Room ${oldRoomId} to ${newRoomId}`,
            actorRole,
            session,
          });
        }

        // 3. Update stay currentRoomId
        const updated = await repository.updateStay(
          stayId,
          {
            currentRoomId: newRoomId.trim(),
          },
          stay.revision,
          { session },
        );

        if (!updated) {
          throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
        }

        await repository.addStayHistory(stayId, {
          event: 'ROOM_TRANSFERRED',
          timestamp: new Date(),
          actorRole,
          note: `Transferred from Room ${oldRoomId} to Room ${newRoomId} effective ${effectiveDate}${reason ? `: ${reason}` : ''}`,
          details: { oldRoomId, newRoomId, effectiveDate, newMonthlyRatePaise: finalMonthlyRate },
        }, { session });

        if (session) {
          await session.commitTransaction();
        }

        return updated;
      } catch (err) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        if (!session) {
          // Rollback any partial updates on in-memory environments
          if (newPlan?.feePlanId && typeof roomFees?.deleteFeePlan === 'function') {
            try { await roomFees.deleteFeePlan(newPlan.feePlanId); } catch (_err) { /* rollback best-effort */ }
          }
          if (newAssignment?.assignmentId && typeof roomFees?.deleteAssignment === 'function') {
            try { await roomFees.deleteAssignment(newAssignment.assignmentId, 'superadmin'); } catch (_err) { /* rollback best-effort */ }
          }
        }
        if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
          throw new StayDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
        }
        throw err;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    },

    /**
     * Initiate checkout review (transitions CHECKOUT_REQUESTED -> CHECKOUT_PENDING)
     */
    async initiateCheckoutReview({ stayId, actorRole }) {
      if (actorRole !== 'admin' && actorRole !== 'superadmin') {
        throw new StayDomainError('Only administrators can initiate checkout review.', 403);
      }
      const stay = await this.getStayById(stayId);
      if (stay.status !== STAY_STATUSES.CHECKOUT_REQUESTED && stay.status !== STAY_STATUSES.ACTIVE) {
        throw new StayDomainError(`Cannot initiate checkout review from status: ${stay.status}`, 400);
      }

      const updated = await repository.updateStay(
        stayId,
        {
          status: STAY_STATUSES.CHECKOUT_PENDING,
          checkoutReviewInitiatedAt: new Date(),
          checkoutReviewInitiatedByRole: actorRole,
        },
        stay.revision,
      );

      if (!updated) {
        throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
      }

      await repository.addStayHistory(stayId, {
        event: 'CHECKOUT_REVIEW_INITIATED',
        timestamp: new Date(),
        actorRole,
        note: `Checkout review initiated by ${actorRole}`,
        details: { previousStatus: stay.status, newStatus: STAY_STATUSES.CHECKOUT_PENDING },
      });

      return updated;
    },

    /**
     * Get room assignment timeline for a stay
     */
    async getStayRoomHistory(stayId) {
      const stay = await this.getStayById(stayId);
      const assignments = await roomFees.getAssignmentsForMember(stay.memberId);
      const joinMonth = stay.joinedOn.slice(0, 7);
      const exitMonth = stay.actualLeftOn ? stay.actualLeftOn.slice(0, 7) : null;

      const timeline = assignments
        .filter((a) => {
          if (exitMonth && a.effectiveFromMonth > exitMonth) return false;
          if (a.effectiveUntilMonth && a.effectiveUntilMonth < joinMonth) return false;
          return true;
        })
        .sort((a, b) => a.effectiveFromMonth.localeCompare(b.effectiveFromMonth));

      return {
        stayId,
        memberId: stay.memberId,
        currentRoomId: stay.currentRoomId,
        timeline,
      };
    },

    /**
     * Get 5-step Checkout Review data across all attributable stay months using canonical Stay Attribution
     */
    async getCheckoutReview(stayId, { session = null, actorRole = 'admin' } = {}) {
      const stay = await this.getStayById(stayId);
      const memberId = stay.memberId;
      const currentMonth = getLogicalDateInTimeZone(new Date(), 'Asia/Kolkata').slice(0, 7);

      const attr = await attributionService.getStayAttributedFinances({
        stayId,
        session,
        actorRole,
      });

      const currentOverview =
        attr.monthlySummaries.find((m) => m.month === currentMonth) ||
        attr.monthlySummaries[attr.monthlySummaries.length - 1] ||
        null;

      return {
        stay,
        financialOverview: {
          month: currentOverview?.month || currentMonth,
          mess: {
            billPaise: attr.totalMessBilledPaise,
            paidPaise: attr.totalMessPaidPaise,
            remainingPaise: attr.totalMessRemainingPaise,
          },
          room: {
            issuedChargePaise: attr.totalRoomBilledPaise,
            paidPaise: attr.totalRoomPaidPaise,
            remainingPaise: attr.totalRoomRemainingPaise,
          },
          expenses: {
            spendingSharePaise: attr.totalExpenseSharePaise,
            owedToOthersPaise: attr.totalExpenseOwedPaise,
            owedToMePaise: attr.totalExpenseReceivablePaise,
            debtsOwed: currentOverview?.expenses?.debtsOwed || [],
            receivables: currentOverview?.expenses?.receivables || [],
          },
          combined: {
            outstandingPayablePaise: attr.totalOutstandingPayablePaise,
          },
        },
        monthlyOverviews: attr.monthlySummaries,
        totalMessBilledPaise: attr.totalMessBilledPaise,
        totalMessPaidPaise: attr.totalMessPaidPaise,
        totalMessRemainingPaise: attr.totalMessRemainingPaise,
        totalRoomBilledPaise: attr.totalRoomBilledPaise,
        totalRoomPaidPaise: attr.totalRoomPaidPaise,
        totalRoomRemainingPaise: attr.totalRoomRemainingPaise,
        totalExpenseSharePaise: attr.totalExpenseSharePaise,
        totalExpenseOwedPaise: attr.totalExpenseOwedPaise,
        totalExpenseReceivablePaise: attr.totalExpenseReceivablePaise,
        depositOverview: attr.depositOverview,
        outstandingObligations: attr.outstandingObligations,
        totalOutstandingPayablePaise: attr.totalOutstandingPayablePaise,
        depositHeldPaise: attr.depositHeldPaise,
        isEligibleForNoDues: attr.isEligibleForNoDues,
      };
    },

    /**
     * Finalize checkout and issue clearance snapshot
     */
    async finalizeCheckout({
      stayId,
      actualLeftOn,
      isException = false,
      allowWithDues = false,
      exceptionReason = null,
      actorRole,
    }) {
      const stay = await this.getStayById(stayId);
      if (stay.status === STAY_STATUSES.CHECKED_OUT) {
        throw new StayDomainError('Stay has already been checked out.', 400);
      }
      if (!actualLeftOn || !isValidLogicalDate(actualLeftOn)) {
        throw new StayDomainError('Valid departure date in YYYY-MM-DD format is required.', 400);
      }
      if (actualLeftOn < stay.joinedOn) {
        throw new StayDomainError('Departure date cannot precede joining date.', 400);
      }

      const explicitException = Boolean(isException || allowWithDues);

      // Pre-review stay-wide obligations
      const initialReview = await this.getCheckoutReview(stayId);

      // If obligations or unrefunded deposit remain, only Super Admin can override
      let clearanceStatus = CLEARANCE_STATUSES.NO_DUES;
      if (!initialReview.isEligibleForNoDues) {
        if (actorRole !== 'superadmin') {
          throw new StayDomainError(
            'Cannot finalize checkout with pending dues or unrefunded deposit. Super Admin approval required.',
            403,
            { totalOutstandingPayablePaise: initialReview.totalOutstandingPayablePaise },
          );
        }
        if (!explicitException) {
          throw new StayDomainError(
            'Departure with unresolved obligations requires explicit exception authorization (isException: true).',
            400,
          );
        }
        if (!exceptionReason || !exceptionReason.trim()) {
          throw new StayDomainError(
            'Mandatory reason is required when finalizing departure with unresolved obligations.',
            400,
          );
        }
        clearanceStatus = CLEARANCE_STATUSES.OUTSTANDING_DUES;
      }

      let session = null;
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
          session = await mongoose.startSession();
          session.startTransaction();
        } catch (_err) {
          session = null;
        }
      }

      try {
        // Concurrency guard: verify fresh stay status inside session
        const freshStay = await repository.findStayById(stayId, { session });
        if (!freshStay || freshStay.status === STAY_STATUSES.CHECKED_OUT) {
          throw new StayDomainError('Stay has already been checked out.', 409);
        }
        if (freshStay.revision !== stay.revision) {
          throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
        }

        // Re-evaluate review inside transaction session to ensure no concurrent financial adjustments occurred!
        const review = await this.getCheckoutReview(stayId, { session, actorRole });
        if (!review.isEligibleForNoDues && !explicitException) {
          throw new StayDomainError(
            'Outstanding dues or unrefunded deposits exist across the stay duration. Settle all obligations or provide exceptional checkout authorization.',
            400,
            { totalOutstandingPayablePaise: review.totalOutstandingPayablePaise },
          );
        }
        if (!review.isEligibleForNoDues) {
          clearanceStatus = CLEARANCE_STATUSES.OUTSTANDING_DUES;
        }

        // 1. End active room assignment and release capacity with exact departure date
        await roomFees.endActiveRoomAssignment({
          memberId: stay.memberId,
          endDate: actualLeftOn,
          endMonth: actualLeftOn.slice(0, 7),
          session,
        });

        // 2. Safely allocate clearance sequence
        const sequence = await repository.getNextClearanceSequence(stayId, { session });
        const clearanceId = randomUUID();

        // 3. Transition Stay to CHECKED_OUT with revision guard
        const updatedStay = await repository.updateStay(
          stayId,
          {
            status: STAY_STATUSES.CHECKED_OUT,
            actualLeftOn,
            checkoutFinalizedAt: new Date(),
            checkoutFinalizedByRole: actorRole,
          },
          freshStay.revision,
          { session },
        );

        if (!updatedStay) {
          throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
        }

        // 4. Create Immutable Clearance Snapshot
        const clearance = await repository.createClearance({
          clearanceId,
          stayId,
          memberId: stay.memberId,
          sequence,
          snapshotVersion: sequence,
          joinedOn: stay.joinedOn,
          actualLeftOn,
          lastRoomId: stay.currentRoomId || stay.initialRoomId,
          financialAsOf: new Date(),
          messSummary: {
            billPaise: review.totalMessBilledPaise ?? review.financialOverview.mess.billPaise,
            paidPaise: review.totalMessPaidPaise ?? review.financialOverview.mess.paidPaise,
            remainingPaise: review.totalMessRemainingPaise ?? review.financialOverview.mess.remainingPaise,
          },
          roomFeeSummary: {
            issuedChargePaise: review.totalRoomBilledPaise ?? review.financialOverview.room.issuedChargePaise,
            paidPaise: review.totalRoomPaidPaise ?? review.financialOverview.room.paidPaise,
            remainingPaise: review.totalRoomRemainingPaise ?? review.financialOverview.room.remainingPaise,
          },
          expenseSummary: {
            spendingSharePaise: review.totalExpenseSharePaise ?? review.financialOverview.expenses.spendingSharePaise,
            owedToOthersPaise: review.totalExpenseOwedPaise ?? review.financialOverview.expenses.owedToOthersPaise,
            owedToMePaise: review.totalExpenseReceivablePaise ?? review.financialOverview.expenses.owedToMePaise,
          },
          depositSummary: review.depositOverview.summary,
          outstandingObligations: review.outstandingObligations,
          clearanceStatus,
          exceptionReason: exceptionReason?.trim() || null,
          finalizedAt: new Date(),
          finalizedByRole: actorRole,
        }, { session });

        // 5. Audit trail
        await repository.addStayHistory(stayId, {
          event: 'CHECKOUT_FINALIZED',
          timestamp: new Date(),
          actorRole,
          note: `Stay finalized as ${clearanceStatus} on ${actualLeftOn}${exceptionReason ? `: ${exceptionReason}` : ''}`,
          details: { clearanceId, sequence, clearanceStatus },
        }, { session });

        if (session) {
          await session.commitTransaction();
        }

        return {
          stay: updatedStay,
          clearance,
        };
      } catch (err) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
          throw new StayDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
        }
        throw err;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    },

    /**
     * Reissue clearance certificate with fresh snapshot (Super Admin only)
     */
    async reissueClearance({ stayId, reissueReason, actorRole }) {
      if (actorRole !== 'superadmin') {
        throw new StayDomainError('Only Super Admin can reissue clearance certificates.', 403);
      }
      if (!reissueReason || !reissueReason.trim()) {
        throw new StayDomainError('Mandatory reissue reason is required.', 400);
      }

      const stay = await this.getStayById(stayId);
      if (stay.status !== STAY_STATUSES.CHECKED_OUT) {
        throw new StayDomainError('Clearance can only be reissued for a checked-out stay.', 400);
      }

      const review = await this.getCheckoutReview(stayId);
      let clearanceStatus = CLEARANCE_STATUSES.NO_DUES;
      if (!review.isEligibleForNoDues) {
        clearanceStatus = CLEARANCE_STATUSES.OUTSTANDING_DUES;
      }

      const maxRetries = 5;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let session = null;
        if (mongoose.connection && mongoose.connection.readyState === 1) {
          try {
            session = await mongoose.startSession();
            session.startTransaction();
          } catch (_err) {
            session = null;
          }
        }

        try {
          const sequence = await repository.getNextClearanceSequence(stayId, { session });
          const clearanceId = randomUUID();

          const clearance = await repository.createClearance({
            clearanceId,
            stayId,
            memberId: stay.memberId,
            sequence,
            snapshotVersion: sequence,
            joinedOn: stay.joinedOn,
            actualLeftOn: stay.actualLeftOn,
            lastRoomId: stay.currentRoomId || stay.initialRoomId,
            financialAsOf: new Date(),
            messSummary: {
              billPaise: review.totalMessBilledPaise ?? review.financialOverview.mess.billPaise,
              paidPaise: review.totalMessPaidPaise ?? review.financialOverview.mess.paidPaise,
              remainingPaise: review.totalMessRemainingPaise ?? review.financialOverview.mess.remainingPaise,
            },
            roomFeeSummary: {
              issuedChargePaise: review.totalRoomBilledPaise ?? review.financialOverview.room.issuedChargePaise,
              paidPaise: review.totalRoomPaidPaise ?? review.financialOverview.room.paidPaise,
              remainingPaise: review.totalRoomRemainingPaise ?? review.financialOverview.room.remainingPaise,
            },
            expenseSummary: {
              spendingSharePaise: review.totalExpenseSharePaise ?? review.financialOverview.expenses.spendingSharePaise,
              owedToOthersPaise: review.totalExpenseOwedPaise ?? review.financialOverview.expenses.owedToOthersPaise,
              owedToMePaise: review.totalExpenseReceivablePaise ?? review.financialOverview.expenses.owedToMePaise,
            },
            depositSummary: review.depositOverview.summary,
            outstandingObligations: review.outstandingObligations,
            clearanceStatus,
            exceptionReason: reissueReason.trim(),
            finalizedAt: new Date(),
            finalizedByRole: actorRole,
          }, { session });

          await repository.addStayHistory(stayId, {
            event: 'CLEARANCE_REISSUED',
            timestamp: new Date(),
            actorRole,
            note: `Clearance #${sequence} reissued: ${reissueReason.trim()}`,
            details: { clearanceId, sequence, clearanceStatus, reissueReason: reissueReason.trim() },
          }, { session });

          if (session) {
            await session.commitTransaction();
          }

          return clearance;
        } catch (err) {
          if (session && session.inTransaction()) {
            await session.abortTransaction();
          }
          const isTransient =
            err.errorLabels?.has?.('TransientTransactionError') ||
            err.errorLabelSet?.has?.('TransientTransactionError') ||
            err.code === 112 ||
            err.code === 11000 ||
            (typeof err.message === 'string' && (err.message.includes('WriteConflict') || err.message.includes('duplicate key')));

          if (isTransient && attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            continue;
          }

          if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
            throw new StayDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
          }
          throw err;
        } finally {
          if (session) {
            await session.endSession();
          }
        }
      }
    },

    /**
     * List historical clearance records for a stay
     */
    async listClearances(stayId) {
      return repository.findClearancesByStayId(stayId);
    },
  };
}

export const stayService = createStayService();
