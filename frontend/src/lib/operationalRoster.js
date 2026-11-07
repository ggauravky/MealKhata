import { normalizeStudentList } from './studentContracts.js';

export function toOperationalRoster(students, { includeArchived = false } = {}) {
  return normalizeStudentList(students)
    .filter((student) => includeArchived || student.status === 'ACTIVE')
    .map((student) => ({ id: student.studentId, name: student.displayName, status: student.status }));
}

export function resolveDayParticipants(day, roster = []) {
  const mealIds = [
    ...Object.keys(day?.meals?.morning ?? day?.morning ?? {}),
    ...Object.keys(day?.meals?.night ?? day?.night ?? {}),
  ];
  const ids = day?.participantOrder?.length ? day.participantOrder : mealIds;
  const names = new Map(roster.map((student) => [student.id ?? student.studentId,
    student.name ?? student.displayName]));
  return [...new Set(ids)].map((id) => ({ id, name: names.get(id) || id }));
}

export function canEditMealParticipant({ editable, onChange, editableMemberIds, memberId }) {
  return Boolean(editable && onChange && Array.isArray(editableMemberIds)
    && editableMemberIds.includes(memberId));
}
