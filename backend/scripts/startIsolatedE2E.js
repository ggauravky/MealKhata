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

/**
 * Prepares the disposable database exactly like a fresh production install: the one-time
 * setup creates the Super Admin and system settings, and nothing else. Set
 * E2E_SKIP_SETUP=true to inspect the pre-setup state instead.
 */
async function seedDatabase(uri) {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = uri;
  process.env.APP_TIMEZONE = 'Asia/Kolkata';
  process.env.AUTH_JWT_SECRET = 'isolated-e2e-jwt-secret-at-least-thirty-two-bytes';
  process.env.APP_ORIGIN = frontendOrigin;
  await mongoose.connect(uri);
  try {
    const { ensureRequiredIndexes, initializeApplication } = await import('../src/config/initialization.js');
    await ensureRequiredIndexes();
    if (process.env.E2E_SKIP_SETUP === 'true') return;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await initializeApplication({
      email: 'superadmin@example.test',
      financialStartDate: `${today.slice(0, 7)}-01`,
      passwordHash: await bcrypt.hash(testPassword, 12),
    });
  } finally {
    await mongoose.disconnect();
  }
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
  frontendOrigin = `http://127.0.0.1:${frontendPort}`;
  backendOrigin = `http://127.0.0.1:${backendPort}`;

  mongoDataDirectory = await mkdtemp(path.join(tmpdir(), 'mealkhata-e2e-'));
  replSet = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath: mongoDataDirectory }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const mongoUri = replSet.getUri('mealkhata_e2e');
  await seedDatabase(mongoUri);

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
  console.info('Super Admin: superadmin@example.test (credentials are defined only in the isolated test fixture)');
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

main().catch((error) => {
  console.error(error);
  void shutdown(1);
});
