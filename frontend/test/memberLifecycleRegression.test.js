import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  mapDepositSummary,
  mapLifetimeSummary,
  parseMyStayResponse,
} from '../src/lib/stayContracts.js';
import {
  buildMemberAccountPayload,
  buildStayCancellationPayload,
  normalizeMemberRoster,
} from '../src/lib/memberContracts.js';

describe('member lifecycle frontend contracts', () => {
  test('parses the /api/stays/me envelope without inventing deposit data', () => {
    const stay = { stayId: 'stay-1', memberId: 'gaurav', status: 'ACTIVE' };

    assert.deepEqual(parseMyStayResponse({
      success: true,
      configured: true,
      isActive: true,
      data: stay,
    }), {
      configured: true,
      isActive: true,
      stay,
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
    });
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
    });
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
