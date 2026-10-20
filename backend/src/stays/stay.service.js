/**
 * MealKhata 2.0 - Hostel Stay Lifecycle Domain Service
 * Manages admission, active stays, room history & transfers, checkout review, and final clearance.
 */

import { randomUUID } from 'node:crypto';
import { MEMBER_IDS } from '../config/members.js';
import { isValidLogicalDate } from '../utils/date.js';
import { isValidLogicalMonth } from '../utils/month.js';
import { roomFeeService } from '../roomFees/roomFee.service.js';
import { financialOverviewService } from '../finance/financialOverview.service.js';
import { depositService } from './deposit.service.js';
import { stayRepository } from './stay.repository.js';
import {
  CLEARANCE_STATUSES,
  DEPOSIT_ACCOUNT_STATUSES,
  DEPOSIT_HOLDER_TYPES,
  STAY_STATUSES,
} from './stay.constants.js';

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
} = {}) {
  return {
    /**
     * Create a new hostel stay (admission / onboarding)
     */
    async createStay({
      memberId,
      joinedOn,
      expectedLeaveOn = null,
      initialRoomId,
      monthlyFeePaise = null,
      expectedDepositPaise = 0,
      actorRole,
    }) {
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

      // Invariant: At most ONE active or pending stay per member!
      const activeStay = await repository.findActiveStayForMember(memberId);
      if (activeStay) {
        throw new StayDomainError(
          `Member ${memberId} already has an active or pending hostel stay (${activeStay.stayId}).`,
          409,
          { activeStayId: activeStay.stayId },
        );
      }

      const stayId = randomUUID();
      const depositAccountId = randomUUID();
      const joinMonth = joinedOn.slice(0, 7);

      // 1. Create HostelStay record
      const stay = await repository.createStay({
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
            details: { initialRoomId, monthlyFeePaise, expectedDepositPaise },
          },
        ],
      });

      // 2. Create associated Security Deposit Account
      await repository.createDepositAccount({
        depositAccountId,
        stayId,
        memberId,
        expectedDepositPaise: Number.isInteger(expectedDepositPaise) && expectedDepositPaise >= 0
          ? expectedDepositPaise
          : 0,
        holderType: DEPOSIT_HOLDER_TYPES.ADMIN_COLLECTOR,
        holderName: 'Hostel Administration',
        status: DEPOSIT_ACCOUNT_STATUSES.OPEN,
        history: [
          {
            event: 'DEPOSIT_ACCOUNT_OPENED',
            timestamp: new Date(),
            actorRole,
            note: `Deposit account initialized for stay ${stayId}`,
            details: { expectedDepositPaise },
          },
        ],
      });

      // 3. Link Room Assignment if supported
      try {
        await roomFees.assignMemberToRoom({
          roomId: initialRoomId.trim(),
          memberId,
          effectiveFromMonth: joinMonth,
          actorRole,
        });
      } catch (err) {
        // If room is already assigned or needs manual config, record warning note
      }

      // 4. Configure initial fee plan if specified
      if (Number.isInteger(monthlyFeePaise) && monthlyFeePaise > 0) {
        try {
          await roomFees.createFeePlan({
            memberId,
            effectiveFromMonth: joinMonth,
            amountPaise: monthlyFeePaise,
            reason: `Initial fee plan on admission in Room ${initialRoomId}`,
            actorRole,
          });
        } catch (err) {
          // preserve fee plan exception without aborting stay
        }
      }

      return stay;
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
      reason = null,
      actorRole,
    }) {
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

      const transferMonth = effectiveDate.slice(0, 7);
      const oldRoomId = stay.currentRoomId || stay.initialRoomId;

      // Assign to new room via roomFeeService (enforces room capacity)
      await roomFees.assignMemberToRoom({
        roomId: newRoomId.trim(),
        memberId: stay.memberId,
        effectiveFromMonth: transferMonth,
        actorRole,
      });

      // Update fee plan if provided
      if (Number.isInteger(newMonthlyRatePaise) && newMonthlyRatePaise > 0) {
        await roomFees.createFeePlan({
          memberId: stay.memberId,
          effectiveFromMonth: transferMonth,
          amountPaise: newMonthlyRatePaise,
          reason: `Updated rate upon room transfer from Room ${oldRoomId} to ${newRoomId}`,
          actorRole,
        });
      }

      // Update stay
      const updated = await repository.updateStay(
        stayId,
        {
          currentRoomId: newRoomId.trim(),
        },
        stay.revision,
      );

      if (!updated) {
        throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
      }

      await repository.addStayHistory(stayId, {
        event: 'ROOM_TRANSFERRED',
        timestamp: new Date(),
        actorRole,
        note: `Transferred from Room ${oldRoomId} to Room ${newRoomId} effective ${effectiveDate}${reason ? `: ${reason}` : ''}`,
        details: { oldRoomId, newRoomId, effectiveDate, newMonthlyRatePaise },
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
     * Get 5-step Checkout Review data
     */
    async getCheckoutReview(stayId) {
      const stay = await this.getStayById(stayId);
      const memberId = stay.memberId;
      const currentMonth = new Date().toISOString().slice(0, 7);

      // 1. Live unified financial overview
      const financeOverview = await finance.getMemberFinancialOverview({
        memberId,
        month: currentMonth,
        actorRole: 'admin',
      });

      // 2. Deposit status
      const depositOverview = await deposits.getDepositSummary(stayId);

      // 3. Compile outstanding obligations
      const outstandingObligations = [];
      if (financeOverview.mess.remainingPaise > 0) {
        outstandingObligations.push({
          domain: 'MESS',
          title: 'Hostel Mess Bills',
          amountPaise: financeOverview.mess.remainingPaise,
          toRecipient: 'Hostel Kitchen / Mess Fund',
        });
      }
      if (financeOverview.room.remainingPaise > 0) {
        outstandingObligations.push({
          domain: 'ROOM_FEES',
          title: 'Monthly Room Fees',
          amountPaise: financeOverview.room.remainingPaise,
          toRecipient: 'Hostel Administration',
        });
      }
      if (financeOverview.expenses.owedToOthersPaise > 0) {
        for (const debt of financeOverview.expenses.debtsOwed || []) {
          outstandingObligations.push({
            domain: 'OTHER_EXPENSES',
            title: `Reimbursement to ${debt.toMemberId}: ${debt.title}`,
            amountPaise: debt.amountPaise,
            toRecipient: debt.toMemberId,
          });
        }
      }

      const totalOutstandingPayablePaise = financeOverview.combined.outstandingPayablePaise;
      const isEligibleForNoDues =
        totalOutstandingPayablePaise === 0 && depositOverview.summary.heldPaise === 0;

      return {
        stay,
        financialOverview: financeOverview,
        depositOverview,
        outstandingObligations,
        totalOutstandingPayablePaise,
        depositHeldPaise: depositOverview.summary.heldPaise,
        isEligibleForNoDues,
      };
    },

    /**
     * Finalize checkout and issue clearance snapshot
     */
    async finalizeCheckout({
      stayId,
      actualLeftOn,
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

      // Review live obligations
      const review = await this.getCheckoutReview(stayId);

      // If obligations or unrefunded deposit remain, only Super Admin can override
      let clearanceStatus = CLEARANCE_STATUSES.NO_DUES;
      if (!review.isEligibleForNoDues) {
        if (actorRole !== 'superadmin') {
          throw new StayDomainError(
            'Cannot finalize checkout with pending dues or unrefunded deposit. Super Admin approval required.',
            403,
            { totalOutstandingPayablePaise: review.totalOutstandingPayablePaise },
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

      const sequence = await repository.getNextClearanceSequence(stayId);
      const clearanceId = randomUUID();

      // 1. Create Immutable Clearance Snapshot
      const clearance = await repository.createClearance({
        clearanceId,
        stayId,
        memberId: stay.memberId,
        sequence,
        snapshotVersion: 1,
        joinedOn: stay.joinedOn,
        actualLeftOn,
        lastRoomId: stay.currentRoomId || stay.initialRoomId,
        financialAsOf: new Date(),
        messSummary: {
          billPaise: review.financialOverview.mess.billPaise,
          paidPaise: review.financialOverview.mess.paidPaise,
          remainingPaise: review.financialOverview.mess.remainingPaise,
        },
        roomFeeSummary: {
          issuedChargePaise: review.financialOverview.room.issuedChargePaise,
          paidPaise: review.financialOverview.room.paidPaise,
          remainingPaise: review.financialOverview.room.remainingPaise,
        },
        expenseSummary: {
          spendingSharePaise: review.financialOverview.expenses.spendingSharePaise,
          owedToOthersPaise: review.financialOverview.expenses.owedToOthersPaise,
          owedToMePaise: review.financialOverview.expenses.owedToMePaise,
        },
        depositSummary: review.depositOverview.summary,
        outstandingObligations: review.outstandingObligations,
        clearanceStatus,
        exceptionReason: exceptionReason?.trim() || null,
        finalizedAt: new Date(),
        finalizedByRole: actorRole,
      });

      // 2. Transition Stay to CHECKED_OUT
      const updatedStay = await repository.updateStay(
        stayId,
        {
          status: STAY_STATUSES.CHECKED_OUT,
          actualLeftOn,
          checkoutFinalizedAt: new Date(),
          checkoutFinalizedByRole: actorRole,
        },
        stay.revision,
      );

      // 3. End active room assignment and release capacity after checkout date
      try {
        await roomFees.endActiveRoomAssignment({
          memberId: stay.memberId,
          endMonth: actualLeftOn.slice(0, 7),
        });
      } catch {
        // preserve checkout if room fee service reports no active assignment
      }

      // 4. Audit trail
      await repository.addStayHistory(stayId, {
        event: 'CHECKOUT_FINALIZED',
        timestamp: new Date(),
        actorRole,
        note: `Stay finalized as ${clearanceStatus} on ${actualLeftOn}${exceptionReason ? `: ${exceptionReason}` : ''}`,
        details: { clearanceId, sequence, clearanceStatus },
      });

      return {
        stay: updatedStay,
        clearance,
      };
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
