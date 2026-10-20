import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  selectAssignmentForDate,
  selectAssignmentForMonth,
} from '../src/roomFees/assignmentResolution.js';
import { calculateMaxSimultaneousOccupancy } from '../src/roomFees/roomFee.service.js';
import { createMemberService } from '../src/members/member.service.js';
import { createStayService } from '../src/stays/stay.service.js';
import { createStayAttributionService } from '../src/stays/stayAttribution.service.js';
import { InMemoryStayRepository } from './helpers/inMemoryStayRepository.js';

describe('authoritative room assignment resolution', () => {
  const assignments = [
    {
      assignmentId: 'old-room',
      memberId: 'gaurav',
      roomId: 'room-101',
      effectiveFromMonth: '2026-09',
      effectiveUntilMonth: '2026-10',
      effectiveFromDate: '2026-09-10',
      effectiveUntilDate: '2026-10-14',
      assignedAt: '2026-09-10T00:00:00.000Z',
    },
    {
      assignmentId: 'new-room',
      memberId: 'gaurav',
      roomId: 'room-204',
      effectiveFromMonth: '2026-10',
      effectiveUntilMonth: null,
      effectiveFromDate: '2026-10-15',
      effectiveUntilDate: null,
      assignedAt: '2026-10-14T18:30:00.000Z',
    },
    {
      assignmentId: 'other-member',
      memberId: 'nikhil',
      roomId: 'room-999',
      effectiveFromMonth: '2026-10',
      effectiveUntilMonth: null,
      effectiveFromDate: '2026-10-01',
      effectiveUntilDate: null,
      assignedAt: '2026-10-01T00:00:00.000Z',
    },
  ];

  test('month billing resolves the latest assignment overlapping that month', () => {
    assert.equal(selectAssignmentForMonth(assignments, 'gaurav', '2026-10')?.assignmentId, 'new-room');
    assert.equal(selectAssignmentForMonth(assignments, 'gaurav', '2026-09')?.assignmentId, 'old-room');
    assert.equal(selectAssignmentForMonth(assignments, 'devansh', '2026-10'), null);
  });

  test('current occupancy uses exact dates rather than a month-only match', () => {
    assert.equal(selectAssignmentForDate(assignments, 'gaurav', '2026-10-14')?.assignmentId, 'old-room');
    assert.equal(selectAssignmentForDate(assignments, 'gaurav', '2026-10-15')?.assignmentId, 'new-room');
  });

  test('legacy month-only records remain resolvable', () => {
    const legacy = [{
      assignmentId: 'legacy',
      memberId: 'devansh',
      roomId: 'room-301',
      effectiveFromMonth: '2026-08',
      effectiveUntilMonth: '2026-10',
      effectiveFromDate: null,
      effectiveUntilDate: null,
      assignedAt: '2026-08-01T00:00:00.000Z',
    }];

    assert.equal(selectAssignmentForMonth(legacy, 'devansh', '2026-09')?.assignmentId, 'legacy');
    assert.equal(selectAssignmentForDate(legacy, 'devansh', '2026-10-31')?.assignmentId, 'legacy');
    assert.equal(selectAssignmentForDate(legacy, 'devansh', '2026-11-01'), null);
  });

  test('cancelled assignments no longer consume room capacity', () => {
    assert.equal(calculateMaxSimultaneousOccupancy({
      roomAssignments: [{
        assignmentId: 'cancelled',
        memberId: 'nikhil',
        effectiveFromDate: '2026-10-01',
        effectiveFromMonth: '2026-10',
        effectiveUntilDate: null,
        effectiveUntilMonth: null,
        cancelledAt: '2026-10-20T00:00:00.000Z',
      }],
      targetAssignment: {
        assignmentId: 'new',
        memberId: 'gaurav',
        effectiveFromDate: '2026-10-01',
        effectiveFromMonth: '2026-10',
      },
      roomCapacity: 1,
    }), 1);
  });
});

