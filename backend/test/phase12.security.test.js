import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { describe, test } from 'node:test';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp, createHelmetOptions } from '../src/app.js';
import { LIFECYCLE_STATES, isDraining, isReady, resetLifecycleStateForTesting, setLifecycleState } from '../src/config/lifecycle.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { createHealthRouter } from '../src/routes/health.routes.js';
import { sanitizeLogMetadata } from '../src/utils/sanitizer.js';
import { createSocketServer } from '../src/socket.js';
import {
  createEncryptedBackup,
  fromExtendedJson,
  restoreDatabase,
  toExtendedJson,
  verifyAndDecryptBackup,
} from '../src/backup/backupEngine.js';
import { verifyDataIntegrity } from '../scripts/verifyData.js';

const ORIGIN = 'http://localhost:5173';

describe('Phase 12: Security & Reliability', () => {
  describe('Security Headers & Fingerprinting', () => {
    test('X-Powered-By is absent and security headers are enforced', async () => {
      const app = createApp();
      const res = await request(app).get('/api/health');

      assert.equal(res.status, 200);
      assert.equal(res.headers['x-powered-by'], undefined, 'x-powered-by must be disabled');
      assert.equal(res.headers['cache-control'], 'no-store', 'API must be no-store');
      assert.match(res.headers['permissions-policy'], /camera=\(\), geolocation=\(\), microphone=\(\)/);
      assert.match(res.headers['content-security-policy'], /default-src 'self'/);
      assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
    });

    test('production Helmet options enable HSTS and strict CSP', () => {
      const prodOptions = createHelmetOptions({ production: true });
      assert.ok(prodOptions.strictTransportSecurity);
      assert.equal(prodOptions.strictTransportSecurity.maxAge, 31_536_000);
      assert.equal(prodOptions.contentSecurityPolicy.directives.objectSrc[0], "'none'");
      assert.equal(prodOptions.contentSecurityPolicy.directives.frameAncestors[0], "'none'");
    });
  });

  describe('Request ID Correlation & Error Handling', () => {
    test('generates secure X-Request-ID on API requests', async () => {
      const app = createApp();
      const res = await request(app).get('/api/health');
      assert.equal(res.status, 200);
      const reqId = res.headers['x-request-id'];
      assert.ok(reqId, 'X-Request-ID must be present');
      assert.match(reqId, /^[a-zA-Z0-9_-]{8,64}$/);
    });

    test('preserves valid client-supplied X-Request-ID', async () => {
      const app = createApp();
      const customId = 'client-correlation-id-12345';
      const res = await request(app)
        .get('/api/health')
        .set('X-Request-ID', customId);
      assert.equal(res.status, 200);
      assert.equal(res.headers['x-request-id'], customId);
    });

    test('replaces invalid/malformed client X-Request-ID with a secure UUID', async () => {
      const app = createApp();
      const invalidId = 'bad!@#$%^&*()<>?;:"';
      const res = await request(app)
        .get('/api/health')
        .set('X-Request-ID', invalidId);
      assert.equal(res.status, 200);
      const reqId = res.headers['x-request-id'];
      assert.notEqual(reqId, invalidId);
      assert.match(reqId, /^[a-zA-Z0-9_-]{8,64}$/);
    });

    test('malformed JSON returns 400 with safe contract', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{"email": "test@example.com", bad-json');

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.message, 'Invalid JSON payload');
      assert.ok(!res.text.includes('SyntaxError:'), 'Stack trace must never be returned');
    });

    test('unknown API routes return 404 JSON, not HTML', async () => {
      const app = createApp();
      const res = await request(app).get('/api/non-existent-endpoint');
      assert.equal(res.status, 404);
      assert.equal(res.body.success, false);
      assert.equal(res.body.message, 'API endpoint not found');
    });
  });

  describe('CSRF & Trusted Origin Enforcement', () => {
    const mockAuthService = {
      authenticateCredentials: async () => {
        const error = new Error('Invalid credentials');
        error.statusCode = 401;
        throw error;
      },
    };

    test('mutating request with matching Origin succeeds', async () => {
      const app = createApp({ auth: createAuthRouter({ service: mockAuthService }) });
      const res = await request(app)
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: 'unknown@example.com', password: 'bad' });
      assert.equal(res.status, 401);
    });

    test('mutating request with foreign Origin returns 403', async () => {
      const app = createApp({ auth: createAuthRouter({ service: mockAuthService }) });
      const res = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'https://malicious-site.example')
        .send({ email: 'unknown@example.com', password: 'bad' });
      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.message, 'Request origin is not allowed.');
    });

    test('GET request is not blocked by origin check', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://another-domain.example');
      assert.equal(res.status, 200);
    });
  });

  describe('Centralized Secret Redaction', () => {
    test('recursively redacts sensitive keys and values', () => {
      const dirty = {
        user: 'gaurav',
        actorRole: 'member', // safe, should not be redacted
        password: 'my-super-secret-password',
        passwordHash: '$2a$12$e80yqV1sK/mK2g05a6N4..X4Zg9YJ7nLq3D',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYWRtaW4ifQ.secret',
        authJwtSecret: 'super-long-secret-key-material-here',
        vapidPrivateKey: 'my-private-vapid-key',
        nested: {
          cookie: 'session=abc12345',
          p256dh: 'raw-push-key',
          mongoUri: 'mongodb+srv://admin:pass123@cluster0.mongodb.net/mealkhata',
        },
      };

      const clean = sanitizeLogMetadata(dirty);
      assert.equal(clean.user, 'gaurav');
      assert.equal(clean.actorRole, 'member');
      assert.equal(clean.password, '[REDACTED]');
      assert.equal(clean.passwordHash, '[REDACTED]');
      assert.equal(clean.token, '[REDACTED]');
      assert.equal(clean.authJwtSecret, '[REDACTED]');
      assert.equal(clean.vapidPrivateKey, '[REDACTED]');
      assert.equal(clean.nested.cookie, '[REDACTED]');
      assert.equal(clean.nested.p256dh, '[REDACTED]');
      assert.equal(clean.nested.mongoUri, '[REDACTED]');
    });

    test('redacts raw MongoDB URIs and JWTs embedded in text', () => {
      const text = 'Failed to connect to mongodb+srv://user:secretpass@cluster.mongodb.net/test with error';
      const clean = sanitizeLogMetadata(text);
      assert.ok(!clean.includes('secretpass'));
      assert.ok(clean.includes('mongodb://[REDACTED_URI]'));
    });
  });

  describe('Health, Readiness & Lifecycle Draining', () => {
    test('GET /api/health returns safe operational status without secrets', async () => {
      const app = createApp();
      const res = await request(app).get('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.service, 'MealKhata');
      assert.equal(res.body.status, 'ok');
      assert.ok(typeof res.body.uptimeSeconds === 'number');
      assert.equal(res.body.database, undefined, 'Raw db state should not leak');
    });

    test('GET /api/ready returns 503 when draining', async () => {
      const mockReadiness = async () => true;
      const mockDraining = () => true;
      const router = createHealthRouter({ readiness: mockReadiness, drainingCheck: mockDraining });
      const app = createApp({ health: router });

      const res = await request(app).get('/api/ready');
      assert.equal(res.status, 503);
      assert.equal(res.body.success, false);
      assert.equal(res.body.status, 'draining');
    });

    test('GET /api/ready returns 503 when DB is unavailable', async () => {
      const mockReadiness = async () => false;
      const mockDraining = () => false;
      const router = createHealthRouter({ readiness: mockReadiness, drainingCheck: mockDraining });
      const app = createApp({ health: router });

      const res = await request(app).get('/api/ready');
      assert.equal(res.status, 503);
      assert.equal(res.body.success, false);
      assert.equal(res.body.status, 'unavailable');
    });

    test('lifecycle state transitions update isDraining() and isReady()', () => {
      resetLifecycleStateForTesting();
      assert.equal(isReady(), false);
      assert.equal(isDraining(), false);

      setLifecycleState(LIFECYCLE_STATES.READY);
      assert.equal(isReady(), true);
      assert.equal(isDraining(), false);

      setLifecycleState(LIFECYCLE_STATES.DRAINING);
      assert.equal(isReady(), false);
      assert.equal(isDraining(), true);

      setLifecycleState(LIFECYCLE_STATES.STOPPED);
      assert.equal(isReady(), false);
      assert.equal(isDraining(), true);

      resetLifecycleStateForTesting();
    });
  });

  describe('Socket.IO Production Hardening', () => {
    test('creates Socket.IO server with hardened origin configuration', () => {
      const mockHttpServer = createHttpServer();
      const io = createSocketServer(mockHttpServer);
      assert.ok(io);
      assert.equal(io.path(), '/socket.io');
      assert.equal(io._serveClient, false);
    });
  });

  describe('Extended JSON BSON Fidelity', () => {
    test('round-trips ObjectIds and Dates with full fidelity', () => {
      const testId = new mongoose.Types.ObjectId();
      const testDate = new Date('2026-10-01T12:00:00.000Z');

      const originalDoc = {
        _id: testId,
        date: testDate,
        amount: 500,
        nested: {
          refId: testId,
        },
      };

      const extJson = toExtendedJson(originalDoc);
      assert.deepEqual(extJson._id, { $oid: testId.toString() });
      assert.deepEqual(extJson.date, { $date: testDate.toISOString() });

      const restored = fromExtendedJson(extJson);
      assert.ok(restored._id instanceof mongoose.Types.ObjectId);
      assert.equal(restored._id.toString(), testId.toString());
      assert.ok(restored.date instanceof Date);
      assert.equal(restored.date.toISOString(), testDate.toISOString());
      assert.equal(restored.amount, 500);
    });
  });

  describe('Encrypted Backup & Verification Engine', () => {
    const mockDbConnection = {
      db: {
        collection: () => ({
          find: () => ({
            toArray: async () => [
              {
                _id: new mongoose.Types.ObjectId(),
                date: '2026-10-01',
                meals: { morning: { gaurav: 'taking' } },
                createdAt: new Date('2026-10-01T04:30:00.000Z'),
              },
            ],
          }),
        }),
      },
    };

    const TEST_KEY = 'super-secret-backup-encryption-key-32b';

    test('creates an encrypted backup with valid manifest and checksum', async () => {
      const { manifest, serializedPackage } = await createEncryptedBackup({
        dbConnection: mockDbConnection,
        encryptionKey: TEST_KEY,
        appVersion: '0.1.0',
      });

      assert.equal(manifest.formatVersion, 1);
      assert.equal(manifest.algorithm, 'aes-256-gcm');
      assert.ok(manifest.sha256Checksum);
      assert.ok(manifest.totalRecords > 0);

      const pkg = JSON.parse(serializedPackage);
      assert.equal(pkg.format, 'mealkhata-encrypted-backup-v1');
      assert.ok(pkg.crypto.salt);
      assert.ok(pkg.crypto.iv);
      assert.ok(pkg.crypto.authTag);
      assert.ok(pkg.ciphertext);
    });

    test('verifies and decrypts backup successfully with correct key', async () => {
      const { serializedPackage } = await createEncryptedBackup({
        dbConnection: mockDbConnection,
        encryptionKey: TEST_KEY,
      });

      const { manifest, rawData } = verifyAndDecryptBackup({
        backupPackageString: serializedPackage,
        encryptionKey: TEST_KEY,
      });

      assert.equal(manifest.formatVersion, 1);
      assert.ok(rawData.meal_days);
      assert.equal(rawData.meal_days.length, 1);
      assert.equal(rawData.meal_days[0].date, '2026-10-01');
    });

    test('fails verification on incorrect encryption key', async () => {
      const { serializedPackage } = await createEncryptedBackup({
        dbConnection: mockDbConnection,
        encryptionKey: TEST_KEY,
      });

      assert.throws(
        () => {
          verifyAndDecryptBackup({
            backupPackageString: serializedPackage,
            encryptionKey: 'wrong-key-with-different-secret-data',
          });
        },
        /Backup decryption failed/,
      );
    });

    test('fails verification if archive is tampered', async () => {
      const { serializedPackage } = await createEncryptedBackup({
        dbConnection: mockDbConnection,
        encryptionKey: TEST_KEY,
      });

      const pkg = JSON.parse(serializedPackage);
      // Tamper with ciphertext
      pkg.ciphertext = 'deadbeef' + pkg.ciphertext.slice(8);

      assert.throws(
        () => {
          verifyAndDecryptBackup({
            backupPackageString: JSON.stringify(pkg),
            encryptionKey: TEST_KEY,
          });
        },
        /Backup decryption failed/,
      );
    });
  });

  describe('Data Consistency Audit Invariants', () => {
    test('flags invalid meal status without mutating', async () => {
      const mockDb = {
        collection: (name) => ({
          find: () => ({
            toArray: async () => {
              if (name === 'meal_days') {
                return [
                  {
                    date: '2026-10-01',
                    meals: { morning: { gaurav: 'invalid_status_here' } },
                  },
                ];
              }
              return [];
            },
          }),
        }),
      };

      const { passed, issues } = await verifyDataIntegrity({ db: mockDb });
      assert.equal(passed, false);
      assert.ok(issues.some((i) => i.includes('Invalid status invalid_status_here')));
    });

    test('flags closed settlement discrepancy between member sums and room totals', async () => {
      const mockDb = {
        collection: (name) => ({
          find: () => ({
            toArray: async () => {
              if (name === 'monthly_settlements') {
                return [
                  {
                    month: '2026-09',
                    status: 'closed',
                    snapshot: {
                      members: {
                        gaurav: { morningCount: 10, totalPlates: 10, billAmountPaise: 5000, paidAmountPaise: 5000, remainingAmountPaise: 0 },
                        nikhil: { morningCount: 10, totalPlates: 10, billAmountPaise: 5000, paidAmountPaise: 5000, remainingAmountPaise: 0 },
                        devansh: { morningCount: 10, totalPlates: 10, billAmountPaise: 5000, paidAmountPaise: 5000, remainingAmountPaise: 0 },
                      },
                      room: {
                        morningCount: 30,
                        totalPlates: 30,
                        billAmountPaise: 99999, // Intentional mismatch
                        paidAmountPaise: 15000,
                      },
                    },
                  },
                ];
              }
              return [];
            },
          }),
        }),
      };

      const { passed, issues } = await verifyDataIntegrity({ db: mockDb });
      assert.equal(passed, false);
      assert.ok(issues.some((i) => i.includes('Closed snapshot member sums do not equal room total')));
    });
  });

  describe('Full Recovery Drill Simulation', () => {
    test('end-to-end backup, verification, restore, and post-restore integrity', async () => {
      const targetStore = {};
      const sourceData = {
        member_accounts: [
          { memberId: 'gaurav', email: 'gaurav@mealkhata.local', passwordHash: '$2a$12$e80yqV1sK/mK2g05a6N4..X4Zg9YJ7nLq3D', active: true },
          { memberId: 'nikhil', email: 'nikhil@mealkhata.local', passwordHash: '$2a$12$e80yqV1sK/mK2g05a6N4..X4Zg9YJ7nLq3D', active: true },
          { memberId: 'devansh', email: 'devansh@mealkhata.local', passwordHash: '$2a$12$e80yqV1sK/mK2g05a6N4..X4Zg9YJ7nLq3D', active: true },
        ],
        meal_days: [
          {
            date: '2026-10-01',
            meals: {
              morning: { gaurav: 'taking', nikhil: 'skip', devansh: 'taking' },
              night: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
            },
            revision: 1,
            changes: [],
          },
        ],
        monthly_meal_rates: [
          { month: '2026-10', morningPricePaise: 4000, nightPricePaise: 6000, revision: 1, changes: [] },
        ],
        payments: [],
        payment_settings: [{ key: 'default', receiverName: 'Gaurav Kumar', upiId: 'gaurav@upi' }],
        reminder_settings: [
          {
            key: 'default',
            reminders: {
              morning: { enabled: true, time: '07:30' },
              night: { enabled: true, time: '20:00' },
            },
          },
        ],
        monthly_settlements: [],
        push_subscriptions: [],
        push_deliveries: [],
      };

      const sourceConnection = {
        db: {
          collection: (name) => ({
            find: () => ({
              toArray: async () => sourceData[name] || [],
            }),
          }),
        },
      };

      const targetConnection = {
        db: {
          collection: (name) => ({
            drop: async () => {
              targetStore[name] = [];
            },
            insertMany: async (docs) => {
              targetStore[name] = docs;
            },
            find: () => ({
              toArray: async () => targetStore[name] || [],
            }),
          }),
        },
      };

      const TEST_KEY = 'super-secret-backup-encryption-key-32b';

      // Step A: Create backup
      const { manifest, serializedPackage } = await createEncryptedBackup({
        dbConnection: sourceConnection,
        encryptionKey: TEST_KEY,
      });

      assert.equal(manifest.collections.member_accounts, 3);
      assert.equal(manifest.collections.meal_days, 1);
      assert.ok(manifest.sha256Checksum);

      // Step B: Verify backup
      const verified = verifyAndDecryptBackup({
        backupPackageString: serializedPackage,
        encryptionKey: TEST_KEY,
      });
      assert.equal(verified.manifest.sha256Checksum, manifest.sha256Checksum);

      // Step C: Restore to target database
      const restored = await restoreDatabase({
        backupPackageString: serializedPackage,
        encryptionKey: TEST_KEY,
        targetDbConnection: targetConnection,
        dropExisting: true,
      });
      assert.equal(restored.success, true);
      assert.equal(restored.restoredCounts.member_accounts, 3);
      assert.equal(restored.restoredCounts.meal_days, 1);

      // Step D: Post-restore data integrity check
      const integrity = await verifyDataIntegrity(targetConnection);
      assert.equal(integrity.passed, true);
      assert.equal(integrity.issues.length, 0);
    });
  });
});
