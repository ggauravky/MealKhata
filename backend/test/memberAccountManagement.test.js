import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';

import { createAuthService } from '../src/auth/auth.service.js';
import { UserAccount } from '../src/auth/userAccount.model.js';
import { createSessionToken, verifySessionToken } from '../src/auth/token.service.js';
import { MemberAccountAudit } from '../src/members/memberAccountAudit.model.js';
import { createMemberAccountService } from '../src/members/memberAccount.service.js';
import { createMemberService } from '../src/members/member.service.js';
import { createMemberRouter } from '../src/routes/member.routes.js';
import { createStudentResolver } from '../src/students/studentResolver.service.js';
import { verifyIndexes } from '../scripts/verifyIndexes.js';
import { InMemoryMemberAccountRepository } from './helpers/inMemoryMemberAccountRepository.js';
import { InMemoryStudentRepository } from './helpers/inMemoryStudentRepository.js';
import { InMemoryUserAccountRepository } from './helpers/inMemoryUserAccountRepository.js';

const GENERATED_STUDENT_ID = 'student_0123456789abcdef0123456789abcdef';

function student(studentId, displayName, rosterOrder) {
  return {
    studentId,
    displayName,
    rosterOrder,
    mealEligibilityFrom: '2026-10-01',
  };
}

async function createHarness({
  initialStudents = [
    student('gaurav', 'Gaurav', 0),
    student('nikhil', 'Nikhil', 1),
    student('devansh', 'Devansh', 2),
    student(GENERATED_STUDENT_ID, 'Aarav Sen', 3),
  ],
} = {}) {
  const accounts = new InMemoryUserAccountRepository();
  const legacyAccounts = new InMemoryMemberAccountRepository();
  const students = new InMemoryStudentRepository(initialStudents);
  const resolver = createStudentResolver({ repository: students });
  const auditEvents = [];
  const audits = {
    async create(event) {
      auditEvents.push(structuredClone(event));
      return event;
    },
  };
  const verifyActorPassword = async ({ password }) => {
    if (password !== 'admin-pass') {
      const error = new Error('Recent Super Admin authentication is required.');
      error.statusCode = 401;
      throw error;
    }
  };
  const service = createMemberAccountService({
    accounts,
    legacyAccounts,
    audits,
    resolver,
    verifyActorPassword,
    now: () => new Date('2026-10-20T06:30:00.000Z'),
  });
  return { accounts, legacyAccounts, students, resolver, auditEvents, service };
}

