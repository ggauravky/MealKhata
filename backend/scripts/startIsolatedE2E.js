import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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

function findAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const probe = (port) => {
      const server = createServer();
      server.unref();
      server.once('error', (error) => {
        server.close();
        if (port === preferredPort && error.code === 'EADDRINUSE') {
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
  process.env.MONGODB_URI = uri;
  process.env.PORT = String(backendPort);
  process.env.APP_ORIGIN = frontendOrigin;
  process.env.APP_TIMEZONE = 'Asia/Kolkata';
  process.env.AUTH_JWT_SECRET = 'isolated-e2e-jwt-secret-at-least-thirty-two-bytes';

  const [{ UserAccount }, { roomFeeService }, { stayService }, { expenseService }] = await Promise.all([
    import('../src/auth/userAccount.model.js'),
    import('../src/roomFees/roomFee.service.js'),
    import('../src/stays/stay.service.js'),
    import('../src/expenses/expense.service.js'),
  ]);

  await mongoose.connect(uri);
  const [indexVerifier, dataVerifier] = await Promise.all([
    import('./verifyIndexes.js'),
    import('./verifyData.js'),
  ]);
  await Promise.all(indexVerifier.MONITORED_MODELS.map((model) => model.init()));

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
      actorRole: 'admin',
    });
    await roomFeeService.createFeePlan({
      memberId,
      amountPaise: memberId === 'gaurav' ? 280000 : 260000,
      effectiveFromMonth: '2026-10',
      actorRole: 'admin',
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

  await roomFeeService.issueCharges('2026-10', 'admin');
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
  frontendOrigin = `http://localhost:${frontendPort}`;
  backendOrigin = `http://localhost:${backendPort}`;

  mongoDataDirectory = await mkdtemp(path.join(tmpdir(), 'mealkhata-e2e-'));
  replSet = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath: mongoDataDirectory }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const mongoUri = replSet.getUri('mealkhata_e2e');
  await seedDatabase(mongoUri, backendPort);

  const sharedEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    MONGODB_URI: mongoUri,
    PORT: String(backendPort),
    APP_ORIGIN: frontendOrigin,
    APP_TIMEZONE: 'Asia/Kolkata',
    AUTH_JWT_SECRET: 'isolated-e2e-jwt-secret-at-least-thirty-two-bytes',
    ENABLE_TEST_LOGS: '1',
    MEALKHATA_API_ORIGIN: backendOrigin,
    VITE_SOCKET_URL: backendOrigin,
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
  console.info(`Password: ${testPassword}`);
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

main().catch((error) => {
  console.error(error);
  void shutdown(1);
});
