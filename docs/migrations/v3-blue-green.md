# MealKhata 3.0 blue-green migration rehearsal

Task 14 tools are restricted to an explicitly classified **local isolated-test replica set**. They do not connect to or create a production Atlas target. Use Node.js `>=24.19.0 <25`. Every operation below uses disposable databases and protected, unique credentials. Keep the original database read-only throughout the rehearsal.

## Archive and snapshot handoff

1. Set `BACKUP_ENCRYPTION_KEY` from a protected secret store. Run `npm run db:backup` against the authorized read-only source. The backup includes a manifest and read-only historical calendar and integer-paise monthly baselines that use the active report's fixed-price policy and any saved daily overrides. Stored monthly rate documents remain in the archive for exact historical comparison. It works when an original v2 database has no `students` or `meal_history_snapshots` collection; it writes neither collection to the source.
2. Verify the encrypted archive and its separate manifest. Preserve both artifacts. Do not edit either.
3. Run `npm run capture:legacy-meal-snapshots --workspace backend -- --archive PATH --manifest PATH --sidecar PATH`. Then repeat with `--verify`. The sidecar is authenticated with HMAC-SHA256 using the archive key and bound to the exact archive checksum, source fingerprint, date, revision and source checksum. A changed source needs a new independently archived state and a new sidecar. Missing or mismatched authority fails closed.
4. The older `--target-db` snapshot capture mode is only for isolated local verification and is **not** a migration input. It requires `V3_TARGET_CLASSIFICATION=isolated-test` and a local replica-set target.

## Local apply and verification

Set `V3_TARGET_CLASSIFICATION=isolated-test`, `V3_TARGET_MONGODB_URI` and `V3_RESTORE_MONGODB_URI` to distinct empty databases on a local replica set. Supply fresh `V3_SUPERADMIN_EMAIL`, `V3_SUPERADMIN_PASSWORD`, `V3_RECOVERY_SUPERADMIN_EMAIL` and `V3_RECOVERY_SUPERADMIN_PASSWORD` through protected environment inputs. These must differ from every archived credential. No production override exists. A database name containing `v3` or `test` alone conveys no trust; URI host, connected cluster identity, explicit classification and source/target distinctness are checked.

Run `npm run migrate:v3 -- --dry-run --archive PATH --manifest PATH --snapshot-sidecar PATH`. This verifies input and prints a plan without connecting to a target. Run `npm run db:restore -- PATH` with an explicit local `RESTORE_MONGODB_URI` and `RESTORE_TARGET_CLASSIFICATION=isolated-test` to rehearse a complete archive restore. Apply with `npm run migrate:v3 -- --apply --archive PATH --manifest PATH --snapshot-sidecar PATH --target-db NAME`. Apply restores and verifies the complete archive to the disposable restore database before writing the separate empty v3 target.

The v3 target receives allow-listed historical meals, snapshots, corrections, rates and students; two fresh Super Admin accounts; and a system setting with **no financial start date**. It excludes old operational payment, room, expense and deposit ledgers. The source remains untouched. Apply is idempotent for an already complete identical target; unknown or partial targets are rejected.

Run `npm run migrate:v3 -- --verify --stage pre-cutover --archive PATH --manifest PATH --snapshot-sidecar PATH --target-db NAME --report PATH`. Verification checks every imported historical document, exact paise, fresh accounts, references, indexes, data integrity, excluded old ledgers and the unset boundary. A one-paisa difference fails. The report includes source and target fingerprints and a rollback manifest. Store reports privately.

## Write-free final meal domain replay

After the **simulated** source is frozen, create a second encrypted archive and manifest from that frozen state. Generate and verify a second sidecar if the final archive contains legacy days without stored snapshots. Run:

`npm run migrate:v3 -- --replay-delta --archive BASE --manifest BASE_MANIFEST --snapshot-sidecar BASE_SIDECAR --final-archive FINAL --final-manifest FINAL_MANIFEST --final-snapshot-sidecar FINAL_SIDECAR --target-db NAME --write-free-confirmed`

Omit `--final-snapshot-sidecar` only when all final legacy days already have verified snapshots in the final archive. The replay compares the entire independently verified frozen source with the base, rejects changes outside the meal domain, and transactionally updates changed `meal_days`, legacy snapshot and correction authority, and monthly rates with their original IDs, timestamps and actors. The checkpoint records the frozen source checksum and per-date authority checksums in the same transaction. An interruption before the checkpoint rolls back all writes; retry is safe. Run `--verify --stage pre-cutover` again with both final archive inputs. The verifier compares the target to the frozen final archive, not merely to the replay checkpoint. A changed legacy source without matching fresh snapshot authority fails.

## Verification stages and rollback

`--stage pre-cutover` requires the clean initial account and finance state. `--stage post-cutover` permits new valid accounts, an explicitly configured financial boundary and new operational ledgers while preserving historical source authority and excluding imported old finance IDs. Post-cutover verification checks account roles, recovery access, references, indexes, data integrity and boundary placement; the isolated browser and backend suites exercise authorization and financial reconciliation. Do not alter the verified source checksum to account for new transactions.

Rollback means switching the application connection back to the protected original source database after stopping writes to the new target. It does not mean deleting the target or restoring over the original. The isolated drill switches an active database reference back to the unchanged source and checks every source collection checksum. A real connection-string change, production cutover, backup, financial start date, Render/Vercel deployment and Atlas operation require a separate reviewed and approved procedure. The Task 14 CLI deliberately rejects production destinations.

Task 15 adds an offline source preflight and an independently reviewable production control design. It does not extend this CLI to Atlas. See [source preflight](../V3_SOURCE_PREFLIGHT.md), [production control design](../V3_PRODUCTION_CUTOVER_ARCHITECTURE.md), and [the cutover and rollback checklist](../V3_CUTOVER_AND_ROLLBACK.md). Do not execute production actions from this local rehearsal guide.
