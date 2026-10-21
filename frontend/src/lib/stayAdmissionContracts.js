function assignmentStart(assignment) {
  return assignment?.effectiveFromDate || (
    assignment?.effectiveFromMonth ? `${assignment.effectiveFromMonth}-01` : null
  );
}

function assignmentEnd(assignment) {
  return assignment?.effectiveUntilDate || (
    assignment?.effectiveUntilMonth ? `${assignment.effectiveUntilMonth}-31` : null
  );
}

export function selectExistingAssignmentForAdmission(assignments, joinedOn) {
  const valid = (Array.isArray(assignments) ? assignments : [])
    .filter((assignment) => assignment && !assignment.cancelledAt && assignmentStart(assignment))
    .sort((left, right) => assignmentStart(right).localeCompare(assignmentStart(left)));
  const covering = valid.find((assignment) => (
    assignmentStart(assignment) <= joinedOn
    && (!assignmentEnd(assignment) || joinedOn <= assignmentEnd(assignment))
  ));
  return covering || valid.find((assignment) => !assignmentEnd(assignment)) || null;
}

export function buildStayAdmissionPayload({
  memberId,
  joinedOn,
  initialRoomId,
  assignment = null,
  allowUnverifiedPreAssignmentPeriod = false,
  historicalReason = '',
  monthlyFeePaise,
  expectedDepositPaise = 0,
}) {
  return {
    memberId,
    joinedOn,
    initialRoomId,
    admissionMode: assignment ? 'link_existing_assignment' : 'new_assignment',
    ...(assignment ? { assignmentId: assignment.assignmentId } : {}),
    ...(assignment && allowUnverifiedPreAssignmentPeriod ? { allowUnverifiedPreAssignmentPeriod: true } : {}),
    ...(historicalReason ? { historicalReason } : {}),
    ...(Number.isSafeInteger(monthlyFeePaise) ? { monthlyFeePaise } : {}),
    expectedDepositPaise,
  };
}