describe('Super Admin member account management', () => {
  test('canonical account and audit schemas accept safe dynamic student IDs and keep the unique link index', async () => {
    const passwordHash = await bcrypt.hash('SchemaStrong!234', 12);
    const account = new UserAccount({
      userId: 'user-schema-aarav',
      memberId: GENERATED_STUDENT_ID,
      displayName: 'Aarav Sen',
      email: 'schema.aarav@example.com',
      passwordHash,
      role: 'member',
    });
    const audit = new MemberAccountAudit({
      auditId: 'audit-schema-aarav',
      memberId: GENERATED_STUDENT_ID,
      event: 'MEMBER_ACCOUNT_PROVISIONED',
      actorUserId: 'root-1',
      actorRole: 'superadmin',
      occurredAt: new Date('2026-10-20T06:30:00.000Z'),
    });

    await account.validate();
    await audit.validate();
    const memberIndex = UserAccount.schema.indexes().find(([keys]) => keys.memberId === 1);
    assert.equal(memberIndex?.[1].unique, true);
    assert.deepEqual(memberIndex?.[1].partialFilterExpression, { memberId: { $type: 'string' } });

    account.memberId = 'unsafe.student';
    audit.memberId = '$unsafe';
    await assert.rejects(account.validate(), /memberId/);
    await assert.rejects(audit.validate(), /memberId/);
  });

  test('index verification covers canonical account-to-student links and account audits', async () => {
    const connection = {
      db: {
        collection() {
          return { indexes: async () => [{ key: { _id: 1 } }] };
        },
      },
    };

    const { results } = await verifyIndexes(connection);
    const account = results.find((result) => result.model === 'UserAccount');
    const audit = results.find((result) => result.model === 'MemberAccountAudit');
    assert.ok(account?.missing.includes('memberId:1'));
    assert.ok(audit?.missing.includes('memberId:1'));
  });

  test('provisions and authenticates a generated fourth student without exposing credentials', async () => {
    const { service, accounts, legacyAccounts, resolver, auditEvents } = await createHarness();
    const provisioned = await service.provisionAccount({
      memberId: GENERATED_STUDENT_ID,
      email: ' Aarav@Example.com ',
      newPassword: 'FourthStrong!234',
      currentPassword: 'admin-pass',
      actor: { role: 'superadmin', userId: 'root-1' },
    });

    assert.equal(provisioned.memberId, GENERATED_STUDENT_ID);
    assert.equal(provisioned.displayName, 'Aarav Sen');
    assert.equal('passwordHash' in provisioned, false);
    assert.equal(JSON.stringify(auditEvents).includes('FourthStrong!234'), false);

    const auth = createAuthService({ userAccounts: accounts, accounts: legacyAccounts, resolver });
    const authenticated = await auth.authenticateCredentials({
      email: 'aarav@example.com',
      password: 'FourthStrong!234',
    });
    assert.equal(authenticated.memberId, GENERATED_STUDENT_ID);
    assert.equal(authenticated.role, 'member');

    const token = await createSessionToken(authenticated.role, authenticated);
    const session = await verifySessionToken(token, { accounts, resolver });
    assert.equal(session.memberId, GENERATED_STUDENT_ID);
    assert.equal(session.displayName, 'Aarav Sen');
  });

  test('rejects unknown students and duplicate canonical student links', async () => {
    const { service } = await createHarness();
    const actor = { role: 'superadmin', userId: 'root-1' };

    await assert.rejects(
      service.provisionAccount({
        memberId: 'student_ffffffffffffffffffffffffffffffff',
        email: 'unknown@example.com',
        newPassword: 'UnknownStrong!234',
        currentPassword: 'admin-pass',
        actor,
      }),
      (error) => error.statusCode === 404,
    );

    await service.provisionAccount({
      memberId: GENERATED_STUDENT_ID,
      email: 'aarav@example.com',
      newPassword: 'FourthStrong!234',
      currentPassword: 'admin-pass',
      actor,
    });
    await assert.rejects(
      service.provisionAccount({
        memberId: GENERATED_STUDENT_ID,
        email: 'other@example.com',
        newPassword: 'OtherStrong!234',
        currentPassword: 'admin-pass',
        actor,
      }),
      (error) => error.statusCode === 409,
    );
  });

  test('disabled accounts cannot login and password reset revokes existing sessions', async () => {
    const { service, accounts, legacyAccounts, resolver } = await createHarness();
    const actor = { role: 'superadmin', userId: 'root-1' };
    const original = await service.provisionAccount({
      memberId: GENERATED_STUDENT_ID,
      email: 'aarav@example.com',
      newPassword: 'FourthStrong!234',
      currentPassword: 'admin-pass',
      actor,
    });
    const token = await createSessionToken('member', {
      memberId: GENERATED_STUDENT_ID,
      userId: original.userId,
      sessionVersion: original.sessionVersion,
    });

    await service.resetPassword({
      memberId: GENERATED_STUDENT_ID,
      newPassword: 'Replacement!234',
      currentPassword: 'admin-pass',
      actor,
    });
    await assert.rejects(
      verifySessionToken(token, { accounts, resolver }),
      /Session has been revoked/,
    );

    await service.setAccountActive({
      memberId: GENERATED_STUDENT_ID,
      active: false,
      currentPassword: 'admin-pass',
      actor,
    });
    const auth = createAuthService({ userAccounts: accounts, accounts: legacyAccounts, resolver });
    await assert.rejects(
      auth.authenticateCredentials({ email: 'aarav@example.com', password: 'Replacement!234' }),
      (error) => error.statusCode === 401,
    );
  });

  test('canonical login rejects an account linked to an unknown student', async () => {
    const { accounts, legacyAccounts, resolver } = await createHarness();
    await accounts.create({
      userId: 'user-unknown-student',
      memberId: 'student_ffffffffffffffffffffffffffffffff',
      displayName: 'Unknown Student',
      email: 'orphan@example.com',
      passwordHash: await bcrypt.hash('OrphanStrong!234', 12),
      role: 'member',
      active: true,
    });
    const auth = createAuthService({ userAccounts: accounts, accounts: legacyAccounts, resolver });

    await assert.rejects(
      auth.authenticateCredentials({ email: 'orphan@example.com', password: 'OrphanStrong!234' }),
      (error) => error.statusCode === 401 && error.message === 'Invalid email or password.',
    );
  });

  test('provisions a canonical member account without returning its password hash', async () => {
    const { service, accounts, auditEvents } = await createHarness();
    const result = await service.provisionAccount({
      memberId: 'gaurav',
      email: ' Gaurav@Example.com ',
      newPassword: 'NewStrong!234',
      currentPassword: 'admin-pass',
      actor: { role: 'superadmin', userId: 'root-1' },
    });

    assert.equal(result.memberId, 'gaurav');
    assert.equal(result.email, 'gaurav@example.com');
    assert.equal(result.active, true);
    assert.equal('passwordHash' in result, false);
    const stored = await accounts.findByMemberId('gaurav', { includePasswordHash: true });
    assert.equal(await bcrypt.compare('NewStrong!234', stored.passwordHash), true);
    assert.equal(auditEvents[0].event, 'MEMBER_ACCOUNT_PROVISIONED');
    assert.equal(JSON.stringify(auditEvents).includes('NewStrong!234'), false);
  });

  test('changes email and password while revoking existing sessions', async () => {
    const { service, accounts, auditEvents } = await createHarness();
    await service.provisionAccount({
      memberId: 'nikhil',
      email: 'nikhil@example.com',
      newPassword: 'FirstStrong!234',
      currentPassword: 'admin-pass',
      actor: { role: 'superadmin', userId: 'root-1' },
    });

    const changedEmail = await service.changeEmail({
      memberId: 'nikhil',
      email: 'nikhil.new@example.com',
      currentPassword: 'admin-pass',
      actor: { role: 'superadmin', userId: 'root-1' },
    });
    const afterEmail = await accounts.findByMemberId('nikhil', { includePasswordHash: true });
    assert.equal(changedEmail.email, 'nikhil.new@example.com');
    assert.equal(afterEmail.sessionVersion, 1);

    const reset = await service.resetPassword({
      memberId: 'nikhil',
      newPassword: 'SecondStrong!234',
      currentPassword: 'admin-pass',
      actor: { role: 'superadmin', userId: 'root-1' },
    });
    const afterReset = await accounts.findByMemberId('nikhil', { includePasswordHash: true });
    assert.equal(reset.sessionVersion, 2);
    assert.equal(await bcrypt.compare('FirstStrong!234', afterReset.passwordHash), false);
    assert.equal(await bcrypt.compare('SecondStrong!234', afterReset.passwordHash), true);
    assert.equal(auditEvents.at(-1).event, 'MEMBER_PASSWORD_RESET');
    assert.equal(JSON.stringify(auditEvents).includes('SecondStrong!234'), false);
  });

  test('deactivation revokes sessions but preserves the canonical member identity', async () => {
    const { service, accounts } = await createHarness();
    await service.provisionAccount({
      memberId: 'devansh',
      email: 'devansh@example.com',
      newPassword: 'FirstStrong!234',
      currentPassword: 'admin-pass',
      actor: { role: 'superadmin', userId: 'root-1' },
    });
    const disabled = await service.setAccountActive({
      memberId: 'devansh',
      active: false,
      currentPassword: 'admin-pass',
      actor: { role: 'superadmin', userId: 'root-1' },
    });

    assert.equal(disabled.memberId, 'devansh');
    assert.equal(disabled.active, false);
    assert.equal(disabled.sessionVersion, 1);
    assert.equal((await accounts.findByMemberId('devansh')).memberId, 'devansh');
  });

  test('rejects email conflicts from both canonical and legacy account collections', async () => {
    const { service, legacyAccounts } = await createHarness();
    await legacyAccounts.upsertAccount({
      memberId: 'devansh',
      email: 'legacy@example.com',
      passwordHash: await bcrypt.hash('LegacyStrong!234', 12),
    });

    await assert.rejects(
      service.provisionAccount({
        memberId: 'gaurav',
        email: 'legacy@example.com',
        newPassword: 'NewStrong!234',
        currentPassword: 'admin-pass',
        actor: { role: 'superadmin', userId: 'root-1' },
      }),
      (error) => error.statusCode === 409,
    );
  });
});

