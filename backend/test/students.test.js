import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import {
  LEGACY_STUDENT_ELIGIBILITY_FIXTURES,
  STUDENT_AUDIT_EVENT_TYPES,
  STUDENT_STATUSES,
} from '../src/students/student.constants.js';
import { generateStudentId, assertSafeStudentId } from '../src/students/studentId.js';
import { Student } from '../src/students/student.model.js';
import { StudentAuditEvent } from '../src/students/studentAuditEvent.model.js';
import { createStudentRepository } from '../src/students/student.repository.js';
import { createStudentService } from '../src/students/student.service.js';
import { createStudentResolver } from '../src/students/studentResolver.service.js';
import { createStudentRouter } from '../src/routes/student.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createApp } from '../src/app.js';
import { InMemoryStudentRepository } from './helpers/inMemoryStudentRepository.js';
import { InMemoryUserAccountRepository } from './helpers/inMemoryUserAccountRepository.js';

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

const superAdmin = Object.freeze({ role: 'superadmin', userId: 'root-1' });
const generatedStudentId = 'student_00000000000000000000000000000001';

function createLifecycleHarness(initialStudents = []) {
  const repository = new InMemoryStudentRepository(initialStudents);
  const accounts = new InMemoryUserAccountRepository();
  const service = createStudentService({
    repository,
    accounts,
    now: () => new Date('2026-10-29T06:30:00.000Z'),
    generateId: () => generatedStudentId,
  });
  const resolver = createStudentResolver({ repository });
  return { accounts, repository, resolver, service };
}

