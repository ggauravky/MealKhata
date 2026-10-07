export const viewerSession = Object.freeze({
  authenticated: false,
  role: 'viewer',
  memberId: null,
  displayName: null,
  expiresAt: null,
  capabilities: Object.freeze({
    canEditToday: false,
    canEditPast: false,
    canEditFuture: false,
  }),
});

export function normalizeSession(session) {
  if (!session?.authenticated || !['member', 'admin', 'superadmin'].includes(session.role)) {
    return viewerSession;
  }

  const isMember = session.role === 'member';
  const memberId = isMember && typeof session.memberId === 'string' ? session.memberId : null;

  let displayName = null;
  if (typeof session.displayName === 'string' && session.displayName.trim().length > 0) {
    displayName = session.displayName;
  } else if (session.role === 'admin') {
    displayName = 'Household Admin';
  } else if (session.role === 'superadmin') {
    displayName = 'Super Admin';
  } else if (isMember && memberId) {
    displayName = memberId;
  }

  const expiresAt = typeof session.expiresAt === 'string' ? session.expiresAt : null;

  return {
    authenticated: true,
    role: session.role,
    memberId,
    displayName,
    expiresAt,
    capabilities: {
      canEditToday: Boolean(session.capabilities?.canEditToday),
      canEditPast: Boolean(session.capabilities?.canEditPast),
      canEditFuture: Boolean(session.capabilities?.canEditFuture),
    },
  };
}

export function isNetworkOrServerError(error) {
  if (!error) return false;
  return !error.status || error.status >= 500;
}