describe('canonical member accommodation roster', () => {
  test('reports assignment dates and fee-plan status independently of registered Stays', async () => {
    const assignments = {
      gaurav: {
        assignmentId: 'assignment-gaurav',
        roomId: 'lower',
        effectiveFromDate: '2026-10-20',
        effectiveUntilDate: null,
      },
      nikhil: {
        assignmentId: 'assignment-nikhil',
        roomId: 'first',
        effectiveFromDate: '2026-10-20',
        effectiveUntilDate: null,
      },
      devansh: {
        assignmentId: 'assignment-devansh',
        roomId: 'first',
        effectiveFromDate: '2026-10-20',
        effectiveUntilDate: null,
      },
    };
    const service = createMemberService({
      resolver: {
        async listCurrent() {
          return [
            { studentId: 'gaurav', displayName: 'Gaurav', status: 'ACTIVE', mealEligibilityFrom: '2026-10-01', mealEligibilityUntil: null, rosterOrder: 10 },
            { studentId: 'nikhil', displayName: 'Nikhil', status: 'ACTIVE', mealEligibilityFrom: null, mealEligibilityUntil: null, rosterOrder: 20 },
            { studentId: 'devansh', displayName: 'Devansh', status: 'ACTIVE', mealEligibilityFrom: null, mealEligibilityUntil: null, rosterOrder: 30 },
            { studentId: 'student_00000000000000000000000000000004', displayName: 'Fourth Student', status: 'ACTIVE', mealEligibilityFrom: '2026-10-21', mealEligibilityUntil: null, rosterOrder: 40 },
          ];
        },
      },
      accounts: { async listAll() { return []; } },
      stays: { async listAllStays() { return []; } },
      rooms: {
        async findAssignmentOnDate(memberId) { return assignments[memberId]; },
        async findRoomById(roomId) {
          return roomId === 'lower'
            ? { roomId, roomNumber: 'lower' }
            : { roomId, roomNumber: '1st Floor Room' };
        },
        async findActiveFeePlan(memberId) {
          return memberId === 'devansh'
            ? null
            : { feePlanId: `plan-${memberId}`, amountPaise: 280000, effectiveFromMonth: '2026-10' };
        },
      },
      now: () => new Date('2026-10-21T06:30:00.000Z'),
    });

    const roster = await service.listMembers();

    assert.deepEqual(roster.map((row) => row.memberId), [
      'gaurav',
      'nikhil',
      'devansh',
      'student_00000000000000000000000000000004',
    ]);
    assert.equal(roster[0].stay, null);
    assert.deepEqual(roster[0].assignment, {
      assignmentId: 'assignment-gaurav',
      roomId: 'lower',
      effectiveFromDate: '2026-10-20',
      effectiveUntilDate: null,
    });
    assert.deepEqual(roster[0].feePlan, {
      feePlanId: 'plan-gaurav',
      amountPaise: 280000,
      effectiveFromMonth: '2026-10',
    });
    assert.equal(roster[2].feePlan, null);
    assert.equal(roster[3].name, 'Fourth Student');
    assert.equal(roster[3].status, 'ACTIVE');
    assert.equal(roster[3].mealEligibilityFrom, '2026-10-21');
  });
});

