import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { createEncryptedBackup } from '../src/backup/backupEngine.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backupsDir = path.resolve(currentDir, '../../backups');

async function run() {
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();

  if (!encryptionKey) {
    console.error('ERROR: BACKUP_ENCRYPTION_KEY environment variable is required to create an encrypted backup.');
    console.error('Example: BACKUP_ENCRYPTION_KEY="your-secret-key-at-least-16-chars" npm run db:backup');
    process.exit(1);
  }

  if (!env.mongoUri) {
    console.error('ERROR: MONGODB_URI environment variable is required.');
    process.exit(1);
  }

  console.info('Connecting to MongoDB for export...');
  await connectDatabase();

  try {
    await fs.mkdir(backupsDir, { recursive: true });

    console.info('Generating encrypted backup archive...');
    const { manifest, serializedPackage } = await createEncryptedBackup({
      dbConnection: mongoose.connection,
      encryptionKey,
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `mealkhata-backup-${timestamp}.mealkhata-backup`;
    const outputPath = path.join(backupsDir, filename);

    await fs.writeFile(outputPath, serializedPackage, 'utf8');

    console.info('\n✓ Backup created successfully!');
    console.info(`  File: ${outputPath}`);
    console.info(`  Created: ${manifest.createdAt}`);
    console.info(`  Total Records: ${manifest.totalRecords}`);
    console.info(`  Algorithm: ${manifest.algorithm}`);
    console.info(`  SHA-256 Checksum: ${manifest.sha256Checksum}`);
    console.info('\n  Collections:');
    for (const [col, count] of Object.entries(manifest.collections)) {
      console.info(`    - ${col}: ${count}`);
    }
    console.info('');
  } finally {
    await disconnectDatabase();
  }
}

run().catch((error) => {
  console.error(`Backup failed: ${error.message}`);
  process.exit(1);
});
