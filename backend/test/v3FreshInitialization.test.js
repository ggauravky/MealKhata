import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { checksumValue } from '../src/migrations/sourceInventory.service.js';
import { checkV3ReleaseReadiness, inspectV3RequiredIndexes } from '../src/config/v3ReleaseReadiness.js';
import { createAuthService } from '../src/auth/auth.service.js';
import { studentService } from '../src/students/student.service.js';
import { studentResolver } from '../src/students/studentResolver.service.js';
import { createMealService } from '../src/meals/meal.service.js';
import { mealRepository } from '../src/meals/meal.repository.js';
import { createRoomFeeService } from '../src/roomFees/roomFee.service.js';
import { roomRepository } from '../src/roomFees/room.repository.js';
import { financialBoundaryService } from '../src/finance/financialBoundary.service.js';
import { paymentSettingsService } from '../src/payments/paymentSettings.service.js';
import { createPaymentService } from '../src/payments/payment.service.js';
import { paymentRepository } from '../src/payments/payment.repository.js';

test('fresh setup refuses a source URI or another cluster as its target', async () => {
  const module = await import('../src/config/v3FreshInitialization.js');
  const sourceUri = 'mongodb+srv://user:secret@cluster.example.test/mealkhata';
  const targetUri = 'mongodb+srv://user:secret@cluster.example.test/mealkhata_v3_fresh';
  const options = { sourceUri, targetUri, sourceDatabase: 'mealkhata',
    targetDatabase: 'mealkhata_v3_fresh' };
  assert.deepEqual(module.validateFreshTargetUris(options), {
    sourceDatabase: 'mealkhata', targetDatabase: 'mealkhata_v3_fresh',
  });
  assert.throws(() => module.validateFreshTargetUris({ ...options, targetUri: sourceUri }), /target|database/i);
  assert.throws(() => module.validateFreshTargetUris({ ...options,
    targetUri: targetUri.replace('cluster.example.test', 'other.example.test') }), /cluster|host/i);
});

