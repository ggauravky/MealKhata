import { Router } from 'express';

import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/authorize.js';
import { studentService } from '../students/student.service.js';
import { studentResolver } from '../students/studentResolver.service.js';
import { STUDENT_PROFILE_FIELDS } from '../students/student.constants.js';
import { assertSafeStudentId } from '../students/studentId.js';
import { HttpError } from '../utils/HttpError.js';

const CREATE_FIELDS = Object.freeze([...STUDENT_PROFILE_FIELDS, 'reason']);
const UPDATE_FIELDS = Object.freeze([...STUDENT_PROFILE_FIELDS, 'reason', 'expectedUpdatedAt']);
const ARCHIVE_FIELDS = Object.freeze(['reason', 'disableAccount', 'expectedUpdatedAt']);
const REACTIVATE_FIELDS = Object.freeze(['reason', 'expectedUpdatedAt']);

function assertPlainBody(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const unknown = Object.keys(body).filter((field) => !allowedFields.includes(field));
  if (unknown.length > 0) throw new HttpError(400, `Unknown request field: ${unknown[0]}.`);
}

function assertReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new HttpError(400, 'A reason is required for student changes.');
  }
}

function assertExpectedUpdatedAt(value) {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(new Date(value).getTime())) {
    throw new HttpError(400, 'expectedUpdatedAt must be a valid date-time string.');
  }
}

function assertProfileTypes(body) {
  if (
    Object.prototype.hasOwnProperty.call(body, 'displayName')
    && typeof body.displayName !== 'string'
  ) {
    throw new HttpError(400, 'displayName must be a string.');
  }
  for (const field of ['email', 'phone', 'mealEligibilityFrom', 'mealEligibilityUntil']) {
    if (
      Object.prototype.hasOwnProperty.call(body, field)
      && body[field] !== null
      && typeof body[field] !== 'string'
    ) {
      throw new HttpError(400, `${field} must be a string or null.`);
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(body, 'rosterOrder')
    && typeof body.rosterOrder !== 'number'
  ) {
    throw new HttpError(400, 'rosterOrder must be a number.');
  }
}

function parseStudentId(value) {
  try {
    return assertSafeStudentId(value);
  } catch {
    throw new HttpError(400, 'studentId is invalid.');
  }
}

function pickProfile(body) {
  return Object.fromEntries(
    STUDENT_PROFILE_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
      .map((field) => [field, body[field]]),
  );
}

function serializeStudent(student) {
  if (!student) return null;
  const fields = [
    'studentId',
    'displayName',
    'status',
    'email',
    'phone',
    'mealEligibilityFrom',
    'mealEligibilityUntil',
    'rosterOrder',
    'archivedAt',
    'archivedReason',
    'createdAt',
    'updatedAt',
  ];
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(student, field))
      .map((field) => [field, student[field]]),
  );
}

export function createStudentRouter({
  service = studentService,
  resolver = studentResolver,
} = {}) {
  const router = Router();

  router.get('/', requireAdminOrAbove, async (_req, res, next) => {
    try {
      const students = await resolver.listAll();
      return res.json({ success: true, data: students.map(serializeStudent) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:studentId', requireAdminOrAbove, async (req, res, next) => {
    try {
      const student = await resolver.assertKnown(parseStudentId(req.params.studentId));
      return res.json({ success: true, data: serializeStudent(student) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', requireSuperAdmin, async (req, res, next) => {
    try {
      assertPlainBody(req.body, CREATE_FIELDS);
      assertReason(req.body.reason);
      assertProfileTypes(req.body);
      const student = await service.createStudent({
        ...pickProfile(req.body),
        reason: req.body.reason,
        actor: req.auth,
      });
      return res.status(201).json({ success: true, data: serializeStudent(student) });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:studentId', requireSuperAdmin, async (req, res, next) => {
    try {
      assertPlainBody(req.body, UPDATE_FIELDS);
      assertReason(req.body.reason);
      assertExpectedUpdatedAt(req.body.expectedUpdatedAt);
      assertProfileTypes(req.body);
      const student = await service.updateStudent({
        studentId: parseStudentId(req.params.studentId),
        updates: pickProfile(req.body),
        reason: req.body.reason,
        expectedUpdatedAt: req.body.expectedUpdatedAt,
        actor: req.auth,
      });
      return res.json({ success: true, data: serializeStudent(student) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:studentId/archive', requireSuperAdmin, async (req, res, next) => {
    try {
      assertPlainBody(req.body, ARCHIVE_FIELDS);
      assertReason(req.body.reason);
      assertExpectedUpdatedAt(req.body.expectedUpdatedAt);
      if (
        Object.prototype.hasOwnProperty.call(req.body, 'disableAccount')
        && typeof req.body.disableAccount !== 'boolean'
      ) {
        throw new HttpError(400, 'disableAccount must be a boolean.');
      }
      const student = await service.archiveStudent({
        studentId: parseStudentId(req.params.studentId),
        reason: req.body.reason,
        disableAccount: req.body.disableAccount === true,
        expectedUpdatedAt: req.body.expectedUpdatedAt,
        actor: req.auth,
      });
      return res.json({ success: true, data: serializeStudent(student) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:studentId/reactivate', requireSuperAdmin, async (req, res, next) => {
    try {
      assertPlainBody(req.body, REACTIVATE_FIELDS);
      assertReason(req.body.reason);
      assertExpectedUpdatedAt(req.body.expectedUpdatedAt);
      const student = await service.reactivateStudent({
        studentId: parseStudentId(req.params.studentId),
        reason: req.body.reason,
        expectedUpdatedAt: req.body.expectedUpdatedAt,
        actor: req.auth,
      });
      return res.json({ success: true, data: serializeStudent(student) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const studentRouter = createStudentRouter();
