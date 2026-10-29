import { MEMBERS } from '../config/members.js';
import { getLogicalDateInTimeZone } from '../utils/date.js';
import { userAccountRepository } from '../auth/userAccount.repository.js';
import { roomRepository } from '../roomFees/room.repository.js';
import { STAY_STATUSES } from '../stays/stay.constants.js';
import { stayRepository } from '../stays/stay.repository.js';
import { studentResolver } from '../students/studentResolver.service.js';
import {
  LEGACY_STUDENT_ELIGIBILITY_FIXTURES,
  STUDENT_STATUSES,
} from '../students/student.constants.js';

const ACTIVE_STAY_STATUSES = new Set([
  STAY_STATUSES.ACTIVE,
  STAY_STATUSES.CHECKOUT_REQUESTED,
  STAY_STATUSES.CHECKOUT_PENDING,
]);

function legacyCompatibilityStudents() {
  return MEMBERS.map((member, index) => ({
    studentId: member.id,
    displayName: member.name,
    status: STUDENT_STATUSES.ACTIVE,
    mealEligibilityFrom: LEGACY_STUDENT_ELIGIBILITY_FIXTURES[member.id] ?? null,
    mealEligibilityUntil: null,
    rosterOrder: (index + 1) * 10,
    archivedAt: null,
    archivedReason: null,
  }));
}

function serializeAccount(account) {
  if (!account) return { exists: false };
  return {
    exists: true,
    userId: account.userId,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    active: account.active !== false,
    lastLoginAt: account.lastLoginAt || null,
    passwordChangedAt: account.passwordChangedAt || null,
    sessionVersion: account.sessionVersion ?? 0,
  };
}

function serializeStay(stay, historyCount) {
  if (!stay) return null;
  return {
    stayId: stay.stayId,
    status: stay.status,
    joinedOn: stay.joinedOn,
    expectedLeaveOn: stay.expectedLeaveOn || null,
    actualLeftOn: stay.actualLeftOn || null,
    currentRoomId: stay.currentRoomId || null,
    revision: stay.revision ?? 0,
    historyCount,
  };
}

export function createMemberService({
  resolver = studentResolver,
  accounts = userAccountRepository,
  stays = stayRepository,
  rooms = roomRepository,
  now = () => new Date(),
} = {}) {
  async function enrichStudents(students) {
    const [accountRows, stayRows] = await Promise.all([
      accounts.listAll(),
      stays.listAllStays(),
    ]);
    const accountByMember = new Map(
      accountRows.filter((account) => account.memberId).map((account) => [account.memberId, account]),
    );
    const staysByMember = new Map();
    for (const stay of stayRows) {
      const list = staysByMember.get(stay.memberId) || [];
      list.push(stay);
      staysByMember.set(stay.memberId, list);
    }

    const today = getLogicalDateInTimeZone(now(), 'Asia/Kolkata');
    return Promise.all(students.map(async (student) => {
      const memberStays = staysByMember.get(student.studentId) || [];
      const activeStay = memberStays.find((stay) => ACTIVE_STAY_STATUSES.has(stay.status)) || null;
      const assignment = await rooms.findAssignmentOnDate(student.studentId, today);
      const room = assignment ? await rooms.findRoomById(assignment.roomId) : null;
      const feePlan = typeof rooms.findActiveFeePlan === 'function'
        ? await rooms.findActiveFeePlan(student.studentId, today.slice(0, 7))
        : null;

      return {
        memberId: student.studentId,
        name: student.displayName,
        status: student.status,
        mealEligibilityFrom: student.mealEligibilityFrom ?? null,
        mealEligibilityUntil: student.mealEligibilityUntil ?? null,
        rosterOrder: student.rosterOrder,
        archivedAt: student.archivedAt ?? null,
        archivedReason: student.archivedReason ?? null,
        account: serializeAccount(accountByMember.get(student.studentId)),
        stay: serializeStay(activeStay, memberStays.length),
        room: room ? {
          roomId: room.roomId,
          roomNumber: room.roomNumber,
          assignmentId: assignment.assignmentId,
        } : null,
        assignment: assignment ? {
          assignmentId: assignment.assignmentId,
          roomId: assignment.roomId,
          effectiveFromDate: assignment.effectiveFromDate || `${assignment.effectiveFromMonth}-01`,
          effectiveUntilDate: assignment.effectiveUntilDate || null,
        } : null,
        feePlan: feePlan ? {
          feePlanId: feePlan.feePlanId,
          amountPaise: feePlan.amountPaise,
          effectiveFromMonth: feePlan.effectiveFromMonth,
        } : null,
      };
    }));
  }

  return Object.freeze({
    async listMembers() {
      const students = await resolver.listCurrent();
      return enrichStudents(students.length > 0 ? students : legacyCompatibilityStudents());
    },

    async findMemberById(memberId) {
      const resolvedStudents = await resolver.listAll();
      const students = resolvedStudents.length > 0 ? resolvedStudents : legacyCompatibilityStudents();
      const student = students.find((candidate) => candidate.studentId === memberId);
      if (!student) return null;
      const [member] = await enrichStudents([student]);
      return member;
    },
  });
}

export const memberService = createMemberService();
