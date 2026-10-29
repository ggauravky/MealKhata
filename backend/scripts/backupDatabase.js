import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { createEncryptedBackup } from '../src/backup/backupEngine.js';
import { APP_VERSION } from '../src/config/version.js';
import { mealService } from '../src/meals/meal.service.js';
import { reportService } from '../src/reports/report.service.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backupsDir = path.resolve(currentDir, '../../backups');

async function run() {
  if (process.argv.includes('--help')) {
    console.info(`Create an encrypted archive from the configured source database.

Usage: npm run db:backup

Required environment:
  MONGODB_URI             Read-only source database connection
  BACKUP_ENCRYPTION_KEY   Secret containing at least 16 characters

The archive discovers every runtime collection and index and embeds verified
calendar and historical-cost baselines. It does not modify the source database.`);
    return;
  }

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
      appVersion: APP_VERSION,
      baselineReaders: {
        readCalendarDay: (date) => mealService.getDay(date),
        readMonthlyCostReport: (month) => reportService.getMonthlyReport(month),
      },
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `mealkhata-backup-${timestamp}.mealkhata-backup`;
    const outputPath = path.join(backupsDir, filename);

    await fs.writeFile(outputPath, serializedPackage, 'utf8');
    const manifestPath = `${outputPath}.manifest.json`;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    console.info('\n✓ Backup created successfully!');
    console.info(`  File: ${outputPath}`);
    console.info(`  Manifest: ${manifestPath}`);
    console.info(`  Created: ${manifest.createdAt}`);
    console.info(`  Total Records: ${manifest.totalRecords}`);
    console.info(`  Algorithm: ${manifest.algorithm}`);
    console.info(`  SHA-256 Checksum: ${manifest.sha256Checksum}`);
    console.info('\n  Collections:');
    for (const [col, count] of Object.entries(manifest.collections)) {
      console.info(`    - ${col}: ${count}`);
    }
    if (manifest.baselines) {
      console.info('\n  Historical baselines:');
      console.info(`    - Calendar days: ${manifest.baselines.calendarDayCount}`);
      console.info(`    - Monthly cost reports: ${manifest.baselines.monthlyCostReportCount}`);
      console.info(`    - SHA-256: ${manifest.baselines.sha256Checksum}`);
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