test('fresh initialization provisions only a Super Admin and boundary in a separate empty database', async () => {
  const module = await import('../src/config/v3FreshInitialization.js').catch(() => null);
  assert.ok(module?.initializeFreshV3, 'fresh initialization must be implemented');
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  try {
    await mongoose.connect(repl.getUri('mealkhata_v3_fresh_test'), { autoIndex: false });
    const db = mongoose.connection.db;
    await mongoose.connection.client.db('mealkhata').collection('meal_days').insertOne({ date: '2026-11-01' });
    const hello = await db.admin().command({ hello: 1 });
    const clusterIdentity = checksumValue({ setName: hello.setName, hosts: [...hello.hosts].sort() });
    const owner = generateKeyPairSync('ed25519');
    const operator = generateKeyPairSync('ed25519');
    const body = {
      format: 'mealkhata-v3-fresh-init-approval-v1', sourceDatabase: 'mealkhata',
      targetDatabase: 'mealkhata_v3_fresh_test', targetClusterIdentity: clusterIdentity,
      superAdminEmail: 'owner@example.test', financialStartDate: '2026-11-07',
      nonce: 'fresh-nonce-1', issuedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const approval = { body, signatures: {
      owner: sign(null, Buffer.from(checksumValue(body)), owner.privateKey).toString('base64'),
      operator: sign(null, Buffer.from(checksumValue(body)), operator.privateKey).toString('base64'),
    } };
    const options = {
      db, sourceDatabase: body.sourceDatabase, targetDatabase: body.targetDatabase,
      approval, ownerPublicKey: owner.publicKey.export({ type: 'spki', format: 'pem' }),
      operatorPublicKey: operator.publicKey.export({ type: 'spki', format: 'pem' }),
      superAdminPasswordHash: await bcrypt.hash('long-unique-test-password', 12),
      now: new Date(),
    };
    await assert.rejects(module.initializeFreshV3({ ...options,
      sourceDatabase: body.targetDatabase, execute: true }), /source|target/i);
    const preview = await module.initializeFreshV3({ ...options, execute: false });
    assert.equal(preview.targetDatabase, body.targetDatabase);
    assert.equal(await db.collection('user_accounts').countDocuments(), 0);
    const result = await module.initializeFreshV3({ ...options, execute: true });
    assert.equal(result.targetDatabase, body.targetDatabase);
    const admin = await db.collection('user_accounts').findOne({ role: 'superadmin' });
    assert.equal(admin.email, body.superAdminEmail);
    assert.equal(await bcrypt.compare('long-unique-test-password', admin.passwordHash), true);
    assert.equal(await db.collection('system_settings').countDocuments({ financialStartDate: body.financialStartDate }), 1);
    const marker = await db.collection('v3_fresh_initializations').findOne({ initializationId: 'mealkhata-v3-fresh' });
    assert.equal(marker.status, 'complete');
    const { _id: ignoredId, ...storedManifest } = marker;
    assert.ok(ignoredId);
    assert.equal(result.initializationChecksum, checksumValue(storedManifest));
    const preparedRuntime = module.createFreshRuntimeAttestationBody({
      manifest: marker, buildSha: 'a'.repeat(64), releaseId: 'fresh-test',
      launchStage: 'serving', now: new Date(),
    });
    assert.equal(preparedRuntime.initializationChecksum, result.initializationChecksum);
    assert.equal(Date.parse(preparedRuntime.expiresAt) - Date.parse(preparedRuntime.issuedAt), 24 * 60 * 60_000);
    assert.equal(await inspectV3RequiredIndexes(db, { mode: 'fresh' }), true);
    const releaseBody = {
      format: 'mealkhata-v3-fresh-runtime-attestation-v1', releaseId: 'fresh-test',
      buildSha: 'a'.repeat(64), targetDatabase: body.targetDatabase,
      targetClusterIdentity: clusterIdentity,
      initializationChecksum: result.initializationChecksum,
      launchStage: 'serving', issuedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const release = { body: releaseBody, signatures: {
      owner: sign(null, Buffer.from(checksumValue(releaseBody)), owner.privateKey).toString('base64'),
      operator: sign(null, Buffer.from(checksumValue(releaseBody)), operator.privateKey).toString('base64'),
    } };
    assert.equal(await checkV3ReleaseReadiness({
      db, config: {
        runtimeProfile: 'v3', canonicalOnlyAuth: true,
        v3BuildSha: releaseBody.buildSha, observedBuildSha: releaseBody.buildSha,
        v3AttestationPath: 'test-only',
        v3OwnerPublicKey: options.ownerPublicKey,
        v3OperatorPublicKey: options.operatorPublicKey,
      },
      probe: async () => true,
      readAttestation: async () => JSON.stringify(release),
      now: new Date(),
    }), true);
    for (const name of ['students', 'meal_days', 'payments', 'rooms', 'room_assignments',
      'hostel_stays', 'hostel_deposit_transactions', 'expenses', 'monthly_settlements']) {
      assert.equal(await db.collection(name).countDocuments(), 0, name);
    }
    assert.equal(await mongoose.connection.client.db('mealkhata').collection('meal_days').countDocuments(), 1);
    const auth = createAuthService({ config: { runtimeProfile: 'v3', canonicalOnlyAuth: true } });
    const login = await auth.authenticateCredentials({ email: body.superAdminEmail,
      password: 'long-unique-test-password' });
    assert.equal(login.role, 'superadmin');
    assert.equal(login.userId, result.superAdminUserId);
    assert.equal(Object.hasOwn(login, 'passwordHash'), false);
    const student = await studentService.createStudent({
      actor: { role: 'superadmin', userId: login.userId }, reason: 'Fresh student enrollment',
      displayName: 'New Student', email: null, phone: null,
      mealEligibilityFrom: '2026-11-07', mealEligibilityUntil: null, rosterOrder: 0,
    });
    assert.equal(await db.collection('students').countDocuments(), 1);
    const meal = createMealService({ repository: mealRepository, students: studentResolver,
      runtimeProfile: 'v3' });
    const changed = await meal.changeStatus({ date: '2026-11-07', mealType: 'morning',
      memberId: student.studentId, status: 'taking', actorRole: 'superadmin' });
    assert.equal(changed.data.dailyCostSummary.members[student.studentId].morningAmountPaise, 5000);
    const rooms = createRoomFeeService({ repository: roomRepository, students: studentResolver,
      boundary: financialBoundaryService, runtimeProfile: 'v3',
      now: () => new Date('2026-11-07T08:00:00.000Z') });
    const room = await rooms.createRoom({ roomNumber: 'F-1', capacity: 1, actorRole: 'superadmin' });
    await rooms.assignMemberToRoom({ memberId: student.studentId, roomId: room.roomId,
      effectiveFromMonth: '2026-11', effectiveFromDate: '2026-11-07', actorRole: 'superadmin' });
    assert.equal(await db.collection('room_assignments').countDocuments(), 1);
    await paymentSettingsService.updateSettings({ receiverName: 'Test Receiver',
      upiId: 'test@upi', receiverMobile: null, actorRole: 'superadmin' });
    const payments = createPaymentService({ repository: paymentRepository, students: studentResolver,
      boundary: financialBoundaryService });
    const payment = await payments.recordPayment({ month: '2026-11', memberId: student.studentId,
      amountPaise: 100, idempotencyKey: randomUUID(), upiReference: 'test-ref-1',
      actorRole: 'superadmin' });
    assert.equal(payment.created, true);
    assert.equal(await db.collection('payments').countDocuments(), 1);
    assert.equal(await mongoose.connection.client.db('mealkhata').collection('meal_days').countDocuments(), 1);
    await assert.rejects(module.initializeFreshV3({ ...options, execute: true }), /empty|already|initialized/i);
  } finally {
    await mongoose.disconnect();
    await repl.stop();
  }
});
