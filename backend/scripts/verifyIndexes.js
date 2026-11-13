import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import '../src/config/models.js';
import '../src/config/appInitialization.model.js';

/** Every registered model is monitored, so new collections are covered automatically. */
export const MONITORED_MODELS = mongoose.modelNames().sort().map((name) => mongoose.model(name));

function normalizeIndexKey(keyObj) {
  return Object.entries(keyObj)
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

export async function verifyIndexes(dbConnection = mongoose.connection) {
  const results = [];
  let allPassed = true;

  for (const model of MONITORED_MODELS) {
    const collectionName = model.collection.name;
    const modelName = model.modelName;

    // Get expected indexes defined on the schema
    const schemaIndexes = model.schema.indexes();
    // Also include indexes defined directly on schema fields (unique/index: true)
    const expectedKeys = new Map();

    // Default _id index is always expected
    expectedKeys.set('_id:1', {});

    for (const [keyPattern, options] of schemaIndexes) {
      expectedKeys.set(normalizeIndexKey(keyPattern), options);
    }

    for (const [path, schemaType] of Object.entries(model.schema.paths)) {
      if (schemaType._index || schemaType.options?.unique || schemaType.options?.index) {
        const options = schemaType._index && typeof schemaType._index === 'object'
          ? schemaType._index : { unique: Boolean(schemaType.options?.unique) };
        expectedKeys.set(`${path}:1`, options);
      }
    }

    let actualIndexes = [];
    let collectionExists = true;
    let readError = false;

    try {
      actualIndexes = await dbConnection.db.collection(collectionName).indexes();
    } catch (error) {
      if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') collectionExists = false;
      else readError = true;
    }

    const actualByKey = new Map(actualIndexes.map((idx) => [normalizeIndexKey(idx.key), idx]));

    const missing = [];
    for (const [key, expected] of expectedKeys) {
      const actual = actualByKey.get(key);
      if (!actual) { missing.push(key); continue; }
      if (expected.unique && actual.unique !== true) missing.push(`${key} unique`);
      if (expected.sparse && actual.sparse !== true) missing.push(`${key} sparse`);
      if (expected.expireAfterSeconds !== undefined && actual.expireAfterSeconds !== expected.expireAfterSeconds) {
        missing.push(`${key} expireAfterSeconds`);
      }
      if (expected.partialFilterExpression
        && JSON.stringify(actual.partialFilterExpression) !== JSON.stringify(expected.partialFilterExpression)) {
        missing.push(`${key} partialFilterExpression`);
      }
    }

    const status = readError ? 'FAIL' : !collectionExists
      ? 'EMPTY_OR_UNINITIALIZED'
      : missing.length === 0
        ? 'PASS'
        : 'FAIL';

    if (status === 'FAIL') {
      allPassed = false;
    }

    results.push({
      model: modelName,
      collection: collectionName,
      status,
      expectedCount: expectedKeys.size,
      actualCount: actualIndexes.length,
      missing,
    });
  }

  return { passed: allPassed, results };
}

// Direct CLI execution
if (process.argv[1] && process.argv[1].endsWith('verifyIndexes.js')) {
  if (!env.mongoUri) {
    console.error('ERROR: MONGODB_URI is required to run index verification.');
    process.exit(1);
  }

  console.info('Connecting to MongoDB to verify critical indexes...');
  try {
    await connectDatabase();
    const { passed, results } = await verifyIndexes(mongoose.connection);

    console.info('\n--- Index Verification Report ---');
    for (const r of results) {
      const mark = r.status === 'PASS' ? '✓' : r.status === 'EMPTY_OR_UNINITIALIZED' ? '○' : '✗';
      console.info(`${mark} [${r.status}] ${r.model} (${r.collection}): ${r.actualCount}/${r.expectedCount} indexes`);
      if (r.missing.length > 0) {
        console.warn(`   Missing indexes: ${r.missing.join(', ')}`);
      }
    }
    console.info('---------------------------------\n');

    await disconnectDatabase();
    if (!passed) {
      console.error('Index verification failed: missing critical indexes.');
      process.exit(1);
    }
    console.info('All database indexes verified successfully.');
    process.exit(0);
  } catch (error) {
    console.error(`Index verification error: ${error.message}`);
    process.exit(1);
  }
}
