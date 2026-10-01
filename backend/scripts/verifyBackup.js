import fs from 'node:fs/promises';
import { verifyAndDecryptBackup } from '../src/backup/backupEngine.js';

async function run() {
  const filePath = process.argv[2];
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();

  if (!filePath) {
    console.error('Usage: npm run db:backup:verify -- <path-to-backup-file>');
    process.exit(1);
  }

  if (!encryptionKey) {
    console.error('ERROR: BACKUP_ENCRYPTION_KEY environment variable is required to verify the encrypted backup.');
    process.exit(1);
  }

  console.info(`Reading backup file: ${filePath}`);
  const backupPackageString = await fs.readFile(filePath, 'utf8');

  console.info('Decrypting and verifying archive integrity...');
  const { manifest, rawData } = verifyAndDecryptBackup({
    backupPackageString,
    encryptionKey,
  });

  console.info('\n✓ Backup verification PASSED!');
  console.info(`  App Version: ${manifest.appVersion}`);
  console.info(`  Format Version: ${manifest.formatVersion}`);
  console.info(`  Created At: ${manifest.createdAt}`);
  console.info(`  Total Records: ${manifest.totalRecords}`);
  console.info(`  SHA-256 Checksum: ${manifest.sha256Checksum} (Verified)`);
  console.info('\n  Verified Collections:');
  for (const [col, count] of Object.entries(manifest.collections)) {
    const inData = rawData[col]?.length ?? 0;
    console.info(`    - ${col}: ${count} records (verified in data: ${inData})`);
  }
  console.info('');
}

run().catch((error) => {
  console.error(`\n✗ Backup verification FAILED: ${error.message}`);
  process.exit(1);
});
