import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  mapCheckoutReview,
  mapDepositSummary,
  mapLifetimeSummary,
  mapRoomHistory,
  getMyStayLifecycleState,
  parseMyStayResponse,
} from '../src/lib/stayContracts.js';
import {
  buildMemberAccountPayload,
  buildStayCancellationPayload,
  getMemberRosterMetrics,
  normalizeMemberRoster,
} from '../src/lib/memberContracts.js';
import {
  buildStayAdmissionPayload,
  selectExistingAssignmentForAdmission,
} from '../src/lib/stayAdmissionContracts.js';

describe('member lifecycle frontend contracts', () => {
  test('prefers the current existing assignment and builds an explicit link payload', () => {
    const assignment = selectExistingAssignmentForAdmission([
      {
        assignmentId: 'old',
        memberId: 'gaurav',
        roomId: 'old-room',
        effectiveFromDate: '2026-01-01',
        effectiveUntilDate: '2026-08-31',
      },
      {
        assignmentId: 'current',
        memberId: 'gaurav',
        roomId: 'lower',
        effectiveFromDate: '2026-10-20',
        effectiveUntilDate: null,
      },
    ], '2026-09-01');

    assert.equal(assignment.assignmentId, 'current');
    assert.deepEqual(buildStayAdmissionPayload({
      memberId: 'gaurav',
      joinedOn: '2026-09-01',
      initialRoomId: 'lower',
      assignment,
      allowUnverifiedPreAssignmentPeriod: true,
      historicalReason: 'Verified admission ledger',
      expectedDepositPaise: 0,
    }), {
      memberId: 'gaurav',
      joinedOn: '2026-09-01',
      initialRoomId: 'lower',
      admissionMode: 'link_existing_assignment',
      assignmentId: 'current',
      allowUnverifiedPreAssignmentPeriod: true,
      historicalReason: 'Verified admission ledger',
      expectedDepositPaise: 0,
    });
  });

  test('parses the /api/stays/me envelope without inventing deposit data', () => {
    const stay = { stayId: 'stay-1', memberId: 'gaurav', status: 'ACTIVE' };

    assert.deepEqual(parseMyStayResponse({
      success: true,
      configured: true,
      isActive: true,
      data: stay,
      currentAssignment: { assignmentId: 'assignment-1' },
      currentRoom: { roomId: 'lower', roomNumber: 'lower' },
    }), {
      configured: true,
      isActive: true,
      stay,
      currentAssignment: { assignmentId: 'assignment-1' },
      currentRoom: { roomId: 'lower', roomNumber: 'lower' },
    });

    assert.deepEqual(parseMyStayResponse({
      success: true,
      configured: false,
      isActive: false,
      data: null,
    }), {
      configured: false,
      isActive: false,
      stay: null,
      currentAssignment: null,
      currentRoom: null,
    });
  });

  test('classifies minimal My Stay states without inventing accommodation', () => {
    assert.equal(getMyStayLifecycleState({ stay: null, currentAssignment: { assignmentId: 'a-1' } }), 'assignment_only');
    assert.equal(getMyStayLifecycleState({ stay: null, currentAssignment: null }), 'empty');
    assert.equal(getMyStayLifecycleState({ stay: { status: 'ACTIVE' } }), 'active');
    assert.equal(getMyStayLifecycleState({ stay: { status: 'CHECKOUT_REQUESTED' } }), 'pending_checkout');
    assert.equal(getMyStayLifecycleState({ stay: { status: 'CHECKOUT_PENDING' } }), 'pending_checkout');
    assert.equal(getMyStayLifecycleState({ stay: { status: 'CHECKED_OUT' } }), 'completed');
  });

  test('maps the lifetime report DTO to the values rendered by the stay page', () => {
    const mapped = mapLifetimeSummary({
      summary: { totalMonths: 2 },
      lifetimeTotals: {
        mess: { billedPaise: 123400, paidPaise: 100000, remainingPaise: 23400 },
        room: {
          billedPaise: 560000,
          paidPaise: 280000,
          remainingPaise: 280000,
          issuedMonths: 2,
          fullyPaidMonths: 1,
          partialMonths: 1,
          unpaidMonths: 0,
        },
        expenses: {
          spendingSharePaise: 45000,
          owedToOthersPaise: 12000,
          owedToMePaise: 7000,
        },
      },
      depositOverview: {
        account: { expectedDepositPaise: 500000 },
        summary: {
          expectedPaise: 500000,
          receivedPaise: 500000,
          deductedPaise: 5000,
          refundedPaise: 0,
          heldPaise: 495000,
        },
      },
      monthlySummaries: [{
        month: '2026-10',
        mess: { billPaise: 123400, paidPaise: 100000, remainingPaise: 23400 },
        room: { issuedChargePaise: 280000, paidPaise: 140000, remainingPaise: 140000 },
        expenses: { spendingSharePaise: 45000, owedToOthersPaise: 12000 },
      }],
    });

    assert.equal(mapped.stayDurationMonths, 2);
    assert.deepEqual(mapped.mess, {
      totalBilledPaise: 123400,
      totalPaidPaise: 100000,
      outstandingPaise: 23400,
    });
    assert.equal(mapped.roomFees.totalIssuedPaise, 560000);
    assert.equal(mapped.roomFees.partiallyPaidMonthsCount, 1);
    assert.equal(mapped.expenses.reimbursementsReceivablePaise, 7000);
    assert.equal(mapped.deposit.depositHeldPaise, 495000);
    assert.deepEqual(mapped.monthlyBreakdown[0], {
      month: '2026-10',
      messBilledPaise: 123400,
      messPaidPaise: 100000,
      messDuePaise: 23400,
      roomIssuedPaise: 280000,
      roomPaidPaise: 140000,
      roomDuePaise: 140000,
      expenseSharePaise: 45000,
      expenseOwedPaise: 12000,
    });
  });

  test('flattens the deposit endpoint DTO for the existing deposit card', () => {
    assert.deepEqual(mapDepositSummary({
      account: { expectedDepositPaise: 250000, status: 'OPEN' },
      summary: {
        expectedPaise: 250000,
        receivedPaise: 100000,
        deductedPaise: 10000,
        refundedPaise: 5000,
        heldPaise: 85000,
      },
      transactions: [{ depositTransactionId: 'dep-1' }],
    }), {
      account: { expectedDepositPaise: 250000, status: 'OPEN' },
      expectedDepositPaise: 250000,
      depositReceivedPaise: 100000,
      depositDeductedPaise: 10000,
      depositRefundedPaise: 5000,
      depositHeldPaise: 85000,
      transactions: [{ depositTransactionId: 'dep-1' }],
      reclassifications: [],
      unallocatedCredits: [],
    });
  });

  test('maps the room-history envelope to the timeline component contract', () => {
    assert.deepEqual(mapRoomHistory({
      stayId: 'stay-1',
      timeline: [{
        assignmentId: 'assignment-1',
        roomId: 'room-204',
        roomNumber: '204',
        effectiveFromDate: '2026-09-15',
        effectiveUntilDate: null,
        monthlyRatePaise: 280000,
      }],
    }), [{
      assignmentId: 'assignment-1',
      roomId: 'room-204',
      roomNumber: '204',
      startMonth: '2026-09',
      endMonth: null,
      monthlyRentPaise: 280000,
      occupancy: null,
      reason: null,
      isCurrent: true,
    }]);
  });

  test('maps checkout review balances and preserves attribution blockers', () => {
    const mapped = mapCheckoutReview({
      financialOverview: {
        mess: { billPaise: 45000, paidPaise: 40000, remainingPaise: 5000 },
        room: { issuedChargePaise: 280000, paidPaise: 140000, remainingPaise: 140000 },
        expenses: { spendingSharePaise: 10000, owedToOthersPaise: 3000, owedToMePaise: 2000 },
      },
      totalMessBilledPaise: 90000,
      totalMessPaidPaise: 85000,
      totalMessRemainingPaise: 5000,
      totalRoomBilledPaise: 560000,
      totalRoomPaidPaise: 420000,
      totalRoomRemainingPaise: 140000,
      totalExpenseSharePaise: 25000,
      totalExpenseOwedPaise: 3000,
      totalExpenseReceivablePaise: 2000,
      attributionWarnings: [{ domain: 'MESS', month: '2026-07', message: 'Manual review required.' }],
      isAttributionComplete: false,
      isEligibleForNoDues: false,
    });

    assert.equal(mapped.messSummary.totalBilledPaise, 90000);
    assert.equal(mapped.roomFeeSummary.outstandingPaise, 140000);
    assert.equal(mapped.expenseSummary.reimbursementsOwedPaise, 3000);
    assert.equal(mapped.attributionWarnings.length, 1);
    assert.equal(mapped.isAttributionComplete, false);
    assert.equal(mapped.isEligibleForNoDues, false);
  });
});

