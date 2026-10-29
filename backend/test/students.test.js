import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  STUDENT_AUDIT_EVENT_TYPES,
  STUDENT_STATUSES,
} from '../src/students/student.constants.js';
import { generateStudentId, assertSafeStudentId } from '../src/students/studentId.js';
import { Student } from '../src/students/student.model.js';
import { StudentAuditEvent } from '../src/students/studentAuditEvent.model.js';
import { createStudentRepository } from '../src/students/student.repository.js';
import { InMemoryStudentRepository } from './helpers/inMemoryStudentRepository.js';

const baseStudent = Object.freeze({
  studentId: 'gaurav',
  displayName: 'Gaurav Kumar',
  status: STUDENT_STATUSES.ACTIVE,
  email: ' Gaurav@Example.com ',
  phone: '+91 98765 43210',
  mealEligibilityFrom: '2026-01-01',
  mealEligibilityUntil: null,
  rosterOrder: 10,
});

describe('MealKhata 3.0 authoritative student persistence', () => {
  test('generates unique immutable-key-safe IDs and accepts the historical IDs', () => {
    const first = generateStudentId();
    const second = generateStudentId();

    assert.match(first, /^student_[0-9a-f]{32}$/);
    assert.match(second, /^student_[0-9a-f]{32}$/);
    assert.notEqual(first, second);
    assert.equal(assertSafeStudentId(first), first);
    for (const historicalId of ['gaurav', 'nikhil', 'devansh']) {
      assert.equal(assertSafeStudentId(historicalId), historicalId);
    }
  });

  test('rejects IDs that are unsafe for Mongo keys or JavaScript maps', () => {
    const unsafeIds = [
      '',
      ' student_id',
      'student_id ',
      'student.id',
      '$student',
      'student\0id',
      `student\u202Eid`,
      '__proto__',
      'constructor',
      'prototype',
      42,
    ];

    for (const unsafeId of unsafeIds) {
      assert.throws(() => assertSafeStudentId(unsafeId), /studentId/i);
    }
  });

  test('defines strict student and audit schemas with immutable unique identities and contact indexes', () => {
    assert.equal(Student.schema.options.collection, 'students');
    assert.equal(Student.schema.options.strict, 'throw');
    assert.equal(Student.schema.path('studentId').options.immutable, true);
    assert.equal(Student.schema.path('studentId').options.unique, true);
    assert.equal(StudentAuditEvent.schema.options.collection, 'student_audit_events');
    assert.equal(StudentAuditEvent.schema.options.strict, 'throw');

    const indexes = Student.schema.indexes();
    assert.ok(indexes.some(([fields, options]) => fields.studentId === 1 && options.unique));
    assert.ok(indexes.some(([fields, options]) => fields.email === 1 && options.unique));
    assert.ok(indexes.some(([fields, options]) => fields.phone === 1 && options.unique));
  });

  test('exports a Mongo repository with the complete persistence interface', () => {
    const repository = createStudentRepository();
    for (const method of [
      'create',
      'findById',
      'list',
      'updateProfile',
      'transitionStatus',
      'createAuditEvent',
    ]) {
      assert.equal(typeof repository[method], 'function', `${method} must be implemented`);
    }
  });

  test('Mongo persistence normalizes email and enforces the unique immutable student ID', async () => {
    const database = await MongoMemoryServer.create();
    try {
      await mongoose.connect(database.getUri(), { dbName: 'mealkhata-v3-task1-isolated' });
      await Promise.all([Student.syncIndexes(), StudentAuditEvent.syncIndexes()]);
      const repository = createStudentRepository();

      const created = await repository.create(baseStudent);
      assert.equal(created.email, 'gaurav@example.com');
      await assert.rejects(
        repository.create({ ...baseStudent, displayName: 'Duplicate identity' }),
        (error) => Reflect.get(Object(error), 'code') === 11000,
      );
    } finally {
      await mongoose.disconnect();
      await database.stop();
    }
  });

  test('normalizes profile email, rejects duplicate IDs, and returns detached values', async () => {
    const repository = new InMemoryStudentRepository();
    const created = await repository.create(baseStudent);

    assert.equal(created.email, 'gaurav@example.com');
    created.displayName = 'Mutated outside repository';
    assert.equal((await repository.findById('gaurav')).displayName, 'Gaurav Kumar');

    await assert.rejects(
      repository.create({ ...baseStudent, displayName: 'Duplicate identity' }),
      (error) => (
        Reflect.get(Object(error), 'code') === 11000
        && Reflect.get(Object(Reflect.get(Object(error), 'keyPattern')), 'studentId') === 1
      ),
    );
  });

  test('updates allow-listed profile fields and persists archive/reactivation transitions', async () => {
    const repository = new InMemoryStudentRepository();
    await repository.create(baseStudent);

    const updated = await repository.updateProfile('gaurav', {
      displayName: 'Gaurav K.',
      email: ' NEW@Example.com ',
      mealEligibilityUntil: '2026-12-31',
    });
    assert.equal(updated.displayName, 'Gaurav K.');
    assert.equal(updated.email, 'new@example.com');
    assert.equal(updated.mealEligibilityUntil, '2026-12-31');

    const archivedAt = new Date('2026-10-29T06:00:00.000Z');
    const archived = await repository.transitionStatus('gaurav', {
      status: STUDENT_STATUSES.ARCHIVED,
      archivedAt,
      archivedReason: 'Left current operational roster',
    });
    assert.equal(archived.status, STUDENT_STATUSES.ARCHIVED);
    assert.deepEqual(archived.archivedAt, archivedAt);

    const reactivated = await repository.transitionStatus('gaurav', {
      status: STUDENT_STATUSES.ACTIVE,
    });
    assert.equal(reactivated.status, STUDENT_STATUSES.ACTIVE);
    assert.equal(reactivated.archivedAt, null);
    assert.equal(reactivated.archivedReason, null);
  });

  test('audit persistence excludes unknown and secret fields from before/after payloads', async () => {
    const repository = new InMemoryStudentRepository();
    await repository.create(baseStudent);

    const event = await repository.createAuditEvent({
      auditId: 'student_audit_1',
      studentId: 'gaurav',
      eventType: STUDENT_AUDIT_EVENT_TYPES.PROFILE_UPDATED,
      actorUserId: 'root-1',
      actorRole: 'superadmin',
      occurredAt: new Date('2026-10-29T06:05:00.000Z'),
      reason: 'Correct profile details',
      passwordHash: 'must-never-be-persisted',
      unknown: 'must-never-be-persisted',
      before: {
        displayName: 'Gaurav Kumar',
        email: 'gaurav@example.com',
        phone: { token: 'nested-secret-before' },
        passwordHash: 'secret-before',
        unknown: 'before-unknown',
      },
      after: {
        displayName: 'Gaurav K.',
        email: 'new@example.com',
        token: 'secret-after',
        unknown: 'after-unknown',
      },
    });

    assert.deepEqual(event.before, {
      displayName: 'Gaurav Kumar',
      email: 'gaurav@example.com',
    });
    assert.deepEqual(event.after, {
      displayName: 'Gaurav K.',
      email: 'new@example.com',
    });
    assert.equal('passwordHash' in event, false);
    assert.equal('unknown' in event, false);
    assert.equal(JSON.stringify(event).includes('secret'), false);
  });
});
