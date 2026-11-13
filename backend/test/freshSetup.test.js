import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import bcrypt from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initializationState } from '../src/config/readiness.js';
import {
  ensureRequiredIndexes,
  findMissingIndexes,
  initializeApplication,
  resetSuperAdminPassword,
} from '../src/config/initialization.js';
import { prepareFirstAdmin, parseSetupArguments } from '../src/config/firstAdminSetup.js';
import { createInitializationGate } from '../src/middleware/initializationGate.js';

// setup-env.js points MONGODB_URI at this database name; readiness verifies the identity.
const DATABASE = 'mealkhata-test-not-connected';
const ORIGIN = 'http://localhost:5173';
const OWNER_EMAIL = 'owner.setup@mealkhata.test';
const OWNER_PASSWORD = 'Owner-Setup!2026';
const ADMIN_PASSWORD = 'Admin-Setup!2026';
const START_DATE = '2026-11-01';

let replSet;
let app;

const OPERATIONAL_COLLECTIONS = ['students', 'meal_days', 'rooms', 'room_assignments', 'hostel_stays',
  'payments', 'room_payments', 'room_charges', 'expenses', 'monthly_settlements', 'hostel_deposit_transactions'];

async function count(name, filter = {}) {
  return mongoose.connection.db.collection(name).countDocuments(filter);
}

async function login(email, password, agent = request.agent(app)) {
  const response = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password });
  return { agent, response };
}

async function connect() {
  await mongoose.connect(replSet.getUri(DATABASE), { serverSelectionTimeoutMS: 15_000 });
}

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect();
  app = createApp();
});

