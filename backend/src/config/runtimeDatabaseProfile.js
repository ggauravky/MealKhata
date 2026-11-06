import mongoose from 'mongoose';
import { env } from './env.js';

/** Prevent a v3 target from silently running with v2's legacy authentication fallback. */
export async function assertRuntimeDatabaseProfile({ config = env, db = mongoose.connection.db } = {}) {
  if (!db) throw new Error('Runtime database is unavailable');
  const marker = await db.collection('v3_migration_manifests')
    .findOne({ migrationId: 'mealkhata-v3-blue-green' }, { projection: { status: 1 } });
  if (config.runtimeProfile === 'v2' && marker) {
    throw new Error('A v3 target cannot run with the v2 fallback profile');
  }
  if (config.runtimeProfile === 'v3' && marker?.status !== 'complete') {
    throw new Error('MealKhata v3 requires a complete v3 migration manifest');
  }
}