describe('configured member roster and historical admission', () => {
  test('lists all configured identities without fabricating stays', async () => {
    const service = createMemberService({
      accounts: {
        async listAll() {
          return [{
            userId: 'user-gaurav',
            memberId: 'gaurav',
            displayName: 'Gaurav',
            email: 'gaurav@example.com',
            role: 'member',
            active: true,
            lastLoginAt: null,
          }];
        },
      },
      stays: {
        async listAllStays() {
          return [{
            stayId: 'stay-gaurav',
            memberId: 'gaurav',
            status: 'ACTIVE',
            joinedOn: '2026-10-01',
            currentRoomId: 'room-204',
          }];
        },
      },
      rooms: {
        async findAssignmentOnDate(memberId) {
          return memberId === 'gaurav' ? { assignmentId: 'a-1', roomId: 'room-204' } : null;
        },
        async findRoomById(roomId) {
          return roomId === 'room-204' ? { roomId, roomNumber: '204' } : null;
        },
      },
      now: () => new Date('2026-10-20T06:30:00.000Z'),
    });

    const roster = await service.listMembers();
    assert.deepEqual(roster.map((row) => row.memberId), ['gaurav', 'nikhil', 'devansh']);
    assert.equal(roster[0].account.email, 'gaurav@example.com');
    assert.equal(roster[0].stay.status, 'ACTIVE');
    assert.equal(roster[0].room.roomNumber, '204');
    assert.equal(roster[1].account.exists, false);
    assert.equal(roster[1].stay, null);
  });

  test('requires a Super Admin reason for a historical admission and records it in audit history', async () => {
    const repository = new InMemoryStayRepository();
    const roomFees = {
      async assignMemberToRoom(input) {
        return { assignmentId: 'assignment-1', ...input };
      },
      async createFeePlan(input) {
        return { feePlanId: 'plan-1', ...input };
      },
    };
    const service = createStayService({
      repository,
      roomFees,
      finance: {},
      deposits: {},
      now: () => new Date('2026-10-20T06:30:00.000Z'),
      enforceHistoricalPolicy: true,
    });

    await assert.rejects(
      service.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-09-10',
        initialRoomId: 'room-204',
        actorRole: 'admin',
        historicalReason: 'Late data entry',
      }),
      (error) => error.statusCode === 403,
    );

    await assert.rejects(
      service.createStay({
        memberId: 'nikhil',
        joinedOn: '2026-09-10',
        initialRoomId: 'room-204',
        actorRole: 'superadmin',
      }),
      (error) => error.statusCode === 400,
    );

    const stay = await service.createStay({
      memberId: 'nikhil',
      joinedOn: '2026-09-10',
      initialRoomId: 'room-204',
      actorRole: 'superadmin',
      actorMemberId: null,
      historicalReason: 'Reconstructing verified September admission',
    });

    assert.equal(stay.joinedOn, '2026-09-10');
    assert.equal(stay.history[0].details.historicalAdmission, true);
    assert.equal(stay.history[0].details.historicalReason, 'Reconstructing verified September admission');
  });
});