after(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

describe('fresh MealKhata setup, in order', { concurrency: 1 }, () => {
describe('fresh MealKhata setup', { concurrency: 1 }, () => {
  test('before setup: readiness is 503, writes are gated, and nobody can sign in', async () => {
    // Simulates the production Atlas state: collections exist but hold no documents.
    await ensureRequiredIndexes();
    initializationState.reset();

    const ready = await request(app).get('/api/ready').expect(503);
    assert.equal(ready.body.status, 'unavailable');
    assert.equal(ready.body.checks.database, true);
    assert.equal(ready.body.checks.databaseIdentity, true);
    assert.equal(ready.body.checks.initialized, false);
    assert.equal(ready.body.checks.indexes, true);
    await request(app).get('/api/health').expect(200);

    const login = await request(app).post('/api/auth/login').set('Origin', ORIGIN)
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    assert.equal(login.status, 401);

    const write = await request(app).post('/api/students').set('Origin', ORIGIN).send({ displayName: 'X' });
    assert.equal(write.status, 503);
    assert.equal(write.body.code, 'SETUP_REQUIRED');
  });

  test('setup input is validated and the password is hashed with bcrypt cost 12', async () => {
    assert.deepEqual(parseSetupArguments(['--email', OWNER_EMAIL, '--start-date', START_DATE]),
      { email: OWNER_EMAIL, financialStartDate: START_DATE });
    assert.throws(() => parseSetupArguments(['--force']), /Unknown/);
    await assert.rejects(prepareFirstAdmin({ email: OWNER_EMAIL, financialStartDate: START_DATE,
      password: 'short', passwordConfirmation: 'short' }), /12-256/);
    await assert.rejects(prepareFirstAdmin({ email: OWNER_EMAIL, financialStartDate: START_DATE,
      password: OWNER_PASSWORD, passwordConfirmation: `${OWNER_PASSWORD}x` }), /do not match/);
    await assert.rejects(prepareFirstAdmin({ email: OWNER_EMAIL, financialStartDate: '2026-02-30',
      password: OWNER_PASSWORD, passwordConfirmation: OWNER_PASSWORD }), /start date/);
    const prepared = await prepareFirstAdmin({ email: ` ${OWNER_EMAIL.toUpperCase()} `,
      financialStartDate: START_DATE, password: OWNER_PASSWORD, passwordConfirmation: OWNER_PASSWORD });
    assert.equal(prepared.email, OWNER_EMAIL);
    assert.equal(bcrypt.getRounds(prepared.passwordHash), 12);
    assert.equal(JSON.stringify(prepared).includes(OWNER_PASSWORD), false);
  });

  test('concurrent first-time setup creates exactly one Super Admin and no operational data', async () => {
    const prepared = await prepareFirstAdmin({ email: OWNER_EMAIL, financialStartDate: START_DATE,
      password: OWNER_PASSWORD, passwordConfirmation: OWNER_PASSWORD });
    const outcomes = await Promise.allSettled([
      initializeApplication(prepared),
      initializeApplication(prepared),
    ]);
    assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.match(outcomes.find(({ status }) => status === 'rejected').reason.message,
      /already initialized|Write conflict|accounts or students/i);

    assert.equal(await count('user_accounts'), 1);
    assert.equal(await count('user_accounts', { role: 'superadmin', active: true }), 1);
    assert.equal(await count('system_settings'), 1);
    assert.equal(await count('app_initialization'), 1);
    assert.equal(await count('account_audit_events', { event: 'SUPERADMIN_INITIALIZED' }), 1);
    for (const name of OPERATIONAL_COLLECTIONS) assert.equal(await count(name), 0, `${name} must stay empty`);
    const settings = await mongoose.connection.db.collection('system_settings').findOne({ settingsId: 'system' });
    assert.equal(settings.financialStartDate, START_DATE);
    assert.equal(settings.timezone, 'Asia/Kolkata');
  });

  test('a repeated setup is refused and a second Super Admin is impossible even by direct insert', async () => {
    const prepared = await prepareFirstAdmin({ email: 'second@mealkhata.test', financialStartDate: START_DATE,
      password: OWNER_PASSWORD, passwordConfirmation: OWNER_PASSWORD });
    await assert.rejects(initializeApplication(prepared), /already initialized/);
    await assert.rejects(mongoose.connection.db.collection('user_accounts').insertOne({
      userId: 'rogue', email: 'rogue@mealkhata.test', role: 'superadmin', active: true,
    }), (error) => error.code === 11000);
    assert.equal(await count('user_accounts', { role: 'superadmin' }), 1);
  });

  test('after setup: readiness is 200 with every check passing', async () => {
    const ready = await request(app).get('/api/ready').expect(200);
    assert.equal(ready.body.status, 'ready');
    assert.ok(Object.values(ready.body.checks).every(Boolean), JSON.stringify(ready.body.checks));
    assert.deepEqual(await findMissingIndexes(), []);
  });

  test('missing indexes make readiness fail and startup index creation repairs them', async () => {
    await mongoose.connection.db.collection('payments').dropIndexes();
    const broken = await request(app).get('/api/ready').expect(503);
    assert.equal(broken.body.checks.indexes, false);
    await ensureRequiredIndexes();
    await request(app).get('/api/ready').expect(200);
  });
});

describe('Super Admin operations after setup', { concurrency: 1 }, () => {
  let owner;
  let adminUserId;

  test('Super Admin signs in; the session survives a backend reconnect', async () => {
    const { agent, response } = await login(OWNER_EMAIL, OWNER_PASSWORD);
    assert.equal(response.status, 200);
    assert.equal(response.body.session.role, 'superadmin');
    owner = agent;
    await mongoose.disconnect();
    await connect();
    initializationState.reset();
    const session = await owner.get('/api/auth/session').expect(200);
    assert.equal(session.body.session.role, 'superadmin');
    await request(app).get('/api/ready').expect(200);
  });

  test('an empty system shows no false settlement alert for months before the start date', async () => {
    const dashboard = await owner.get('/api/dashboard').expect(200);
    const ids = (dashboard.body.data.attention ?? []).map((item) => item.id);
    assert.equal(ids.includes('settlement_blocked'), false, JSON.stringify(ids));
  });

  test('Super Admin creates an Admin; Admin cannot manage accounts or students', async () => {
    const missingReauth = await owner.post('/api/admin/accounts').set('Origin', ORIGIN)
      .send({ email: 'admin@mealkhata.test', displayName: 'Mess Admin', newPassword: ADMIN_PASSWORD });
    assert.equal(missingReauth.status, 401);

    const created = await owner.post('/api/admin/accounts').set('Origin', ORIGIN).send({
      email: 'admin@mealkhata.test', displayName: 'Mess Admin', newPassword: ADMIN_PASSWORD,
      currentPassword: OWNER_PASSWORD,
    }).expect(201);
    assert.equal(created.body.data.role, 'admin');
    assert.equal(JSON.stringify(created.body).includes('passwordHash'), false);
    adminUserId = created.body.data.userId;

    const duplicate = await owner.post('/api/admin/accounts').set('Origin', ORIGIN).send({
      email: 'admin@mealkhata.test', displayName: 'Again', newPassword: ADMIN_PASSWORD, currentPassword: OWNER_PASSWORD,
    });
    assert.equal(duplicate.status, 409);

    const { agent: admin, response } = await login('admin@mealkhata.test', ADMIN_PASSWORD);
    assert.equal(response.body.session.role, 'admin');
    await admin.get('/api/admin/accounts').expect(403);
    await admin.post('/api/students').set('Origin', ORIGIN).send({ displayName: 'Nope', reason: 'x' }).expect(403);
    await request(app).get('/api/admin/accounts').expect(401);
  });

  test('disabling an Admin revokes its sessions and blocks sign-in', async () => {
    const { agent: admin } = await login('admin@mealkhata.test', ADMIN_PASSWORD);
    await owner.post(`/api/admin/accounts/${adminUserId}/deactivate`).set('Origin', ORIGIN)
      .send({ currentPassword: OWNER_PASSWORD }).expect(200);
    const session = await admin.get('/api/auth/session').expect(200);
    assert.equal(session.body.session.authenticated, false);
    const { response } = await login('admin@mealkhata.test', ADMIN_PASSWORD);
    assert.equal(response.status, 401);
    const audit = await owner.get('/api/admin/accounts/audit').expect(200);
    assert.ok(audit.body.data.some((event) => event.event === 'ADMIN_DEACTIVATED'));
  });

  test('the Super Admin cannot be disabled through the account API', async () => {
    const owners = await owner.get('/api/admin/accounts').expect(200);
    const superAdmin = owners.body.data.find((account) => account.role === 'superadmin');
    const response = await owner.post(`/api/admin/accounts/${superAdmin.userId}/deactivate`)
      .set('Origin', ORIGIN).send({ currentPassword: OWNER_PASSWORD });
    assert.equal(response.status, 403);
  });

  test('roster sizes 0, 1, 3, 5 and 10 drive meals and exact integer-paise costs', async () => {
    const date = '2026-11-05';
    const roster = await owner.get('/api/students/roster').expect(200);
    assert.equal(roster.body.data.length, 0);
    const empty = await owner.get(`/api/meals/${date}`).expect(200);
    assert.deepEqual(empty.body.data.participantOrder ?? [], []);

    let created = 0;
    for (const target of [1, 3, 5, 10]) {
      while (created < target) {
        created += 1;
        await owner.post('/api/students').set('Origin', ORIGIN)
          .send({ displayName: `Student ${created}`, rosterOrder: created * 10, mealEligibilityFrom: START_DATE, reason: 'Admission' })
          .then((response) => { assert.equal(response.status, 201, JSON.stringify(response.body)); });
      }
      const current = await owner.get('/api/students/roster').expect(200);
      assert.equal(current.body.data.length, target);
      const day = await owner.get(`/api/meals/2026-11-0${[1, 3, 5, 10].indexOf(target) + 6}`).expect(200);
      assert.equal(Object.keys(day.body.data.meals.morning).length, target, JSON.stringify({ roster: current.body.data, day: day.body.data }).slice(0, 900));
    }

    // Everyone takes morning on one day: room total must be exactly 10 × ₹50.
    const students = (await owner.get('/api/students/roster').expect(200)).body.data;
    for (const student of students) {
      await owner.patch(`/api/meals/${date}`).set('Origin', ORIGIN)
        .send({ mealType: 'morning', memberId: student.studentId, status: 'taking' }).expect(200);
    }
    const day = (await owner.get(`/api/meals/${date}`).expect(200)).body.data;
    const memberAmounts = Object.values(day.dailyCostSummary.members).map((member) => member.morningAmountPaise);
    assert.ok(memberAmounts.every(Number.isInteger));
    assert.equal(memberAmounts.reduce((sum, value) => sum + value, 0), 10 * 5000);
    assert.equal(day.dailyCostSummary.room.morningAmountPaise, 10 * 5000);
    assert.equal(await count('students'), 10);
  });

  test('financial start date is editable only while nothing has been recorded', async () => {
    const settings = await owner.get('/api/settings/system').expect(200);
    assert.equal(settings.body.data.financialStartDate, START_DATE);
    assert.equal(settings.body.data.financialStartDateLocked, true);
    const blocked = await owner.patch('/api/settings/system').set('Origin', ORIGIN).send({
      financialStartDate: '2026-12-01', expectedRevision: settings.body.data.revision, currentPassword: OWNER_PASSWORD,
    });
    assert.equal(blocked.status, 409);
  });

  test('changing your own password revokes old sessions and keeps this one signed in', async () => {
    const { agent: otherDevice } = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const wrong = await owner.post('/api/auth/password').set('Origin', ORIGIN)
      .send({ currentPassword: 'wrong', newPassword: 'Owner-Changed!2026' });
    assert.equal(wrong.status, 401);
    await owner.post('/api/auth/password').set('Origin', ORIGIN)
      .send({ currentPassword: OWNER_PASSWORD, newPassword: 'Owner-Changed!2026' }).expect(200);
    assert.equal((await owner.get('/api/auth/session').expect(200)).body.session.role, 'superadmin');
    assert.equal((await otherDevice.get('/api/auth/session').expect(200)).body.session.authenticated, false);
    assert.equal((await login(OWNER_EMAIL, OWNER_PASSWORD)).response.status, 401);
    assert.equal((await login(OWNER_EMAIL, 'Owner-Changed!2026')).response.status, 200);
  });

  test('owner recovery (database credentials only) resets the Super Admin password and revokes sessions', async () => {
    await assert.rejects(resetSuperAdminPassword({ email: 'someone@else.test',
      passwordHash: await bcrypt.hash('Whatever-Pass!2026', 12) }), /not the Super Admin/);
    await resetSuperAdminPassword({ email: OWNER_EMAIL, passwordHash: await bcrypt.hash('Owner-Recovered!2026', 12) });
    assert.equal((await owner.get('/api/auth/session').expect(200)).body.session.authenticated, false);
    assert.equal((await login(OWNER_EMAIL, 'Owner-Recovered!2026')).response.status, 200);
    assert.equal(await count('user_accounts', { role: 'superadmin' }), 1);
    assert.equal(parseSetupArguments(['--reset-password', '--email', OWNER_EMAIL]).resetPassword, true);
  });
});
});

describe('initialization gate', () => {
  test('blocks writes until initialized and never caches a negative result', async () => {
    let initialized = false;
    const gate = createInitializationGate({ state: { isInitialized: async () => initialized },
      drainingCheck: () => false });
    const run = (method, path) => new Promise((resolve) => {
      const res = { status(code) { this.code = code; return this; }, json(body) { resolve({ code: this.code, body }); } };
      gate({ method, path }, res, () => resolve({ code: 'next' }));
    });
    assert.equal((await run('GET', '/students')).code, 'next');
    assert.equal((await run('POST', '/auth/login')).code, 'next');
    assert.equal((await run('POST', '/students')).code, 503);
    initialized = true;
    assert.equal((await run('POST', '/students')).code, 'next');
  });
});
