export function normalizeMemberRoster(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row.memberId === 'string' && row.memberId.trim())
    .map((row) => {
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
        memberId: row.memberId,
        name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : row.memberId,
        status: row.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
        mealEligibilityFrom: row.mealEligibilityFrom ?? null,
        mealEligibilityUntil: row.mealEligibilityUntil ?? null,
        rosterOrder: Number.isSafeInteger(row.rosterOrder) ? row.rosterOrder : 0,
        archivedAt: row.archivedAt ?? null,
        archivedReason: row.archivedReason ?? null,
        account,
        stay: row.stay && typeof row.stay === 'object' ? row.stay : null,
        room: row.room && typeof row.room === 'object' ? row.room : null,
        assignment: row.assignment && typeof row.assignment === 'object' ? row.assignment : null,
        feePlan: row.feePlan && typeof row.feePlan === 'object' ? row.feePlan : null,
      };
    });
}

export function getMemberRosterMetrics(rows) {
  const roster = Array.isArray(rows) ? rows : [];
  const assigned = roster.filter((member) => member.assignment && member.room);
  const activeStays = roster.filter((member) => (
    member.stay && ['ACTIVE', 'CHECKOUT_REQUESTED', 'CHECKOUT_PENDING'].includes(member.stay.status)
  ));

  return {
    members: roster.length,
    currentlyAssignedResidents: assigned.length,
    assignedRooms: new Set(assigned.map((member) => member.room.roomId)).size,
    activeRegisteredStays: activeStays.length,
    membersNeedingStayRegistration: assigned.filter((member) => !member.stay).length,
  };
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