describe('legacy authentication reconciliation', () => {
  test('canonical account existence blocks an old legacy password and email fallback', async () => {
    const accounts = new InMemoryUserAccountRepository();
    const legacyAccounts = new InMemoryMemberAccountRepository();
    const resolver = createStudentResolver({
      repository: new InMemoryStudentRepository([student('gaurav', 'Gaurav', 0)]),
    });
    await accounts.create({
      userId: 'user-gaurav',
      memberId: 'gaurav',
      displayName: 'Gaurav',
      email: 'new@example.com',
      passwordHash: await bcrypt.hash('Canonical!234', 12),
      role: 'member',
      active: true,
    });
    await legacyAccounts.upsertAccount({
      memberId: 'gaurav',
      email: 'old@example.com',
      passwordHash: await bcrypt.hash('OldPassword!234', 12),
      active: true,
    });
    const auth = createAuthService({ accounts: legacyAccounts, userAccounts: accounts, resolver });

    await assert.rejects(
      auth.authenticateCredentials({ email: 'old@example.com', password: 'OldPassword!234' }),
      (error) => error.statusCode === 401,
    );
    const canonical = await auth.authenticateCredentials({ email: 'new@example.com', password: 'Canonical!234' });
    assert.equal(canonical.userId, 'user-gaurav');
  });

  test('canonical account existence invalidates legacy tokens for a generated student', async () => {
    const accounts = new InMemoryUserAccountRepository();
    const students = new InMemoryStudentRepository([
      student(GENERATED_STUDENT_ID, 'Aarav Sen', 3),
    ]);
    const resolver = createStudentResolver({ repository: students });
    await accounts.create({
      userId: 'user-aarav',
      memberId: GENERATED_STUDENT_ID,
      displayName: 'Aarav Sen',
      email: 'aarav@example.com',
      passwordHash: await bcrypt.hash('Canonical!234', 12),
      role: 'member',
      active: true,
    });
    const legacyToken = await createSessionToken('member', { memberId: GENERATED_STUDENT_ID });

    await assert.rejects(
      verifySessionToken(legacyToken, { accounts, resolver }),
      /Legacy member session has been revoked/,
    );
  });
});

