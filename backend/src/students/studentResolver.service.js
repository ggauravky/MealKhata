import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalDate } from '../utils/date.js';
import { STUDENT_STATUSES } from './student.constants.js';
import { studentRepository } from './student.repository.js';

function assertLogicalDate(date) {
  if (!isValidLogicalDate(date)) {
    throw new HttpError(400, 'Date must be a valid calendar date in YYYY-MM-DD format.');
  }
}

function isEligibleOn(student, date) {
  return student.status === STUDENT_STATUSES.ACTIVE
    && student.mealEligibilityFrom !== null
    && student.mealEligibilityFrom <= date
    && (student.mealEligibilityUntil === null || date <= student.mealEligibilityUntil);
}

export function createStudentResolver({ repository = studentRepository } = {}) {
  return Object.freeze({
    async listCurrent() {
      return repository.list({ status: STUDENT_STATUSES.ACTIVE });
    },

    async listAll() {
      return repository.list();
    },

    async listEligibleOn(date) {
      assertLogicalDate(date);
      const students = await repository.list({ status: STUDENT_STATUSES.ACTIVE });
      return students.filter((student) => isEligibleOn(student, date));
    },

    async assertKnown(studentId) {
      const student = await repository.findById(studentId);
      if (!student) throw new HttpError(404, 'Student was not found.');
      return student;
    },

    async assertEligible(studentId, date) {
      assertLogicalDate(date);
      const student = await repository.findById(studentId);
      if (!student) throw new HttpError(404, 'Student was not found.');
      if (!isEligibleOn(student, date)) {
        throw new HttpError(409, 'Student is not eligible for meals on this date.');
      }
      return student;
    },
  });
}

export const studentResolver = createStudentResolver();
