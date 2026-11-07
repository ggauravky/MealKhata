import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { checksumValue } from '../src/migrations/sourceInventory.service.js';
import { isValidLogicalDate } from '../src/utils/date.js';
import { createFreshRuntimeAttestationBody, initializeFreshV3,
  validateFreshTargetUris } from '../src/config/v3FreshInitialization.js';
import { inspectV3RequiredIndexes } from '../src/config/v3ReleaseReadiness.js';

const action = process.argv[2];
if (!['--prepare', '--execute', '--prepare-runtime'].includes(action) || process.argv.length !== 3) {
  process.stderr.write('Usage: npm run initialize:fresh:v3 -- --prepare|--execute|--prepare-runtime\n');
  process.exitCode = 2;
} else {
  try {
    const sourceDatabase = process.env.FRESH_SOURCE_DATABASE;
    const targetDatabase = process.env.FRESH_TARGET_DATABASE;
    const sourceUri = process.env.MONGODB_URI;
    const targetUri = process.env.FRESH_TARGET_MONGODB_URI;
    validateFreshTargetUris({ sourceUri, targetUri, sourceDatabase, targetDatabase });
    mongoose.set('autoIndex', false);
    await mongoose.connect(targetUri, { autoIndex: false, serverSelectionTimeoutMS: 10_000 });
    const db = mongoose.connection.db;
    if (db.databaseName !== targetDatabase) throw new Error('Target database changed');

    if (action === '--prepare') {
      const superAdminEmail = process.env.FRESH_SUPERADMIN_EMAIL?.trim().toLowerCase();
      const financialStartDate = process.env.FRESH_FINANCIAL_START_DATE;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(superAdminEmail ?? '')
        || !isValidLogicalDate(financialStartDate)) {
        throw new Error('Fresh Super Admin email and financial start date are required');
      }
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();
      for (const { name } of collections) {
        if (await db.collection(name).countDocuments({}, { limit: 1 }) > 0) {
          throw new Error('Fresh target is not empty');
        }
      }
      const hello = await db.admin().command({ hello: 1, maxTimeMS: 2_000 });
      const now = new Date();
      const body = {
        format: 'mealkhata-v3-fresh-init-approval-v1', sourceDatabase,
        targetDatabase, targetClusterIdentity: checksumValue({ setName: hello.setName,
          hosts: [...hello.hosts].sort() }), superAdminEmail, financialStartDate,
        nonce: randomUUID(), issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      };
      process.stdout.write(`${JSON.stringify({ body, signingDigest: checksumValue(body) })}\n`);
    } else if (action === '--prepare-runtime') {
      const manifest = await db.collection('v3_fresh_initializations')
        .findOne({ initializationId: 'mealkhata-v3-fresh' });
      const admin = manifest && await db.collection('user_accounts').findOne({
        userId: manifest.superAdminUserId,
        email: manifest.superAdminEmail, role: 'superadmin', active: true,
      }, { projection: { userId: 1 } });
      if (!manifest || manifest.targetDatabase !== targetDatabase
        || manifest.sourceDatabase !== sourceDatabase
        || !admin
        || !await inspectV3RequiredIndexes(db, { mode: 'fresh' })) {
        throw new Error('Fresh target manifest or indexes are incomplete');
      }
      const body = createFreshRuntimeAttestationBody({
        manifest, buildSha: process.env.V3_RELEASE_BUILD_SHA,
        releaseId: process.env.FRESH_RELEASE_ID,
        launchStage: process.env.FRESH_LAUNCH_STAGE,
      });
      process.stdout.write(`${JSON.stringify({ body, signingDigest: checksumValue(body) })}\n`);
    } else {
      const raw = await readFile(process.env.FRESH_APPROVAL_PATH, 'utf8');
      if (Buffer.byteLength(raw, 'utf8') > 8_192) throw new Error('Approval is oversized');
      const result = await initializeFreshV3({
        db, sourceDatabase, targetDatabase, approval: JSON.parse(raw),
        ownerPublicKey: process.env.V3_RELEASE_OWNER_PUBLIC_KEY,
        operatorPublicKey: process.env.V3_RELEASE_OPERATOR_PUBLIC_KEY,
        superAdminPasswordHash: process.env.FRESH_SUPERADMIN_PASSWORD_HASH,
        execute: true,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } catch {
    process.stderr.write('Fresh initialization failed. Verify target identity, empty state, approval signatures, and configuration.\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}
