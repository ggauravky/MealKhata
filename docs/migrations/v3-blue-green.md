# MealKhata 3.0 verified blue-green migration

Task 13 provides tooling only. It does not run at application startup and has not been used against production Atlas.

## Inputs and modes

Use Node.js `>=24.19.0 <25`. Create an encrypted source archive with `npm run db:backup` during an approved migration window. Keep the archive and its `.manifest.json` together; the migration verifies both independently before planning or writing. Set `BACKUP_ENCRYPTION_KEY` through protected environment configuration.

`npm run migrate:v3 -- --dry-run --archive PATH --manifest PATH` verifies the archive and prints a machine-readable plan without connecting to a target. The plan lists retained collections, excluded collections, student IDs, per-date historical classifications, counts, and checksums.

For `--apply`, also provide an explicit isolated `--target-db NAME`, `V3_TARGET_MONGODB_URI`, an empty distinct `V3_RESTORE_MONGODB_URI`, and fresh `V3_SUPERADMIN_EMAIL`, `V3_SUPERADMIN_PASSWORD`, `V3_RECOVERY_SUPERADMIN_EMAIL`, and `V3_RECOVERY_SUPERADMIN_PASSWORD` from protected inputs. The CLI first restores the full encrypted archive into the disposable database and compares its collection/index fingerprints with the source manifest. It then writes only allow-listed history, the student registry, fresh system settings with **no financial start date**, and two new canonical Super Admin accounts into an empty v3 target. Old operational finance and account collections remain only in the archive and original database. The target is never dropped by migration.

`npm run migrate:v3 -- --verify --archive PATH --manifest PATH --target-db NAME` compares every imported meal and correction with source documents and authoritative paise calculations, validates imported date classification and required indexes, and checks that old credentials were not copied. A difference of one paise fails verification. `--report PATH` writes a new JSON report, including the rollback manifest, with private file permissions. Existing reports are not overwritten.

Both the primary and recovery Super Admin credentials are authenticated against the isolated target before the migration checkpoint is marked complete. Only after their access and recovery process have been reviewed should the v3 runtime set `CANONICAL_ONLY_AUTH=true`. That mode rejects legacy credential fallback and userId-less sessions. Keep the source system's compatibility mode until a separately approved cutover.

## Final write-free delta and rollback

After a separately approved source write freeze, capture the final changed `meal_days` as Extended JSON with their original `_id`, calculate the SHA-256 using the migration checksum function, and use `--replay-delta --delta-file PATH --delta-checksum SHA256 --write-free-confirmed` with the same archive, manifest, and target database arguments. Replay checks the source fingerprint, student identities, revisions, exact delta checksum and target conflicts. It is idempotent and records per-date checksums in the target migration manifest. Run `--verify` again after replay.

Rollback is a connection switch to the preserved original database, using the source database and fingerprint in the migration manifest. The tooling does not delete, overwrite, or reset the source. Any interrupted migration leaves checkpoints in `v3_migration_manifests` and refuses an automatic retry against partial state; investigate and prepare a new empty target instead.

Configuring the real financial start date, production cutover, deployment, and Task 14 are separate approval and release steps.
