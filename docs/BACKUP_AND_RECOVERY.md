# MealKhata Backup & Disaster Recovery Guide

This document defines the primary and secondary backup architecture, encryption model, verification steps, and recovery procedures for MealKhata.

---

## 1. Backup Strategy Overview

MealKhata employs a defense-in-depth data protection strategy:

1. **Primary Production Backup (Native MongoDB Atlas)**:
   - Automated daily snapshots retained per Atlas retention policies.
   - Continuous cloud backups with point-in-time recovery (PITR) where available on dedicated tiers.
   - Recommended for full infrastructure recovery.
2. **Secondary Application-Level Encrypted Backup (`npm run db:backup`)**:
   - Generates an encrypted, compressed, stand-alone archive of all business collections.
   - Serialized in **BSON Extended JSON** to preserve full fidelity of `ObjectId` and `Date` types.
   - Encrypted with **AES-256-GCM** using a key derived via PBKDF2 (100,000 rounds, SHA-256).
   - Generates a cryptographically signed SHA-256 integrity checksum and metadata manifest.
   - Recommended for manual cold-storage backups, audits, and database migrations.

---

## 2. Recovery Objectives

- **Recovery Point Objective (RPO)**: $\le 24\text{ hours}$ (daily backup) or continuous via Atlas snapshots.
- **Recovery Time Objective (RTO)**: $\le 15\text{ minutes}$ to restore to a clean test or production database.

---

## 3. Scope: What Data is Backed Up

The backup engine captures all business and operational collections:

| Collection | Importance | Sensitivity |
| :--- | :--- | :--- |
| `member_accounts` | Critical | High (bcrypt password hashes) |
| `meal_days` | Critical | Medium (roommate daily meal statuses) |
| `monthly_meal_rates` | Critical | Medium (approved monthly meal prices) |
| `payments` | Critical | High (payment ledger, UPI references) |
| `payment_settings` | Critical | Medium (receiver payment configurations) |
| `reminder_settings` | Operational | Low (meal reminder schedule) |
| `monthly_settlements` | Critical | High (audit financial closure snapshots) |
| `push_subscriptions` | Operational | High (device push subscription tokens) |
| `push_deliveries` | Operational | Low (deduplication dispatch keys) |

> [!WARNING]
> Because backups contain password hashes, payment references, and household financial records, **all backup files are strictly confidential**. Never commit backup files to Git or store them on public file shares.

---

## 4. Creating an Encrypted Backup

To generate a new encrypted backup archive:

```bash
# 1. Set the backup encryption key (minimum 16 characters)
export BACKUP_ENCRYPTION_KEY="your-strong-backup-passphrase-at-least-16-chars"

# 2. Run the backup command
npm run db:backup
```

### Output:
- Saved to: `backups/mealkhata-backup-<timestamp>.mealkhata-backup`
- Displays record counts per collection and SHA-256 checksum.
- Never prints sensitive record data or plain text passwords.

> [!NOTE]
> `BACKUP_ENCRYPTION_KEY` is an operational CLI-only variable. It is **never** required for starting the MealKhata Web Service.

---

## 5. Verifying a Backup Archive

Before trusting a backup file, verify its integrity and decryptability without restoring:

```bash
BACKUP_ENCRYPTION_KEY="your-strong-backup-passphrase-at-least-16-chars" \
  npm run db:backup:verify -- backups/mealkhata-backup-<timestamp>.mealkhata-backup
```

Verification verifies:
- File envelope structure and format version.
- Decryption with AES-256-GCM and authentication tag validity.
- Decompression integrity.
- SHA-256 checksum match against decrypted data.
- Presence of all required collections and valid record counts.

---

## 6. Restoration Procedure & Recovery Drill

To recover from a backup into a new database or perform an operational drill:

```bash
# Step 1: Set the target restore URI (must NOT be the production database)
export RESTORE_MONGODB_URI="mongodb://localhost:27017/mealkhata-restore-drill"
export BACKUP_ENCRYPTION_KEY="your-strong-backup-passphrase-at-least-16-chars"

# Step 2: Execute restore with --drop to cleanly recreate collections
npm run db:restore -- backups/mealkhata-backup-<timestamp>.mealkhata-backup --drop
```

### Safety Protections Built into `db:restore`:
1. **Accidental Production Overwrite Guard**: If `RESTORE_MONGODB_URI` matches the production `MONGODB_URI`, the restore tool immediately aborts unless `--confirm-overwrite-production` is explicitly passed.
2. **Automated Post-Restore Data Audit**: Immediately after documents are restored, the tool automatically executes `verifyDataIntegrity` against the target database, confirming that:
   - All restored `ObjectId` and `Date` types have preserved their native BSON types.
   - All member totals in closed settlements sum exactly to room totals.
   - Zero corrupted payment or meal status entries exist.

---

## 7. Storage & Retention Recommendations

1. **Do not rely on Render's local disk**: Render Web Service containers have ephemeral filesystems. Any file written to `./backups` will be lost when the service restarts or redeploys.
2. **Offsite Storage**: Copy verified backup archives to encrypted cold storage (e.g. AWS S3 with Glacier Instant Retrieval, Google Cloud Storage, or an encrypted offline drive).
3. **Retention Schedule**:
   - Daily backups: retain for 14 days.
   - Weekly backups: retain for 8 weeks.
   - Monthly settlement snapshots: retain indefinitely.
