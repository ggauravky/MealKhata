# MealKhata 3.0 cutover and rollback checklist

**Task 15 preparation only. Do not execute this checklist without a separately reviewed production executor and written approval for each step.** The current migration CLI accepts only explicitly classified local replica sets. Do not bypass its guard. See the [production control design](V3_PRODUCTION_CUTOVER_ARCHITECTURE.md), [offline source preflight](V3_SOURCE_PREFLIGHT.md) and [student setup procedure](V3_STUDENT_BOOTSTRAP.md).

For every checkbox below, the release journal must record the exact action, plan digest, source/recovery/target identity observations, owner and separate operator approval, one-time nonce, timestamp, artifact fingerprints, result and next stop/go decision. Do not reuse an approval. The owner must approve the real boundary; no date in a test or document is a production selection.

## Decision gate

- [ ] Owner approves the production migration, exact source and target Atlas identities, maintenance window, rollback window and financial start date in writing.
- [ ] Release reviewer closes every Critical and Important finding, reviews passing full CI and browser evidence, and signs the final migration dry-run report.
- [ ] Operators verify distinct source, restore and target identities by cluster ID and database name, and confirm least-privilege credentials and secret storage. Never treat a database name as safety proof.
- [ ] Preserve a tested path for the existing v2 application to read the unchanged source. Record the initial active Render connection identifier without publishing credentials.

## Action gates and operator sequence

| Gate | Separate approved action | Evidence before advancing |
| --- | --- | --- |
| 1 | `read-source-inventory` | Independent Atlas and handshake identities, all collection counts/indexes, participant IDs, date/rate/snapshot/correction coverage and integer-paise totals. Source principal is read-only. |
| 2 | `archive-source` | AES-GCM archive, manifest and authenticated sidecar bound to one source fingerprint; private immutable storage and separately protected key. |
| 3 | `restore-recovery` | Different allowlisted database, exact restored collection checksums and v2 read test. No source writes. |
| 4 | `create-target` | Different allowlisted empty database; scoped credentials; no inherited operational ledgers. |
| 5 | `apply-history` | Imported original IDs, meals, snapshots, corrections, rates and audits have exact checksums and paise. Both fresh Super Admin logins work; boundary is unset. |
| 6 | `freeze-source-writes` | Render instances, workers, queues, push jobs, cron jobs and manual admin writes are stopped; second operator verifies no writer remains. Record freeze time. |
| 7 | `archive-frozen-source` | Final frozen archive, manifest and matching sidecar; compare all collection documents and indexes to the base archive. Inventory v2-only drift separately. |
| 8 | `replay-final-meals` | An exact base/final-bound non-meal review, if needed, and separately signed replay approval; no old liability import. Transactional meal delta and checkpoint verified against frozen archive; historical daily and monthly paise equal exactly. |
| 9 | `configure-financial-boundary` | Owner-approved future boundary and partial-month rule, recorded in release journal and target audit; historical dues remain excluded. |
| 10 | `configure-operations` | Explicit student status/eligibility, optional accounts/Stays/rooms/rent/deposit settings; missing facts remain blocked. |
| 11 | `deploy-backend`, then `deploy-frontend` | Reviewed immutable artifacts, protected target credentials/JWT key, `CANONICAL_ONLY_AUTH=true`, API rewrites, domain/CORS/cookie/WebSocket setup. No public traffic yet. |
| 12 | `switch-connection` | Prior source connection and release rollback handle recorded securely; switch once to reviewed target, with source unchanged. |
| 13 | `open-writes` | Primary and recovery Super Admin login, role/session tests, historical browser/report/paise checks, full finance and index/data audits, smoke tests and monitoring all pass. |

At each gate, a failed check stops writes and preserves both databases and all artifacts. Changing the plan, archive or observed cluster identity invalidates approvals. There is no generic force flag. No application startup task runs migration. The release owner and operator must review the actual commands in the future executor before authorizing gate 1.

## Before write freeze

- [ ] Take a complete encrypted final source backup; verify AES-GCM authentication, manifest, every collection count and checksum, indexes, historical calendar and exact monthly paise baselines. Store an immutable copy and recovery key separately.
- [ ] Capture and authenticate legacy snapshot sidecar against that exact archive without writing to the source. Reject missing dates, revision/checksum mismatch and invalid correction chains.
- [ ] Restore the archive to a separate approved recovery database and compare its fingerprint with the source; test read access using the old application. Protect both original and recovery databases from deletion.
- [ ] Prepare a fresh target with **no old operational ledgers**. Verify old Gaurav, Nikhil and Devansh IDs, historical meals, rates, snapshots, corrections, audit facts and integer-paise totals.
- [ ] Verify new primary and independent recovery Super Admin logins, session revocation, canonical-only mode, member/admin permissions and credential redaction.