describe('safe incorrect Stay cancellation', () => {
  function createCancellationHarness({ roomBilledPaise = 0 } = {}) {
    const repository = new InMemoryStayRepository();
    const cancelledArtifacts = [];
    const roomFees = {
      async assignMemberToRoom(input) {
        return { assignmentId: 'assignment-admission', ...input };
      },
      async cancelAdmissionArtifacts(input) {
        cancelledArtifacts.push(input);
      },
    };
    const stayAttribution = {
      async getStayAttributedFinances() {
        return {
          totalMessBilledPaise: 0,
          totalMessPaidPaise: 0,
          totalRoomBilledPaise: roomBilledPaise,
          totalRoomPaidPaise: 0,
          totalExpenseSharePaise: 0,
          totalExpenseOwedPaise: 0,
          totalExpenseReceivablePaise: 0,
          depositOverview: { transactions: [] },
          attributionWarnings: [],
        };
      },
    };
    const service = createStayService({
      repository,
      roomFees,
      finance: {},
      deposits: {},
      stayAttribution,
      now: () => new Date('2026-10-20T06:30:00.000Z'),
      enforceHistoricalPolicy: true,
    });
    return { service, repository, cancelledArtifacts };
  }

  test('cancels an activity-free Stay while preserving its audit record', async () => {
    const { service, repository, cancelledArtifacts } = createCancellationHarness();
    const stay = await service.createStay({
      memberId: 'gaurav',
      joinedOn: '2026-10-20',
      initialRoomId: 'room-204',
      actorRole: 'superadmin',
    });

    const cancelled = await service.cancelIncorrectStay({
      stayId: stay.stayId,
      reason: 'Created accidentally',
      expectedRevision: stay.revision,
      actorRole: 'superadmin',
    });

    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.currentRoomId, null);
    assert.equal(cancelled.cancelReason, 'Created accidentally');
    assert.equal(cancelledArtifacts.length, 1);
    assert.equal(cancelledArtifacts[0].assignmentId, 'assignment-admission');
    assert.equal((await repository.findStayById(stay.stayId)).history.at(-1).event, 'STAY_CANCELLED');
  });

  test('blocks simple cancellation when attributed financial activity exists', async () => {
    const { service, cancelledArtifacts } = createCancellationHarness({ roomBilledPaise: 280000 });
    const stay = await service.createStay({
      memberId: 'gaurav',
      joinedOn: '2026-10-20',
      initialRoomId: 'room-204',
      actorRole: 'superadmin',
    });

    await assert.rejects(
      service.cancelIncorrectStay({
        stayId: stay.stayId,
        reason: 'Created accidentally',
        expectedRevision: stay.revision,
        actorRole: 'superadmin',
      }),
      (error) => error.statusCode === 409
        && error.details.blockers.some((blocker) => blocker.type === 'ROOM_CHARGES'),
    );
    assert.equal(cancelledArtifacts.length, 0);
  });

  test('corrects an activity-free admission date and room with audit history', async () => {
    const { repository } = createCancellationHarness();
    const correctedArtifacts = [];
    const correctionService = createStayService({
      repository,
      roomFees: {
        async assignMemberToRoom(input) {
          return { assignmentId: 'assignment-admission', ...input };
        },
        async correctAdmissionArtifacts(input) {
          correctedArtifacts.push(input);
          return { assignment: { assignmentId: input.assignmentId, roomId: input.roomId } };
        },
      },
      finance: {},
      deposits: {},
      stayAttribution: {
        async getStayAttributedFinances() {
          return {
            totalMessBilledPaise: 0,
            totalMessPaidPaise: 0,
            totalRoomBilledPaise: 0,
            totalRoomPaidPaise: 0,
            totalExpenseSharePaise: 0,
            totalExpenseOwedPaise: 0,
            totalExpenseReceivablePaise: 0,
            depositOverview: { transactions: [] },
            attributionWarnings: [],
          };
        },
      },
      now: () => new Date('2026-10-20T06:30:00.000Z'),
      enforceHistoricalPolicy: true,
    });
    const stay = await correctionService.createStay({
      memberId: 'nikhil',
      joinedOn: '2026-10-20',
      initialRoomId: 'room-204',
      actorRole: 'superadmin',
    });

    const corrected = await correctionService.correctAdmissionDetails({
      stayId: stay.stayId,
      joinedOn: '2026-09-15',
      roomId: 'room-301',
      reason: 'Correcting verified admission record',
      expectedRevision: stay.revision,
      actorRole: 'superadmin',
    });

    assert.equal(corrected.joinedOn, '2026-09-15');
    assert.equal(corrected.initialRoomId, 'room-301');
    assert.equal(corrected.currentRoomId, 'room-301');
    assert.equal(correctedArtifacts[0].effectiveFromDate, '2026-09-15');
    assert.equal(correctedArtifacts[0].roomId, 'room-301');
    assert.equal((await repository.findStayById(stay.stayId)).history.at(-1).event, 'ADMISSION_CORRECTED');
  });
});

describe('exact Stay financial attribution safety', () => {
  test('flags month-level ledgers as ambiguous when two Stays share one calendar month', async () => {
    const targetStay = {
      stayId: 'stay-a',
      memberId: 'gaurav',
      joinedOn: '2026-10-01',
      actualLeftOn: '2026-10-10',
      status: 'CHECKED_OUT',
    };
    const service = createStayAttributionService({
      stayRepo: {
        async findStayById() { return targetStay; },
        async findStaysByMember() {
          return [targetStay, {
            stayId: 'stay-b',
            memberId: 'gaurav',
            joinedOn: '2026-10-20',
            actualLeftOn: null,
            status: 'ACTIVE',
          }];
        },
      },
      finance: {
        async getMemberFinancialOverview() {
          return {
            mess: { billPaise: 10000, paidPaise: 10000, remainingPaise: 0 },
            room: { chargeIssued: true, issuedChargePaise: 280000, paidPaise: 280000, remainingPaise: 0 },
            expenses: { spendingSharePaise: 0, owedToOthersPaise: 0, owedToMePaise: 0 },
          };
        },
      },
      expenses: { async listExpensesByMonth() { return []; } },
      deposits: { async getDepositSummary() { return { summary: { heldPaise: 0 }, transactions: [] }; } },
      roomRepo: { async findAssignmentsForMember() { return []; } },
    });

    const result = await service.getStayAttributedFinances({ stayId: 'stay-a' });

    assert.equal(result.isEligibleForNoDues, false);
    assert.equal(result.isAttributionComplete, false);
    assert.deepEqual(result.attributionWarnings.map((warning) => warning.domain).sort(), ['MESS', 'ROOM_FEES']);
  });
});
