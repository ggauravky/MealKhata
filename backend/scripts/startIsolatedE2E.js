import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectory = path.resolve(backendDirectory, '..');
const testPassword = 'E2E-Strong-Pass-2026!';

let replSet;
let backendProcess;
let frontendProcess;
let mongoDataDirectory;
let frontendOrigin;
let backendOrigin;
let shuttingDown = false;
let signedV3Environment = {};
const signedV3 = process.env.E2E_SIGNED_V3 === 'true';

function findAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const probe = (port) => {
      const server = createServer();
      server.unref();
      server.once('error', (error) => {
        server.close();
        if (port === preferredPort && error.code === 'EADDRINUSE'
          && process.env.E2E_REQUIRE_FIXED_PORTS !== 'true') {
          probe(0);
          return;
        }
        reject(error);
      });
      server.listen(port, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => resolve(address.port));
      });
    };
    probe(preferredPort);
  });
}

function startChild(command, args, options, label) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.once('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[${label}] exited unexpectedly (code=${code}, signal=${signal})`);
      void shutdown(1);
    }
  });
  return child;
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 401 || response.status === 503) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'no response'}`);
}

async function seedDatabase(uri, backendPort) {
  process.env.NODE_ENV = 'test';
  process.env.MEALKHATA_RUNTIME_PROFILE = 'v2';
  process.env.MONGODB_URI = uri;
  process.env.PORT = String(backendPort);
  process.env.APP_ORIGIN = frontendOrigin;
  process.env.APP_TIMEZONE = 'Asia/Kolkata';
  process.env.AUTH_JWT_SECRET = 'isolated-e2e-jwt-secret-at-least-thirty-two-bytes';

  const [
    { UserAccount },
    { Student },
    { StudentAuditEvent },
    { SystemSettings },
    { buildLegacyMealSnapshot },
    { roomFeeService },
    { stayService },
    { expenseService },
  ] = await Promise.all([
    import('../src/auth/userAccount.model.js'),
    import('../src/students/student.model.js'),
    import('../src/students/studentAuditEvent.model.js'),
    import('../src/settings/systemSettings.model.js'),
    import('../src/migrations/legacyMealSnapshot.service.js'),
    import('../src/roomFees/roomFee.service.js'),
    import('../src/stays/stay.service.js'),
    import('../src/expenses/expense.service.js'),
  ]);

  await mongoose.connect(uri);
  const [indexVerifier, dataVerifier] = await Promise.all([
    import('./verifyIndexes.js'),
    import('./verifyData.js'),
  ]);
  await Promise.all([
    ...indexVerifier.MONITORED_MODELS.map((model) => model.init()),
    Student.init(),
    StudentAuditEvent.init(),
  ]);

  await Student.create([
    {
      studentId: 'gaurav',
      displayName: 'Gaurav',
      status: 'ACTIVE',
      mealEligibilityFrom: '2026-10-01',
      mealEligibilityUntil: null,
      rosterOrder: 0,
    },
    {
      studentId: 'nikhil',
      displayName: 'Nikhil',
      status: 'ACTIVE',
      mealEligibilityFrom: null,
      mealEligibilityUntil: null,
      rosterOrder: 10,
    },
    {
      studentId: 'devansh',
      displayName: 'Devansh',
      status: 'ACTIVE',
      mealEligibilityFrom: null,
      mealEligibilityUntil: null,
      rosterOrder: 20,
    },
  ]);
  await SystemSettings.create({ settingsId: 'system', financialStartDate: '2026-10-01',
    configuredAt: new Date(), configuredBy: 'isolated-e2e-fixture' });

  const historicalDay = {
    date: '2026-09-30', revision: 0, financialClassification: 'historical',
    meals: { morning: { gaurav: 'taking', nikhil: 'skip', devansh: 'skip' },
      night: { gaurav: 'skip', nikhil: 'taking', devansh: 'skip' } },
    changes: [], allocationChanges: [], priceChanges: [],
  };
  await mongoose.connection.db.collection('meal_days').insertOne(historicalDay);
  await mongoose.connection.db.collection('meal_history_snapshots').insertOne(buildLegacyMealSnapshot(historicalDay));

  const passwordHash = await bcrypt.hash(testPassword, 12);
  await UserAccount.create([
    {
      userId: randomUUID(),
      memberId: null,
      displayName: 'E2E Super Admin',
      email: 'superadmin@example.test',
      passwordHash,
      role: 'superadmin',
      active: true,
      sessionVersion: 0,
    },
    {
      userId: randomUUID(),
      memberId: null,
      displayName: 'E2E Admin',
      email: 'admin@example.test',
      passwordHash,
      role: 'admin',
      active: true,
      sessionVersion: 0,
    },
    ...['gaurav', 'nikhil', 'devansh'].map((memberId) => ({
      userId: randomUUID(),
      memberId,
      displayName: memberId[0].toUpperCase() + memberId.slice(1),
      email: `${memberId}@example.test`,
      passwordHash,
      role: 'member',
      active: true,
      sessionVersion: 0,
    })),
  ]);

  const lower = await roomFeeService.createRoom({
    roomNumber: 'lower',
    roomLabel: 'Gaurav Room',
    capacity: 1,
    actorRole: 'admin',
  });
  const firstFloor = await roomFeeService.createRoom({
    roomNumber: '1st Floor Room',
    roomLabel: 'Nikhil and Devansh',
    capacity: 2,
    actorRole: 'admin',
  });

  const assignments = {};
  for (const [memberId, roomId] of [
    ['gaurav', lower.roomId],
    ['nikhil', firstFloor.roomId],
    ['devansh', firstFloor.roomId],
  ]) {
    assignments[memberId] = await roomFeeService.assignMemberToRoom({
      memberId,
      roomId,
      effectiveFromMonth: '2026-10',
      effectiveFromDate: '2026-10-01',
      actorRole: 'superadmin',
    });
    await roomFeeService.createFeePlan({
      memberId,
      amountPaise: memberId === 'gaurav' ? 280000 : 260000,
      effectiveFromMonth: '2026-10',
      actorRole: 'superadmin',
    });
  }

  await stayService.createStay({
    memberId: 'gaurav',
    joinedOn: '2026-10-01',
    initialRoomId: lower.roomId,
    admissionMode: 'link_existing_assignment',
    assignmentId: assignments.gaurav.assignmentId,
    expectedDepositPaise: 0,
    actorRole: 'superadmin',
    historicalReason: 'Controlled isolated browser fixture',
  });

  await roomFeeService.issueCharges('2026-10', 'superadmin');
  await expenseService.createExpense({
    date: '2026-10-20',
    title: 'E2E Shared Groceries',
    category: 'groceries',
    description: 'Controlled isolated browser fixture',
    amountPaise: 30000,
    paidByMemberId: 'gaurav',
    splitType: 'equal',
    participants: ['gaurav', 'nikhil', 'devansh'],
    idempotencyKey: randomUUID(),
    actorRole: 'admin',
    actorMemberId: 'gaurav',
  });

  const indexReport = await indexVerifier.verifyIndexes(mongoose.connection);
  if (!indexReport.passed) {
    const failures = indexReport.results.filter((result) => result.status === 'FAIL');
    throw new Error(`Isolated index verification failed: ${JSON.stringify(failures)}`);
  }

  const dataReport = await dataVerifier.verifyDataIntegrity(mongoose.connection);
  if (!dataReport.passed) {
    throw new Error(`Isolated data verification failed: ${dataReport.issues.join('; ')}`);
  }

  console.info(`ISOLATED_INDEX_VERIFICATION_PASS (${indexReport.results.length} models)`);
  console.info(`ISOLATED_DATA_VERIFICATION_PASS (${dataReport.checks.length} checks)`);

  if (signedV3) {
    const { checksumValue } = await import('../src/migrations/sourceInventory.service.js');
    const { MealDay } = await import('../src/meals/meal.model.js');
    const { MealHistorySnapshot } = await import('../src/meals/mealHistorySnapshot.model.js');
    const { MealHistoricalCorrection } = await import('../src/meals/mealHistoricalCorrection.model.js');
    const { MonthlyMealRate } = await import('../src/billing/monthlyRate.model.js');
    await Promise.all([MealDay, MealHistorySnapshot, MealHistoricalCorrection,
      MonthlyMealRate, UserAccount, SystemSettings, Student, StudentAuditEvent]
      .map(model => model.init()));
    const db = mongoose.connection.db;
    const hello = await db.admin().command({ hello: 1 });
    const targetClusterIdentity = checksumValue({ setName: hello.setName,
      hosts: [...hello.hosts].sort() });
    const buildSha = 'e'.repeat(40);
    const body = {
      format: 'mealkhata-v3-runtime-attestation-v1', releaseId: 'isolated-browser-test',
      buildSha, targetDatabase: db.databaseName, targetClusterIdentity,
      sourceChecksum: '1'.repeat(64), sourceManifestChecksum: '2'.repeat(64),
      finalSourceChecksum: '3'.repeat(64), recoveryEvidenceSha256: '4'.repeat(64),
      migrationEvidenceSha256: '5'.repeat(64), stageBPlanDigest: '6'.repeat(64),
      launchStage: 'serving', issuedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    const owner = generateKeyPairSync('ed25519');
    const operator = generateKeyPairSync('ed25519');
    const message = Buffer.from(checksumValue(body));
    const attestation = { body, signatures: {
      owner: sign(null, message, owner.privateKey).toString('base64'),
      operator: sign(null, message, operator.privateKey).toString('base64'),
    } };
    const collection = db.collection('v3_migration_manifests');
    await collection.createIndex({ migrationId: 1 }, { unique: true });
    await collection.insertOne({ migrationId: 'mealkhata-v3-blue-green', status: 'complete',
      sourceChecksum: body.sourceChecksum, sourceManifestChecksum: body.sourceManifestChecksum,
      finalSourceChecksum: body.finalSourceChecksum, targetClusterIdentity });
    const attestationPath = process.env.E2E_V3_ATTESTATION_PATH;
    if (!attestationPath || path.dirname(attestationPath) !== tmpdir()
      || !path.basename(attestationPath).startsWith('mealkhata-v3-e2e-')) {
      throw new Error('Signed v3 browser fixture requires a test-only attestation path');
    }
    await writeFile(attestationPath, JSON.stringify(attestation), { mode: 0o600, flag: 'wx' });
    signedV3Environment = {
      MEALKHATA_RUNTIME_PROFILE: 'v3', V3_RELEASE_BUILD_SHA: buildSha,
      MEALKHATA_OBSERVED_BUILD_SHA: buildSha,
      V3_RELEASE_ATTESTATION_PATH: attestationPath,
      V3_RELEASE_OWNER_PUBLIC_KEY: owner.publicKey.export({ type: 'spki', format: 'pem' }),
      V3_RELEASE_OPERATOR_PUBLIC_KEY: operator.publicKey.export({ type: 'spki', format: 'pem' }),
    };
    console.info('ISOLATED_SIGNED_V3_FIXTURE_READY');
  }

  await mongoose.disconnect();
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [frontendProcess, backendProcess]) {
    if (child && !child.killed) child.kill('SIGTERM');
  }
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
  if (replSet) await replSet.stop().catch(() => {});
  if (signedV3Environment.V3_RELEASE_ATTESTATION_PATH) {
    await unlink(signedV3Environment.V3_RELEASE_ATTESTATION_PATH).catch(() => {});
  }
  if (mongoDataDirectory) {
    await rm(mongoDataDirectory, { recursive: true, force: true }).catch(() => {});
  }
  process.exit(exitCode);
}

async function main() {
  const [frontendPort, backendPort] = await Promise.all([
    findAvailablePort(5173),
    findAvailablePort(5100),
  ]);
  frontendOrigin = `http://127.0.0.1:${frontendPort}`;
  backendOrigin = `http://127.0.0.1:${backendPort}`;

  mongoDataDirectory = await mkdtemp(path.join(tmpdir(), 'mealkhata-e2e-'));
  replSet = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath: mongoDataDirectory }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const mongoUri = replSet.getUri(signedV3 ? 'mealkhata_e2e_v3' : 'mealkhata_e2e');
  await seedDatabase(mongoUri, backendPort);

  const sharedEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    MONGODB_URI: mongoUri,
    PORT: String(backendPort),
    APP_ORIGIN: frontendOrigin,
    APP_TIMEZONE: 'Asia/Kolkata',
    AUTH_JWT_SECRET: 'isolated-e2e-jwt-secret-at-least-thirty-two-bytes',
    CANONICAL_ONLY_AUTH: 'true',
    ENABLE_TEST_LOGS: '1',
    MEALKHATA_API_ORIGIN: backendOrigin,
    VITE_SOCKET_URL: backendOrigin,
    ...signedV3Environment,
  };
  backendProcess = startChild(
    process.execPath,
    ['src/server.js'],
    { cwd: backendDirectory, env: sharedEnvironment },
    'backend',
  );
  frontendProcess = startChild(
    process.execPath,
    [
      path.join(workspaceDirectory, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(frontendPort),
      '--strictPort',
    ],
    { cwd: path.join(workspaceDirectory, 'frontend'), env: sharedEnvironment },
    'frontend',
  );

  await Promise.all([
    waitForUrl(`${backendOrigin}/api/health`),
    waitForUrl(frontendOrigin),
  ]);
  console.info('ISOLATED_E2E_READY');
  console.info(`App: ${frontendOrigin}`);
  console.info('Super Admin: superadmin@example.test');
  console.info('Member: gaurav@example.test');
  console.info('Credentials are defined only in the isolated test fixture.');
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

main().catch((error) => {
  console.error(error);
  void shutdown(1);
});
