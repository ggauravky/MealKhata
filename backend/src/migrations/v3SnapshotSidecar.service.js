import { createHmac, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import { fromExtendedJson, toExtendedJson, verifyAndDecryptBackup } from '../backup/backupEngine.js';
import { buildLegacyMealSnapshot, verifyLegacyMealSnapshot } from './legacyMealSnapshot.service.js';
import { checksumValue } from './sourceInventory.service.js';

function authenticatedPayload(sidecar) {
  return { format: sidecar.format, archiveChecksum: sidecar.archiveChecksum,
    manifestChecksum: sidecar.manifestChecksum, snapshots: sidecar.snapshots };
}

function signature(payload, encryptionKey) {
  return createHmac('sha256', encryptionKey).update(checksumValue(payload)).digest('hex');
}

function assertArchive(archive, sourceManifest, encryptionKey) {
  const verified = verifyAndDecryptBackup({ backupPackageString: archive, encryptionKey });
  if (checksumValue(verified.manifest) !== checksumValue(sourceManifest)) {
    throw new Error('Snapshot sidecar source manifest differs from encrypted archive');
  }
  return verified;
}

/** Captures missing legacy-v2 authorities from a verified, read-only archive. */
export function createLegacySnapshotSidecar({ archive, sourceManifest, encryptionKey }) {
  const verified = assertArchive(archive, sourceManifest, encryptionKey);
  const existing = new Map((verified.rawData.meal_history_snapshots ?? [])
    .map(raw => { const snapshot = fromExtendedJson(raw); return [snapshot.date, snapshot]; }));
  const snapshots = [];
  for (const raw of verified.rawData.meal_days ?? []) {
    const day = fromExtendedJson(raw);
    if (day.schemaVersion === 3) continue;
    const stored = existing.get(day.date);
    if (stored) { verifyLegacyMealSnapshot(day, stored); continue; }
    snapshots.push(toExtendedJson({ ...buildLegacyMealSnapshot(day),
      _id: new mongoose.Types.ObjectId(checksumValue(`legacy-v2:${day.date}`).slice(0, 24)) }));
  }
  const payload = { format: 'mealkhata-v3-snapshot-sidecar-v1',
    archiveChecksum: verified.manifest.sha256Checksum,
    manifestChecksum: checksumValue(verified.manifest), snapshots };
  return { ...payload, hmacSha256: signature(payload, encryptionKey) };
}

export function verifyLegacySnapshotSidecar({ archive, sourceManifest, encryptionKey, snapshotSidecar }) {
  const verified = assertArchive(archive, sourceManifest, encryptionKey);
  if (!snapshotSidecar || snapshotSidecar.format !== 'mealkhata-v3-snapshot-sidecar-v1'
    || snapshotSidecar.archiveChecksum !== verified.manifest.sha256Checksum
    || snapshotSidecar.manifestChecksum !== checksumValue(verified.manifest)
    || !Array.isArray(snapshotSidecar.snapshots)
    || !/^[a-f0-9]{64}$/.test(snapshotSidecar.hmacSha256 ?? '')) {
    throw new Error('Snapshot sidecar archive identity or checksum mismatch');
  }
  const expected = Buffer.from(signature(authenticatedPayload(snapshotSidecar), encryptionKey), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(snapshotSidecar.hmacSha256, 'hex'))) {
    throw new Error('Snapshot sidecar authentication failed');
  }
  const sourceDays = new Map((verified.rawData.meal_days ?? []).map(raw => {
    const day = fromExtendedJson(raw); return [day.date, day];
  }));
  const sourceSnapshots = new Set((verified.rawData.meal_history_snapshots ?? []).map(raw => raw.date));
  const dates = new Set();
  for (const raw of snapshotSidecar.snapshots) {
    const snapshot = fromExtendedJson(raw);
    const day = sourceDays.get(snapshot.date);
    if (!day || day.schemaVersion === 3 || sourceSnapshots.has(snapshot.date) || dates.has(snapshot.date)) {
      throw new Error(`Snapshot sidecar has duplicate or unsupported date ${snapshot.date}`);
    }
    dates.add(snapshot.date);
    verifyLegacyMealSnapshot(day, snapshot);
  }
  return snapshotSidecar.snapshots;
}
