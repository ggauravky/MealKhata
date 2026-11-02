import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

import { createMealHistorySnapshotModel } from '../src/meals/mealHistorySnapshot.model.js';
import { createMealHistorySnapshotRepository } from '../src/meals/mealHistorySnapshot.repository.js';
import { createLegacyMealSnapshotService } from '../src/migrations/legacyMealSnapshot.service.js';
import { assertDistinctDatabaseUris } from '../src/migrations/sourceInventory.service.js';

const HELP_TEXT = `Capture immutable MealKhata legacy-v2 meal snapshots.

Usage:
  npm run capture:legacy-meal-snapshots -- --target-db <mongodb-uri> [--dry-run] [--verify]

Required environment:
  MONGODB_URI  Read-only source database connection

The target database must differ from the source. Dry-run never connects to or
writes the target. Verify reads both databases and performs no writes.`;

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

export function validateLegacySnapshotConnections({ sourceUri, targetUri }) {
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

export async function runLegacyMealSnapshotCapture({ sourceUri, targetUri, dryRun, verify }) {
  validateLegacySnapshotConnections({ sourceUri, targetUri });
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
  const options = parseLegacySnapshotArgs(process.argv.slice(2));
  const report = await runLegacyMealSnapshotCapture({
    sourceUri: process.env.MONGODB_URI,
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