describe('admin member roster contract', () => {
  test('always returns the three stable identities without creating stay data', () => {
    const roster = normalizeMemberRoster([{
      memberId: 'gaurav',
      name: 'Gaurav',
      account: { exists: true, active: true },
      stay: { stayId: 'stay-1', status: 'ACTIVE' },
      room: { roomNumber: '204' },
    }]);

    assert.deepEqual(roster.map((row) => row.memberId), ['gaurav', 'nikhil', 'devansh']);
    assert.equal(roster[0].stay.status, 'ACTIVE');
    assert.equal(roster[1].stay, null);
    assert.equal(roster[2].account.exists, false);
  });

  test('preserves accommodation fields and derives assignment counts separately from Stay counts', () => {
    const roster = normalizeMemberRoster([
      {
        memberId: 'gaurav',
        room: { roomId: 'lower', roomNumber: 'lower' },
        assignment: { assignmentId: 'a-g', effectiveFromDate: '2026-10-20', effectiveUntilDate: null },
        feePlan: { feePlanId: 'p-g', amountPaise: 280000 },
        stay: null,
      },
      {
        memberId: 'nikhil',
        room: { roomId: 'first', roomNumber: '1st Floor Room' },
        assignment: { assignmentId: 'a-n', effectiveFromDate: '2026-10-20', effectiveUntilDate: null },
        feePlan: { feePlanId: 'p-n', amountPaise: 280000 },
        stay: { stayId: 'stay-n', status: 'ACTIVE' },
      },
      {
        memberId: 'devansh',
        room: { roomId: 'first', roomNumber: '1st Floor Room' },
        assignment: { assignmentId: 'a-d', effectiveFromDate: '2026-10-20', effectiveUntilDate: null },
        feePlan: null,
        stay: null,
      },
    ]);

    assert.equal(roster[0].assignment.assignmentId, 'a-g');
    assert.equal(roster[0].feePlan.amountPaise, 280000);
    assert.deepEqual(getMemberRosterMetrics(roster), {
      members: 3,
      currentlyAssignedResidents: 3,
      assignedRooms: 2,
      activeRegisteredStays: 1,
      membersNeedingStayRegistration: 2,
    });
  });

  test('builds an optimistic-concurrency cancellation payload without extra fields', () => {
    assert.deepEqual(buildStayCancellationPayload({
      reason: '  Created accidentally  ',
      revision: 3,
      password: 'must-not-leak',
    }), {
      reason: 'Created accidentally',
      expectedRevision: 3,
    });
  });

  test('strips sensitive and unknown account fields from the member roster', () => {
    const [member] = normalizeMemberRoster([{
      memberId: 'gaurav',
      account: {
        exists: true,
        email: 'gaurav@example.com',
        active: true,
        passwordHash: 'must-never-reach-ui-state',
        internalFlag: true,
      },
    }]);

    assert.deepEqual(member.account, {
      exists: true,
      userId: null,
      email: 'gaurav@example.com',
      displayName: null,
      role: null,
      active: true,
      lastLoginAt: null,
      passwordChangedAt: null,
      sessionVersion: 0,
    });
  });

  test('builds allow-listed credential mutation payloads without trimming passwords', () => {
    assert.deepEqual(buildMemberAccountPayload('email', {
      email: ' Nikhil@Example.com ',
      currentPassword: ' admin secret ',
      newPassword: 'must-not-be-included',
      role: 'superadmin',
    }), {
      email: 'nikhil@example.com',
      currentPassword: ' admin secret ',
    });
    assert.deepEqual(buildMemberAccountPayload('password', {
      currentPassword: 'admin-secret',
      newPassword: 'NewStrong!234',
      email: 'must-not-be-included@example.com',
    }), {
      newPassword: 'NewStrong!234',
      currentPassword: 'admin-secret',
    });
    assert.deepEqual(buildMemberAccountPayload('status', {
      currentPassword: 'admin-secret',
      active: false,
    }), {
      currentPassword: 'admin-secret',
    });
  });
});
