import { ROOMMATES } from './constants.js';

export function normalizeMemberRoster(rows) {
  const byMemberId = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row && typeof row.memberId === 'string')
      .map((row) => [row.memberId, row]),
  );

  return ROOMMATES.map((member) => {
    const row = byMemberId.get(member.id) || {};
    const sourceAccount = row.account && typeof row.account === 'object' ? row.account : null;
    const account = sourceAccount?.exists
      ? {
          exists: true,
          userId: sourceAccount.userId ?? null,
          email: sourceAccount.email ?? null,
          displayName: sourceAccount.displayName ?? null,
          role: sourceAccount.role ?? null,
          active: sourceAccount.active !== false,
          lastLoginAt: sourceAccount.lastLoginAt ?? null,
          passwordChangedAt: sourceAccount.passwordChangedAt ?? null,
          sessionVersion: sourceAccount.sessionVersion ?? 0,
        }
      : { exists: false };
    return {
      memberId: member.id,
      name: member.name,
      account,
      stay: row.stay && typeof row.stay === 'object' ? row.stay : null,
      room: row.room && typeof row.room === 'object' ? row.room : null,
    };
  });
}

export function buildMemberAccountPayload(action, values) {
  const currentPassword = typeof values?.currentPassword === 'string'
    ? values.currentPassword
    : '';
  if (action === 'email') {
    return {
      email: typeof values?.email === 'string' ? values.email.trim().toLowerCase() : '',
      currentPassword,
    };
  }
  if (action === 'password' || action === 'provision') {
    return {
      ...(action === 'provision'
        ? { email: typeof values?.email === 'string' ? values.email.trim().toLowerCase() : '' }
        : {}),
      newPassword: typeof values?.newPassword === 'string' ? values.newPassword : '',
      currentPassword,
    };
  }
  return { currentPassword };
}

export function buildStayCancellationPayload({ reason, revision }) {
  return {
    reason: typeof reason === 'string' ? reason.trim() : '',
    expectedRevision: revision,
  };
}
