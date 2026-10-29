import { randomUUID } from 'node:crypto';

import { MAX_STUDENT_ID_LENGTH } from './student.constants.js';

const SAFE_STUDENT_ID_PATTERN = /^[a-z0-9_-]+$/;
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function assertSafeStudentId(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_STUDENT_ID_LENGTH
    || value !== value.trim()
    || !SAFE_STUDENT_ID_PATTERN.test(value)
    || value.includes('.')
    || value.includes('$')
    || RESERVED_OBJECT_KEYS.has(value)
  ) {
    throw new TypeError('studentId must be a safe lowercase Mongo key identifier');
  }

  return value;
}

export function generateStudentId() {
  return `student_${randomUUID().replaceAll('-', '')}`;
}
