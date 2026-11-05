# MealKhata 3.0 cutover and rollback checklist

**Planning document only. Do not execute during Task 14.** The current migration CLI accepts only explicitly classified local replica sets. A separately reviewed production-capable procedure and explicit owner approval are prerequisites to any Atlas cutover. Do not bypass the local-target guard.

## Decision gate

- [ ] Owner approves the production migration, exact source and target Atlas identities, maintenance window, rollback window and financial start date in writing.
- [ ] Release reviewer closes every Critical and Important finding, reviews passing full CI and browser evidence, and signs the final migration dry-run report.
- [ ] Operators verify distinct source, restore and target identities by cluster ID and database name, and confirm least-privilege credentials and secret storage. Never treat a database name as safety proof.
- [ ] Preserve a tested path for the existing v2 application to read the unchanged source. Record the initial active Render connection identifier without publishing credentials.

## Before write freeze

- [ ] Take a complete encrypted final source backup; verify AES-GCM authentication, manifest, every collection count and checksum, indexes, historical calendar and exact monthly paise baselines. Store an immutable copy and recovery key separately.
- [ ] Capture and authenticate legacy snapshot sidecar against that exact archive without writing to the source. Reject missing dates, revision/checksum mismatch and invalid correction chains.
- [ ] Restore the archive to a separate approved recovery database and compare its fingerprint with the source; test read access using the old application. Protect both original and recovery databases from deletion.
- [ ] Prepare a fresh target with **no old operational ledgers**. Verify old Gaurav, Nikhil and Devansh IDs, historical meals, rates, snapshots, corrections, audit facts and integer-paise totals.
- [ ] Verify new primary and independent recovery Super Admin logins, session revocation, canonical-only mode, member/admin permissions and credential redaction.

## Freeze and final replay

- [ ] Stop all source writes, including jobs, push actions, background services and manual admin edits. Record freeze time and obtain a second operator's confirmation.
- [ ] Create a second encrypted archive and manifest from the frozen source. Generate a new sidecar if any legacy source checksum changed or new legacy day appeared.
- [ ] Compare base and frozen source collection fingerprints. Allow only reviewed meal-domain changes; reject unrelated drift.
- [ ] Transactionally replay all changed meal days, snapshot/correction chains and monthly rates with original IDs, timestamps and audit actors. Verify checkpoint and independent final archive comparison. A one-paisa difference is a stop condition.
- [ ] Run pre-cutover data, index, authorization and accounting audits. Retain the source checksum and rollback manifest unchanged.

## Controlled activation

- [ ] Set the **approved** financial start date, including a documented decision for the boundary day and partial month. Historical meals remain viewable but create no new unpaid dues.
- [ ] Configure Render backend for the reviewed target Atlas connection, protected JWT key, `CANONICAL_ONLY_AUTH=true`, trusted origin and production logging. Activate only after primary and recovery Super Admin credentials work.
- [ ] Verify Vercel frontend build, API rewrites, cookie behavior, WebSocket origin, desktop/mobile pages and PDF/CSV exports against the target.
- [ ] Switch the active MongoDB Atlas connection once, under change control; do not delete, reset, overwrite or repurpose the original database.
- [ ] Run smoke tests for login, student management, daily meals, calendar history, four-person sharing, report totals, new operational payment and room/expense workflows. Compare source historical paise and audits exactly.
- [ ] Run post-cutover verifier and inspect reconciliation, data/index results, error logs and performance. Approve opening writes only after all gates pass.

## Rollback decision and procedure

Trigger rollback for a historical mismatch, missing snapshot, one-paisa cost drift, failed account recovery, unauthorized access, unexplained ledger imbalance, index/data audit failure or sustained errors. Stop writes immediately and preserve target logs/checkpoints. Record any v3-only writes for a separately reviewed reconciliation; never silently copy them to v2.

1. Disable new writes and background workers. Confirm the old source is still unchanged and readable using its stored fingerprint and immutable archive.
2. Restore Render's prior protected source connection configuration and prior application release under approved change control. Keep the target isolated for investigation.
3. Verify old Super Admin access, historical calendar, old payment/stay/expense ledgers and health/readiness. Compare collection checksums with the frozen source; document any expected v2 writes after rollback.
4. Announce the rollback decision to operators and maintain both databases and all archives under retention protection. Do not delete either database automatically.

The isolated Task 14 rehearsal exercises this connection reversal and validates source checksums. It does not grant authority to perform a production switch.