## Freeze and final replay

- [ ] Stop all source writes, including jobs, push actions, background services and manual admin edits. Record freeze time and obtain a second operator's confirmation.
- [ ] Create a second encrypted archive and manifest from the frozen source. Generate a new sidecar if any legacy source checksum changed or new legacy day appeared.
- [ ] Compare base and frozen source collection document and index fingerprints. For legitimate v2-only changes, record each collection's before/after counts, checksums, index checksums, external financial references and why it remains in v2. Obtain separate owner/operator approval for replay. Never carry old balances into v3. Unexplained drift stops the cutover.
- [ ] Transactionally replay all changed meal days, snapshot/correction chains and monthly rates with original IDs, timestamps and audit actors. Verify checkpoint and independent final archive comparison. A one-paisa difference is a stop condition. If the delta exceeds 256 documents or 8 MiB, recapture a new base archive and prepare a fresh empty target; do not split the transaction or increase the limit ad hoc.
- [ ] Run pre-cutover data, index, authorization and accounting audits. Retain the source checksum and rollback manifest unchanged.

## Controlled activation

- [ ] Set the **approved** financial start date, including a documented decision for the boundary day and partial month. Historical meals remain viewable but create no new unpaid dues.
- [ ] Configure Render backend for the reviewed target Atlas connection, protected JWT key, `CANONICAL_ONLY_AUTH=true`, trusted origin and production logging. Activate only after primary and recovery Super Admin credentials work.
- [ ] Verify Vercel frontend build, API rewrites, cookie behavior, WebSocket origin, desktop/mobile pages and PDF/CSV exports against the target.
- [ ] Switch the active MongoDB Atlas connection once, under change control; do not delete, reset, overwrite or repurpose the original database.
- [ ] Run smoke tests for login, student management, daily meals, calendar history, four-person sharing, report totals, new operational payment and room/expense workflows. Compare source historical paise and audits exactly.
- [ ] Run post-cutover verifier and inspect reconciliation, data/index results, error logs and performance. Approve opening writes only after all gates pass.

Check expected backend readiness and authentication endpoints, calendar and historical snapshot display, active and archived student rosters, new meal mutation, exact cost report, room/expense/payment workflows, CSV/PDF export, push/WebSocket channel, CORS and secure cookies from the production domain. Compare error rate, latency and database connection count with the pre-switch baseline. Keep source jobs disabled and monitor for unauthorized v2 writes.

## Rollback decision and procedure

Trigger rollback for a historical mismatch, missing snapshot, one-paisa cost drift, failed account recovery, unauthorized access, unexplained ledger imbalance, index/data audit failure or sustained errors. Stop writes immediately and preserve target logs/checkpoints. Record any v3-only writes for a separately reviewed reconciliation; never silently copy them to v2.

1. Obtain a separate `rollback-connection` approval. Disable v3 writes, jobs and background workers. Preserve target database, application logs and an encrypted target checkpoint. Confirm the old source is unchanged and readable using its frozen fingerprint and immutable archive.
2. Inventory **every v3-only write since `open-writes`**: meals/corrections, payments, reimbursements, room charges/payments, Stays, deposits, credits/allocations, account and student changes. Record document ID, actor, UTC time, amount in integer paise, external reference and status in a restricted reconciliation register. Compare external settlement/bank evidence. Do not silently copy these documents to v2 or mark obligations paid twice. Freeze both sides of each disputed reference until a separately approved manual resolution is documented.
3. Restore Render's prior protected source connection configuration, prior JWT/session policy and prior application release under approved change control. The rollback credential must be independently tested and scoped to the source. Keep the target isolated for investigation; do not delete it.
4. Verify v2 Super Admin access, historical calendar, old payment/Stay/expense ledgers, health/readiness and collection checksums against the frozen source. Any expected post-rollback v2 writes are logged separately. Resume v2 writers only on a separate owner approval.
5. Resolve the reconciliation register item by item with owner and finance sign-off. For each external payment/refund, decide whether it remains in v3 for later re-cutover, needs a **new** audited v2 transaction, or requires an external refund. Preserve both source evidence and v3 original records. Confirm total paise and external references reconcile before closing the incident.

The isolated Task 15 rehearsal exercises this connection reversal **after two v3-only payments**, proves those IDs were not copied to v2, detects an orphan claim, and validates every frozen source collection checksum. It does not grant authority to perform a production switch.
