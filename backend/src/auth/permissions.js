export const ROLES = Object.freeze({
  VIEWER: 'viewer',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
});

export const AUTHENTICATED_ROLES = Object.freeze([ROLES.ADMIN, ROLES.SUPERADMIN]);

const ROLE_LEVELS = Object.freeze({
  [ROLES.VIEWER]: 0,
  [ROLES.ADMIN]: 1,
  [ROLES.SUPERADMIN]: 2,
});

const ROLE_CAPABILITIES = Object.freeze({
  [ROLES.VIEWER]: Object.freeze({
    canEditToday: false,
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

export function getPrincipalForRole(role) {
  return PRINCIPALS[role] ?? null;
}

export function roleMeetsRequirement(role, requiredRole) {
  return (ROLE_LEVELS[role] ?? -1) >= (ROLE_LEVELS[requiredRole] ?? Number.POSITIVE_INFINITY);
}

export function createViewerAuth() {
  return {
    authenticated: false,
    role: ROLES.VIEWER,
    principal: null,
  };
}

export function createAuthenticatedSession(role) {
  return {
    authenticated: true,
    role,
    capabilities: getRoleCapabilities(role),
  };
}

export function createViewerSession() {
  return {
    authenticated: false,
    role: ROLES.VIEWER,
  };
}
