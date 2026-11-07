function startDate(assignment) {
  return assignment?.effectiveFromDate || (
    assignment?.effectiveFromMonth ? `${assignment.effectiveFromMonth}-01` : null
  );
}

function endDate(assignment) {
  if (assignment?.effectiveUntilDate) return assignment.effectiveUntilDate;
  if (assignment?.effectiveUntilMonth) return `${assignment.effectiveUntilMonth}-31`;
  return null;
}

function newestFirst(left, right) {
  const byStart = (startDate(right) || '').localeCompare(startDate(left) || '');
  if (byStart !== 0) return byStart;

  const byAssignedAt = String(right?.assignedAt || '').localeCompare(String(left?.assignedAt || ''));
  if (byAssignedAt !== 0) return byAssignedAt;

  return String(right?.assignmentId || '').localeCompare(String(left?.assignmentId || ''));
}

function selectAssignment(assignments, memberId, rangeStart, rangeEnd) {
  const matches = (Array.isArray(assignments) ? assignments : []).filter((assignment) => {
    if (assignment?.memberId !== memberId) return false;
    if (assignment?.cancelledAt) return false;
    const from = startDate(assignment);
    const until = endDate(assignment);
    if (!from || from > rangeEnd) return false;
    return !until || until >= rangeStart;
  });

  return matches.sort(newestFirst)[0] || null;
}

export function selectAssignmentForMonth(assignments, memberId, month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return null;
  return selectAssignment(assignments, memberId, `${month}-01`, `${month}-31`);
}

export function selectAssignmentForDate(assignments, memberId, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  return selectAssignment(assignments, memberId, date, date);
}
