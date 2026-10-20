import { MEMBERS } from '../config/members.js';
import { getLogicalDateInTimeZone } from '../utils/date.js';
import { userAccountRepository } from '../auth/userAccount.repository.js';
import { roomRepository } from '../roomFees/room.repository.js';
import { STAY_STATUSES } from '../stays/stay.constants.js';
import { stayRepository } from '../stays/stay.repository.js';

const ACTIVE_STAY_STATUSES = new Set([
  STAY_STATUSES.ACTIVE,
  STAY_STATUSES.CHECKOUT_REQUESTED,
  STAY_STATUSES.CHECKOUT_PENDING,
]);

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
  accounts = userAccountRepository,
  stays = stayRepository,
  rooms = roomRepository,
  now = () => new Date(),
} = {}) {
  return Object.freeze({
    async listMembers() {
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
      return Promise.all(MEMBERS.map(async (member) => {
        const memberStays = staysByMember.get(member.id) || [];
        const activeStay = memberStays.find((stay) => ACTIVE_STAY_STATUSES.has(stay.status)) || null;
        const assignment = await rooms.findAssignmentOnDate(member.id, today);
        const room = assignment ? await rooms.findRoomById(assignment.roomId) : null;

        return {
          memberId: member.id,
          name: member.name,
          account: serializeAccount(accountByMember.get(member.id)),
          stay: serializeStay(activeStay, memberStays.length),
          room: room ? {
            roomId: room.roomId,
            roomNumber: room.roomNumber,
            assignmentId: assignment.assignmentId,
          } : null,
        };
      }));
    },
  });
}

export const memberService = createMemberService();