describe('MealKhata 3.0 audited student lifecycle and date-aware resolver', () => {
  test('creates and edits a generated student with actor/reason audit evidence', async () => {
    const { repository, service } = createLifecycleHarness();

    const created = await service.createStudent({
      displayName: ' Fourth Student ',
      email: ' FOURTH@Example.com ',
      phone: '+91 90000 00004',
      mealEligibilityFrom: '2026-10-29',
      rosterOrder: 40,
      actor: superAdmin,
      reason: 'Verified new admission identity',
    });
    assert.equal(created.studentId, generatedStudentId);
    assert.equal(created.displayName, 'Fourth Student');
    assert.equal(created.email, 'fourth@example.com');

    const originalUpdatedAt = created.updatedAt;
    const updated = await service.updateStudent({
      studentId: generatedStudentId,
      updates: { displayName: 'Fourth Student Updated', email: 'updated@example.com' },
      expectedUpdatedAt: originalUpdatedAt,
      actor: superAdmin,
      reason: 'Correct verified profile',
    });
    assert.equal(updated.displayName, 'Fourth Student Updated');
    assert.equal(updated.email, 'updated@example.com');

    const auditRows = [...repository.auditEvents.values()];
    assert.equal(auditRows.length, 2);
    assert.equal(auditRows[0].eventType, STUDENT_AUDIT_EVENT_TYPES.CREATED);
    assert.equal(auditRows[1].eventType, STUDENT_AUDIT_EVENT_TYPES.PROFILE_UPDATED);
    assert.equal(auditRows[1].actorUserId, 'root-1');
    assert.equal(auditRows[1].reason, 'Correct verified profile');
  });

  test('keeps a stable roster order and has no hard-delete lifecycle method', async () => {
    const students = [
      { ...baseStudent, studentId: 'gaurav', rosterOrder: 30 },
      { ...baseStudent, studentId: 'nikhil', displayName: 'Nikhil', email: null, phone: null, rosterOrder: 10 },
      { ...baseStudent, studentId: 'devansh', displayName: 'Devansh', email: null, phone: null, rosterOrder: 20 },
    ];
    const { resolver, service } = createLifecycleHarness(students);

    assert.deepEqual(
      (await resolver.listCurrent()).map((student) => student.studentId),
      ['nikhil', 'devansh', 'gaurav'],
    );
    assert.equal('deleteStudent' in service, false);
    assert.equal('delete' in service, false);
  });

  test('uses only the confirmed Gaurav date and applies inclusive eligibility boundaries', async () => {
    assert.deepEqual(LEGACY_STUDENT_ELIGIBILITY_FIXTURES, {
      gaurav: '2026-10-01',
      nikhil: null,
      devansh: null,
    });
    const students = [
      {
        ...baseStudent,
        studentId: 'gaurav',
        mealEligibilityFrom: LEGACY_STUDENT_ELIGIBILITY_FIXTURES.gaurav,
        mealEligibilityUntil: '2026-10-31',
      },
      {
        ...baseStudent,
        studentId: 'nikhil',
        displayName: 'Nikhil',
        email: null,
        phone: null,
        mealEligibilityFrom: LEGACY_STUDENT_ELIGIBILITY_FIXTURES.nikhil,
      },
      {
        ...baseStudent,
        studentId: 'devansh',
        displayName: 'Devansh',
        email: null,
        phone: null,
        mealEligibilityFrom: LEGACY_STUDENT_ELIGIBILITY_FIXTURES.devansh,
      },
    ];
    const { resolver } = createLifecycleHarness(students);

    assert.deepEqual(await resolver.listEligibleOn('2026-09-30'), []);
    assert.deepEqual(
      (await resolver.listEligibleOn('2026-10-01')).map((student) => student.studentId),
      ['gaurav'],
    );
    assert.deepEqual(
      (await resolver.listEligibleOn('2026-10-31')).map((student) => student.studentId),
      ['gaurav'],
    );
    assert.deepEqual(await resolver.listEligibleOn('2026-11-01'), []);
    await assert.rejects(
      resolver.assertEligible('nikhil', '2026-10-29'),
      (error) => Reflect.get(Object(error), 'statusCode') === 409,
    );
  });

  test('archives without deleting history, optionally disables account, and never re-enables it implicitly', async () => {
    const { accounts, repository, resolver, service } = createLifecycleHarness([baseStudent]);
    await accounts.create({
      userId: 'user-gaurav',
      memberId: 'gaurav',
      displayName: 'Gaurav Kumar',
      email: 'login@example.com',
      passwordHash: 'test-only-hash',
      role: 'member',
      active: true,
      sessionVersion: 3,
    });

    const archived = await service.archiveStudent({
      studentId: 'gaurav',
      reason: 'Left operational roster',
      disableAccount: true,
      expectedUpdatedAt: (await repository.findById('gaurav')).updatedAt,
      actor: superAdmin,
    });
    assert.equal(archived.status, STUDENT_STATUSES.ARCHIVED);
    assert.deepEqual(await resolver.listCurrent(), []);
    assert.equal((await resolver.assertKnown('gaurav')).displayName, 'Gaurav Kumar');
    assert.equal((await resolver.listAll()).length, 1);
    const disabledAccount = await accounts.findByMemberId('gaurav');
    assert.equal(disabledAccount.active, false);
    assert.equal(disabledAccount.sessionVersion, 4);

    const reactivated = await service.reactivateStudent({
      studentId: 'gaurav',
      reason: 'Approved return to roster',
      expectedUpdatedAt: archived.updatedAt,
      actor: superAdmin,
    });
    assert.equal(reactivated.status, STUDENT_STATUSES.ACTIVE);
    assert.equal((await accounts.findByMemberId('gaurav')).active, false);
    const auditRows = [...repository.auditEvents.values()];
    assert.equal(auditRows.at(-2).reason, 'Left operational roster');
    assert.equal(auditRows.at(-1).reason, 'Approved return to roster');
  });

  test('leaves an account active when archive account-disable is not requested', async () => {
    const { accounts, repository, service } = createLifecycleHarness([baseStudent]);
    await accounts.create({
      userId: 'user-gaurav',
      memberId: 'gaurav',
      displayName: 'Gaurav Kumar',
      email: 'login@example.com',
      passwordHash: 'test-only-hash',
      role: 'member',
      active: true,
      sessionVersion: 0,
    });

    await service.archiveStudent({
      studentId: 'gaurav',
      reason: 'Archive profile only',
      disableAccount: false,
      expectedUpdatedAt: (await repository.findById('gaurav')).updatedAt,
      actor: superAdmin,
    });
    const account = await accounts.findByMemberId('gaurav');
    assert.equal(account.active, true);
    assert.equal(account.sessionVersion, 0);
  });

  test('maps duplicate contacts and stale concurrent writes to conflicts', async () => {
    const { repository, service } = createLifecycleHarness([baseStudent]);

    await assert.rejects(
      service.createStudent({
        displayName: 'Duplicate Email',
        email: 'gaurav@example.com',
        phone: '+91 90000 00005',
        mealEligibilityFrom: null,
        rosterOrder: 50,
        actor: superAdmin,
        reason: 'Test duplicate',
      }),
      (error) => Reflect.get(Object(error), 'statusCode') === 409,
    );
    await assert.rejects(
      service.createStudent({
        displayName: 'Duplicate Phone',
        email: 'unique@example.com',
        phone: '+91 98765 43210',
        mealEligibilityFrom: null,
        rosterOrder: 51,
        actor: superAdmin,
        reason: 'Test duplicate phone',
      }),
      (error) => Reflect.get(Object(error), 'statusCode') === 409,
    );

    const staleUpdatedAt = (await repository.findById('gaurav')).updatedAt;
    await service.updateStudent({
      studentId: 'gaurav',
      updates: { displayName: 'First valid update' },
      expectedUpdatedAt: staleUpdatedAt,
      actor: superAdmin,
      reason: 'First editor',
    });
    await assert.rejects(
      service.updateStudent({
        studentId: 'gaurav',
        updates: { displayName: 'Stale second update' },
        expectedUpdatedAt: staleUpdatedAt,
        actor: superAdmin,
        reason: 'Second editor',
      }),
      (error) => Reflect.get(Object(error), 'statusCode') === 409,
    );
  });
});

