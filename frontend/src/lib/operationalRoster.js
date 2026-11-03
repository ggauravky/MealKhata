import { normalizeStudentList } from './studentContracts.js';

export function toOperationalRoster(students, { includeArchived = false } = {}) {
  return normalizeStudentList(students)
    .filter((student) => includeArchived || student.status === 'ACTIVE')
    .map((student) => ({ id: student.studentId, name: student.displayName, status: student.status }));
}
