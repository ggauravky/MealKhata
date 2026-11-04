export function canLoadMemberFinance({ month, authenticated, role, targetMemberId = null }) {
  return Boolean(month && authenticated && ((role === 'member' && !targetMemberId)
    || (targetMemberId && (role === 'admin' || role === 'superadmin'))));
}
