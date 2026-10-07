import { MEMBERS } from '../config/members.js';

export const ROLES = Object.freeze({
  VIEWER: 'viewer',
  MEMBER: 'member',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
});

export const AUTHENTICATED_ROLES = Object.freeze([
  ROLES.MEMBER,
  ROLES.ADMIN,
  ROLES.SUPERADMIN,
]);

const ROLE_LEVELS = Object.freeze({
  [ROLES.VIEWER]: 0,
  [ROLES.MEMBER]: 1,
  [ROLES.ADMIN]: 2,
  [ROLES.SUPERADMIN]: 3,
});

const ROLE_CAPABILITIES = Object.freeze({
  [ROLES.VIEWER]: Object.freeze({
    canEditToday: false,
    canEditPast: false,
    canEditFuture: false,
  }),
  [ROLES.MEMBER]: Object.freeze({
    canEditToday: true,
    canEditPast: false,
    canEditFuture: false,
  }),
  [ROLES.ADMIN]: Object.freeze({
    canEditToday: true,
    canEditPast: false,
    canEditFuture: false,
  }),
  [ROLES.SUPERADMIN]: Object.freeze({
    canEditToday: true,
    canEditPast: true,
    canEditFuture: true,
  }),
});

const PRINCIPALS = Object.freeze({
  [ROLES.ADMIN]: 'meal-khata-admin',
  [ROLES.SUPERADMIN]: 'meal-khata-superadmin',
});

export function isAuthenticatedRole(role) {
  return AUTHENTICATED_ROLES.includes(role);
}

export function getRoleCapabilities(role) {
  return { ...(ROLE_CAPABILITIES[role] ?? ROLE_CAPABILITIES[ROLES.VIEWER]) };
}

export function getPrincipalForRole(role, memberId = null) {
  if (role === ROLES.MEMBER) {
    return memberId ? `member:${memberId}` : null;
  }
  return PRINCIPALS[role] ?? null;
}

export function roleMeetsRequirement(role, requiredRole) {
  return (ROLE_LEVELS[role] ?? -1) >= (ROLE_LEVELS[requiredRole] ?? Number.POSITIVE_INFINITY);
}

export function createViewerAuth() {
  return {
    authenticated: false,
    role: ROLES.VIEWER,
    memberId: null,
    principal: null,
  };
}

export function createAuthenticatedSession(role, { memberId = null, displayName = null, expiresAt = null } = {}) {
  const member = memberId ? MEMBERS.find((item) => item.id === memberId) : null;
  const defaultDisplayName = role === ROLES.ADMIN
    ? 'Household Admin'
    : role === ROLES.SUPERADMIN
    ? 'Super Admin'
    : (member ? member.name : null);
  const resolvedDisplayName = displayName || defaultDisplayName;

  return {
    authenticated: true,
    role,
    ...(role === ROLES.MEMBER && memberId
      ? { memberId, displayName: resolvedDisplayName ?? memberId }
      : resolvedDisplayName
      ? { displayName: resolvedDisplayName }
      : {}),
    ...(expiresAt ? { expiresAt } : {}),
    capabilities: getRoleCapabilities(role),
  };
}

export function createViewerSession() {
  return {
    authenticated: false,
    role: ROLES.VIEWER,
  };
}

