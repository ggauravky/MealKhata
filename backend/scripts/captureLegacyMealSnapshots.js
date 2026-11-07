import 'dotenv/config';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

import { createMealHistorySnapshotModel } from '../src/meals/mealHistorySnapshot.model.js';
import { createMealHistorySnapshotRepository } from '../src/meals/mealHistorySnapshot.repository.js';
import { createLegacyMealSnapshotService } from '../src/migrations/legacyMealSnapshot.service.js';
import { assertDistinctDatabaseUris } from '../src/migrations/sourceInventory.service.js';
import { checksumValue } from '../src/migrations/sourceInventory.service.js';
import { createLegacySnapshotSidecar, verifyLegacySnapshotSidecar } from '../src/migrations/v3SnapshotSidecar.service.js';
import { assertIsolatedMigrationTarget, assertIsolatedMigrationTargetUri } from '../src/migrations/v3Migration.service.js';

const HELP_TEXT = `Capture immutable MealKhata legacy-v2 meal snapshots.

Usage:
  npm run capture:legacy-meal-snapshots -- --archive PATH --manifest PATH --sidecar PATH [--verify]
  npm run capture:legacy-meal-snapshots -- --target-db <mongodb-uri> [--dry-run] [--verify]

Required environment:
  MONGODB_URI  Read-only source database connection
  V3_TARGET_CLASSIFICATION=isolated-test  Required for database target mode

The archive sidecar mode reads only the encrypted archive and writes a separate
authenticated artifact. The database mode remains for isolated pre-migration
snapshot capture; its target is not an input to the v3 migration.`;

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index < 0 ? null : argv[index + 1];
}

async function runArchiveSidecar(argv) {
  const archivePath = valueAfter(argv, '--archive');
  const manifestPath = valueAfter(argv, '--manifest');
  const sidecarPath = valueAfter(argv, '--sidecar');
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!archivePath || !manifestPath || !sidecarPath || !encryptionKey) {
    throw new Error('Archive, manifest, sidecar output path and protected encryption key are required');
  }
  const archive = await fs.readFile(archivePath, 'utf8');
  const sourceManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (argv.includes('--verify')) {
    const snapshotSidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
    verifyLegacySnapshotSidecar({ archive, sourceManifest, encryptionKey, snapshotSidecar });
    const expected = createLegacySnapshotSidecar({ archive, sourceManifest, encryptionKey });
    if (checksumValue(snapshotSidecar) !== checksumValue(expected)) {
      throw new Error('Snapshot sidecar does not cover the exact archived legacy days');
    }
    return { verified: true, count: snapshotSidecar.snapshots.length,
      archiveChecksum: snapshotSidecar.archiveChecksum };
  }
  const snapshotSidecar = createLegacySnapshotSidecar({ archive, sourceManifest, encryptionKey });
  if (!argv.includes('--dry-run')) {
    await fs.writeFile(sidecarPath, JSON.stringify(snapshotSidecar, null, 2), { mode: 0o600, flag: 'wx' });
  }
  return { verified: true, dryRun: argv.includes('--dry-run'),
    count: snapshotSidecar.snapshots.length, archiveChecksum: snapshotSidecar.archiveChecksum };
}

export function parseLegacySnapshotArgs(argv) {
  let targetUri = null;
  let dryRun = false;
  let verify = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      dryRun = true;
    } else if (argument === '--verify') {
      verify = true;
    } else if (argument === '--target-db') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--target-db requires a value');
      targetUri = value.trim();
      index += 1;
    } else if (argument.startsWith('--target-db=')) {
      targetUri = argument.slice('--target-db='.length).trim();
      if (!targetUri) throw new Error('--target-db requires a value');
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!targetUri) throw new Error('--target-db is required');
  return { targetUri, dryRun, verify };
}

export function validateLegacySnapshotConnections({ sourceUri, targetUri, targetClassification }) {
  if (typeof sourceUri !== 'string' || !sourceUri.trim()) {
    throw new Error('MONGODB_URI is required for the read-only source database');
  }
  if (typeof targetUri !== 'string' || !targetUri.trim()) {
    throw new Error('--target-db is required');
  }
  try {
    assertDistinctDatabaseUris({ sourceUri, targetUri });
  } catch (error) {
    if (error?.message?.includes('databases must be different')) {
      throw new Error('Source and target must use different databases', { cause: error });
    }
    throw error;
  }
  const sourceDatabase = decodeURIComponent(new URL(sourceUri).pathname.replace(/^\//, ''));
  assertIsolatedMigrationTargetUri(targetUri, targetClassification, sourceDatabase);
}

function sourceReader(connection) {
  return Object.freeze({
    async listLegacyMealDays() {
      return connection.db.collection('meal_days').find({}).sort({ date: 1 }).toArray();
    },
  });
}

async function connect(uri, options = {}) {
  return mongoose.createConnection(uri, {
    autoIndex: false,
    maxPoolSize: 3,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10_000,
    ...options,
  }).asPromise();
}

export async function runLegacyMealSnapshotCapture({ sourceUri, targetUri, dryRun, verify, targetClassification }) {
  validateLegacySnapshotConnections({ sourceUri, targetUri, targetClassification });
  const sourceConnection = await connect(sourceUri);
  let targetConnection = null;

  try {
    if (dryRun && !verify) {
      const service = createLegacyMealSnapshotService({
        source: sourceReader(sourceConnection),
        snapshots: {},
      });
      return service.capture({ dryRun: true });
    }

    targetConnection = await connect(targetUri);
    await assertIsolatedMigrationTarget({ targetConnection,
      targetDbName: targetConnection.db.databaseName,
      sourceDatabase: sourceConnection.db.databaseName, targetClassification });
    const model = createMealHistorySnapshotModel(targetConnection);
    if (!verify) await model.init();
    const snapshots = createMealHistorySnapshotRepository({ model });
    const service = createLegacyMealSnapshotService({
      source: sourceReader(sourceConnection),
      snapshots,
    });
    return service.capture({ verify });
  } finally {
    await Promise.allSettled([
      sourceConnection.close(),
      targetConnection?.close(),
    ]);
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.info(HELP_TEXT);
    return;
  }
  if (process.argv.includes('--archive')) {
    console.info(JSON.stringify(await runArchiveSidecar(process.argv.slice(2)), null, 2));
    return;
  }
  const options = parseLegacySnapshotArgs(process.argv.slice(2));
  const report = await runLegacyMealSnapshotCapture({
    sourceUri: process.env.MONGODB_URI,
    targetClassification: process.env.V3_TARGET_CLASSIFICATION,
    ...options,
  });
  console.info(JSON.stringify(report, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`Legacy meal snapshot capture failed: ${error.message}`);
    process.exitCode = 1;
  });
}
