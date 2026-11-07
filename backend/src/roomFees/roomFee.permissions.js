import { ROLES } from '../auth/permissions.js';
import { compareLogicalMonths } from '../utils/month.js';

export function canViewOwnRoomFees({ role, memberId, targetMemberId }) {
  if (role === ROLES.SUPERADMIN || role === ROLES.ADMIN) {
    return true;
  }
  if (role === ROLES.MEMBER && memberId && targetMemberId) {
    return memberId === targetMemberId;
  }
  return false;
}

export function canViewAllRoomFees(role) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN;
}

export function canManageRooms(role) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN;
}

export function canAssignRooms({ role, effectiveFromMonth, currentMonth }) {
  if (role === ROLES.SUPERADMIN) {
    return true;
  }
  if (role === ROLES.ADMIN) {
    // Admin can only configure for current or future months
    return compareLogicalMonths(effectiveFromMonth, currentMonth) >= 0;
  }
  return false;
}

export function canManageFeePlans({ role, effectiveFromMonth, currentMonth }) {
  if (role === ROLES.SUPERADMIN) {
    return true;
  }
  if (role === ROLES.ADMIN) {
    return compareLogicalMonths(effectiveFromMonth, currentMonth) >= 0;
  }
  return false;
}

export function canIssueRoomCharges({ role, month, currentMonth }) {
  if (role === ROLES.SUPERADMIN) {
    return true;
  }
  if (role === ROLES.ADMIN) {
    // Admin can issue for current or future months, historical requires Super Admin
    return compareLogicalMonths(month, currentMonth) >= 0;
  }
  return false;
}

export function canRecordRoomPayment(role) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN;
}

export function canVoidRoomPayment(role) {
  return role === ROLES.SUPERADMIN;
}

export function canAdjustRoomCharge(role) {
  return role === ROLES.SUPERADMIN;
}

export function canCancelRoomCharge(role) {
  return role === ROLES.SUPERADMIN;
}

export function canManageRoomPaymentSettings(role) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN;
}
