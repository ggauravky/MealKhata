import fs from 'node:fs/promises';
import { createV3SourcePreflight } from '../src/migrations/v3SourcePreflight.service.js';

function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

async function run() {
  if (process.argv.includes('--help')) {
    console.info('Offline v3 source preflight: --archive PATH --manifest PATH --snapshot-sidecar PATH [--report PATH]');
    console.info('Requires BACKUP_ENCRYPTION_KEY. Reads verified local artifacts only; opens no database connection.');
    return;
  }
  const archivePath = argument('--archive');
  const manifestPath = argument('--manifest');
  const sidecarPath = argument('--snapshot-sidecar');
  if (!archivePath || !manifestPath || !sidecarPath || !process.env.BACKUP_ENCRYPTION_KEY) {
    throw new Error('Verified archive, manifest, snapshot sidecar and protected key are required');
  }
  const [archive, manifest, sidecar] = await Promise.all([
    fs.readFile(archivePath, 'utf8'), fs.readFile(manifestPath, 'utf8'),
    fs.readFile(sidecarPath, 'utf8'),
  ]);
  const report = createV3SourcePreflight({ archive, sourceManifest: JSON.parse(manifest),
    snapshotSidecar: JSON.parse(sidecar), encryptionKey: process.env.BACKUP_ENCRYPTION_KEY });
  const destination = argument('--report');
  if (destination) await fs.writeFile(destination, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  console.info(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

run().catch(() => {
  console.error('Offline source preflight failed verification. Credentials and paths are not printed.');
  process.exitCode = 1;
});
