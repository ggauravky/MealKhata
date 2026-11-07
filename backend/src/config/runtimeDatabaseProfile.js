import mongoose from 'mongoose';
import { env } from './env.js';

/** Prevent a v3 target from silently running with v2's legacy authentication fallback. */
export async function assertRuntimeDatabaseProfile({ config = env, db = mongoose.connection.db } = {}) {
  if (!db) throw new Error('Runtime database is unavailable');
  const marker = await db.collection('v3_migration_manifests')
    .findOne({ migrationId: 'mealkhata-v3-blue-green' }, { projection: { status: 1 } });
  const fresh = await db.collection('v3_fresh_initializations')
    .findOne({ initializationId: 'mealkhata-v3-fresh' }, { projection: { status: 1 } });
  if (marker && fresh) throw new Error('Conflicting v3 target initialization records');
  if (config.runtimeProfile === 'v2' && (marker || fresh)) {
    throw new Error('A v3 target cannot run with the v2 fallback profile');
  }
  if (config.runtimeProfile === 'v3' && marker?.status !== 'complete' && fresh?.status !== 'complete') {
    throw new Error('MealKhata v3 requires a complete v3 migration or fresh initialization manifest');
  }
}
