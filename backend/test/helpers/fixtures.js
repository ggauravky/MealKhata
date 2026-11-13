/**
 * Generic student identities used only by automated tests. The application itself has no
 * built-in students; every runtime roster comes from the `students` collection.
 */
export const TEST_STUDENTS = Object.freeze([
  Object.freeze({ id: 'gaurav', name: 'Gaurav' }),
  Object.freeze({ id: 'nikhil', name: 'Nikhil' }),
  Object.freeze({ id: 'devansh', name: 'Devansh' }),
]);
export const MEMBER_IDS = Object.freeze(TEST_STUDENTS.map(({ id }) => id));
export const MEMBER_NAMES = Object.freeze(Object.fromEntries(TEST_STUDENTS.map(({ id, name }) => [id, name])));

/** A student directory over a fixed list of ids, with no eligibility restrictions. */
export function createFixedStudentDirectory(ids = MEMBER_IDS) {
  const students = ids.map((studentId, index) => ({
    studentId, displayName: MEMBER_NAMES[studentId] ?? studentId, status: 'ACTIVE',
    mealEligibilityFrom: null, mealEligibilityUntil: null, rosterOrder: (index + 1) * 10,
    archivedAt: null, archivedReason: null,
  }));
  return Object.freeze({
    async listAll() { return structuredClone(students); },
    async listCurrent() { return structuredClone(students); },
    async listEligibleOn() { return structuredClone(students); },
    async assertKnown(studentId) {
      const student = students.find((candidate) => candidate.studentId === studentId);
      if (!student) throw Object.assign(new Error('Unknown student'), { statusCode: 404 });
      return structuredClone(student);
    },
  });
}

/**
 * Test directory whose roster is every student that has a room assignment in the given
 * repository. Mirrors fixtures where students exist only through their assignments.
 */
export function createAssignmentStudentDirectory(repository) {
  const list = async () => {
    const assignments = await repository.findAllAssignments?.() ?? [];
    return [...new Set(assignments.map((assignment) => assignment.memberId))].sort()
      .map((studentId, index) => ({ studentId, displayName: studentId, status: 'ACTIVE',
        mealEligibilityFrom: null, mealEligibilityUntil: null, rosterOrder: (index + 1) * 10,
        archivedAt: null, archivedReason: null }));
  };
  return Object.freeze({
    listAll: list,
    listCurrent: list,
    listEligibleOn: list,
    async assertKnown(studentId) { return { studentId, displayName: studentId, status: 'ACTIVE' }; },
  });
}
export const MEMBERS = TEST_STUDENTS;