function createStudentApi(role, { service, resolver } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      authenticated: role !== 'viewer',
      role,
      userId: `${role}-1`,
    };
    next();
  });
  app.use('/api/students', createStudentRouter({
    service: service ?? {
      async createStudent(input) { return { studentId: generatedStudentId, ...input, status: 'ACTIVE' }; },
      async updateStudent({ studentId, updates }) { return { studentId, ...updates, status: 'ACTIVE' }; },
      async archiveStudent({ studentId }) { return { studentId, status: 'ARCHIVED' }; },
      async reactivateStudent({ studentId }) { return { studentId, status: 'ACTIVE' }; },
    },
    resolver: resolver ?? {
      async listAll() { return [{ ...baseStudent, passwordHash: 'must-not-leak', _id: 'internal-id' }]; },
      async assertKnown(studentId) { return { ...baseStudent, studentId, secret: 'must-not-leak' }; },
    },
  }));
  app.use(errorHandler);
  return app;
}

describe('MealKhata 3.0 student API and authorization', () => {
  test('allows Admin/Super Admin reads, rejects lower roles, and serializes only public fields', async () => {
    const adminList = await request(createStudentApi('admin')).get('/api/students').expect(200);
    assert.equal(adminList.body.success, true);
    assert.equal(adminList.body.data[0].studentId, 'gaurav');
    assert.equal(JSON.stringify(adminList.body).includes('passwordHash'), false);
    assert.equal(JSON.stringify(adminList.body).includes('internal-id'), false);

    const superDetail = await request(createStudentApi('superadmin'))
      .get('/api/students/gaurav')
      .expect(200);
    assert.equal(superDetail.body.data.studentId, 'gaurav');
    assert.equal(JSON.stringify(superDetail.body).includes('must-not-leak'), false);

    await request(createStudentApi('member')).get('/api/students').expect(403);
    await request(createStudentApi('viewer')).get('/api/students').expect(401);
  });

  test('registers /api/students in the application router', async () => {
    const students = createStudentRouter({
      service: {},
      resolver: { async listAll() { return []; } },
    });
    const app = createApp({
      students,
      authenticate(req, _res, next) {
        req.auth = { authenticated: true, role: 'admin', userId: 'admin-1' };
        next();
      },
    });
    const response = await request(app).get('/api/students').expect(200);
    assert.deepEqual(response.body, { success: true, data: [] });
  });

  test('allows only Super Admin mutations and forwards archive account-disable explicitly', async () => {
    let adminCalls = 0;
    const admin = createStudentApi('admin', {
      service: {
        async createStudent() {
          adminCalls += 1;
          return {};
        },
      },
    });
    await request(admin)
      .post('/api/students')
      .send({ displayName: 'Fourth', rosterOrder: 40, reason: 'Create' })
      .expect(403);
    assert.equal(adminCalls, 0);

    let archiveInput;
    const superAdminApi = createStudentApi('superadmin', {
      service: {
        async archiveStudent(input) {
          archiveInput = input;
          return { studentId: input.studentId, status: 'ARCHIVED' };
        },
      },
    });
    await request(superAdminApi)
      .post('/api/students/gaurav/archive')
      .send({
        reason: 'Confirmed departure',
        disableAccount: true,
        expectedUpdatedAt: '2026-10-29T06:00:00.000Z',
      })
      .expect(200);
    assert.equal(archiveInput.disableAccount, true);
    assert.equal(archiveInput.actor.role, 'superadmin');
  });

  test('rejects unknown fields, object injection, malformed archive input, and duplicate contacts', async () => {
    const strictApi = createStudentApi('superadmin');
    await request(strictApi)
      .post('/api/students')
      .send({ displayName: 'Fourth', rosterOrder: 40, reason: 'Create', passwordHash: 'injected' })
      .expect(400);
    await request(strictApi)
      .post('/api/students')
      .send({ displayName: { $ne: '' }, rosterOrder: 40, reason: 'Create' })
      .expect(400);
    await request(strictApi)
      .patch('/api/students/gaurav')
      .send({ status: 'ARCHIVED', reason: 'Injection', expectedUpdatedAt: '2026-10-29T06:00:00.000Z' })
      .expect(400);
    await request(strictApi)
      .post('/api/students/gaurav/archive')
      .send({ disableAccount: 'yes', expectedUpdatedAt: '2026-10-29T06:00:00.000Z' })
      .expect(400);

    const { resolver, service } = createLifecycleHarness([baseStudent]);
    const duplicateApi = createStudentApi('superadmin', { resolver, service });
    const duplicate = await request(duplicateApi)
      .post('/api/students')
      .send({
        displayName: 'Duplicate Contact',
        email: 'gaurav@example.com',
        phone: null,
        mealEligibilityFrom: null,
        mealEligibilityUntil: null,
        rosterOrder: 50,
        reason: 'Attempt duplicate contact',
      })
      .expect(409);
    assert.match(duplicate.body.message, /already assigned/i);
  });

  test('supports create, patch, archive, and reactivate response envelopes', async () => {
    const api = createStudentApi('superadmin');
    const created = await request(api)
      .post('/api/students')
      .send({ displayName: 'Fourth', email: null, phone: null, mealEligibilityFrom: null, mealEligibilityUntil: null, rosterOrder: 40, reason: 'Create' })
      .expect(201);
    assert.equal(created.body.success, true);

    await request(api)
      .patch(`/api/students/${generatedStudentId}`)
      .send({ displayName: 'Fourth Updated', reason: 'Correction', expectedUpdatedAt: '2026-10-29T06:00:00.000Z' })
      .expect(200);
    await request(api)
      .post(`/api/students/${generatedStudentId}/archive`)
      .send({ reason: 'Archive', disableAccount: false, expectedUpdatedAt: '2026-10-29T06:00:00.000Z' })
      .expect(200);
    await request(api)
      .post(`/api/students/${generatedStudentId}/reactivate`)
      .send({ reason: 'Reactivate', expectedUpdatedAt: '2026-10-29T06:00:00.000Z' })
      .expect(200);
  });

  test('sanitizes unexpected service failures', async () => {
    const api = createStudentApi('admin', {
      resolver: {
        async listAll() {
          throw new Error('mongodb://secret-user:secret-password@production.example');
        },
      },
    });
    const response = await request(api).get('/api/students').expect(500);
    assert.equal(response.body.message, 'Something went wrong');
    assert.equal(JSON.stringify(response.body).includes('secret-password'), false);
  });
});