describe('member management API authorization and serialization', () => {
  function createApi(role, overrides = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { authenticated: true, role, userId: `${role}-1` };
      next();
    });
    app.use('/api/admin/members', createMemberRouter({
      service: {
        async listMembers() {
          return [{ memberId: 'gaurav', name: 'Gaurav', account: { exists: false }, stay: null, room: null }];
        },
      },
      accountService: {
        async auditLegacyConflicts() { return []; },
        async resetPassword() { return { memberId: 'gaurav', email: 'g@example.com', active: true }; },
        ...overrides,
      },
    }));
    app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ success: false, message: error.message }));
    return app;
  }

  test('regular Admin can view the stable roster but cannot mutate credentials', async () => {
    let mutationCalls = 0;
    const app = createApi('admin', {
      async resetPassword() {
        mutationCalls += 1;
        return {};
      },
    });

    const listing = await request(app).get('/api/admin/members').expect(200);
    assert.equal(listing.body.data[0].memberId, 'gaurav');
    await request(app)
      .post('/api/admin/members/gaurav/reset-password')
      .send({ newPassword: 'NewStrong!234', currentPassword: 'admin-pass' })
      .expect(403);
    assert.equal(mutationCalls, 0);
  });

  test('Super Admin credential response never includes a password or hash', async () => {
    const app = createApi('superadmin');
    const response = await request(app)
      .post('/api/admin/members/gaurav/reset-password')
      .send({ newPassword: 'NewStrong!234', currentPassword: 'admin-pass' })
      .expect(200);

    assert.equal(JSON.stringify(response.body).includes('NewStrong!234'), false);
    assert.equal(JSON.stringify(response.body).includes('passwordHash'), false);
  });

  test('member detail can resolve an archived historical student outside the current roster', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { authenticated: true, role: 'admin', userId: 'admin-1' };
      next();
    });
    app.use('/api/admin/members', createMemberRouter({
      service: {
        async listMembers() { return []; },
        async findMemberById(memberId) {
          return {
            memberId,
            name: 'Archived Student',
            status: 'ARCHIVED',
            account: { exists: false },
            stay: null,
            room: null,
          };
        },
      },
      accountService: { async auditLegacyConflicts() { return []; } },
    }));
    const response = await request(app)
      .get('/api/admin/members/student_00000000000000000000000000000004')
      .expect(200);
    assert.equal(response.body.data.status, 'ARCHIVED');
  });
});
