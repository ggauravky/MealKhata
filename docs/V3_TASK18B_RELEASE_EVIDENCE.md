# Task 18B: controlled production gates and emergency rollback

**Status: `NOT READY — BLOCKERS REMAIN`.** This is an isolated engineering rehearsal. No genuine Atlas, Render, or Vercel resource was accessed. No owner has authorized a source inventory, financial start date, deployment, connection switch, or cutover. Passing tests cannot grant those approvals.

## Integration architecture

`createTask18AAdapterRegistry` remains limited to `NODE_ENV=test` and `disposable-mock` handlers. The separate `createDormantProductionProviderCatalog` describes one review-only provider per release action, including the emergency action. Every descriptor is bound to the frozen action contract, exact resource fingerprints, one named principal, its expected operation and credential scopes, and an independent checkpoint verifier. It rejects substitutions, duplicate actions, privilege expansion and extra fields. It returns a digest and **no execute method**. It contains no Atlas, Render, Vercel, shell, URI or secret client. The `verifyRenderReleaseObservation` and `verifyVercelReleaseObservation` interfaces validate separately obtained, immutable release and browser evidence; mock results are not production observations.

The four resource identities remain SOURCE, RECOVERY, TARGET and CONTROL. Each must bind project ID, cluster ID, database name, replica set, endpoint identity, principal and exact privileges through independent Atlas, handshake and privilege observers. SOURCE is restricted to `find`, `listCollections`, and `listIndexes`. CONTROL is a separate database for signed approvals and majority-journaled one-use nonces. A live provider must enforce its actual principal and process boundary independently of the descriptor; injected JavaScript is not a security sandbox. No live provider or executable production entrypoint ships in Task 18B.

## Emergency target-outage procedure

The implemented controller is limited to `NODE_ENV=test` isolated rehearsal; **no live emergency executor ships**. A separately reviewed production implementation must enforce the same protocol. This path applies **only** after a completed `switch-connection` checkpoint when the TARGET is independently verified unreachable. It cannot create a target, replay history, set the financial boundary, record a transaction, or open writes.

1. Operationally stop all v3 application writers and background jobs first. If they cannot be stopped, do not switch the connection. Preserve logs, the target outage observation, the last verified target fingerprint, and any available target checkpoint. The outage proof must be from a protected observer, explicitly say `unreachable`, and be no more than five minutes old.
2. Independently observe SOURCE and CONTROL through their Atlas, handshake and privilege interfaces. Verify the journal's *actual connection* matches the full CONTROL identity. Verify the SOURCE still matches the original plan and the frozen archive checkpoint. If SOURCE or CONTROL is unavailable or changed, stop and use a separately reviewed manual incident procedure.
3. Verify the protected previous v2 backend release and source connection configuration, and independently attest that writers are stopped. Obtain **new**, current owner and different operator signatures for `emergency-rollback-connection`, bound to the unchanged Stage B digest, exact action, one-use nonce, and an expiry of at most five minutes. Stage B may have expired; this fresh emergency approval may not.
4. Reserve the nonce and emergency evidence atomically in CONTROL. The journal stores the protected outage reference/digest, outage time, last known TARGET fingerprint, SOURCE and CONTROL identity digests, previous configuration digest and stopped-writer proof. The narrowly scoped handler receives only safe digests and release IDs. It restores the previous release/source connection, verifies an independent protected checkpoint, and records completion. All outcomes keep source writes disabled and mark v3-only reconciliation pending.
5. Preserve TARGET for investigation. When TARGET later becomes reachable, take a consistent write-free inventory, build the restricted v3-only register and reconcile payments, refunds and external references with owner/finance approval. Never copy v3 payments or other liabilities into v2 automatically. Reopening v2 writes needs a separate approved action and evidence.

Any failed or interrupted reservation is ambiguous. A reserved, failed or completed emergency action cannot be replayed; it also closes forward release actions. A control-journal outage, source drift, stale outage proof, missing writer-stop proof, bad signature or partial connection switch prevents automated emergency rollback. The emergency controller never silently skips the SOURCE or CONTROL observation. A target outage is the sole identity-observation exception.

## Source evidence and historical handoff

The first live request must be a **separate read-only authorization** for an exact SOURCE identity, named short-lived principal, maintenance window, protected artifact locations and two current signers. Scope: complete collection inventory and archive verification only. No actual read is authorized by this document. The operator must independently verify all seven identity fields and exact read-only privileges before any connection. Capture a consistent snapshot or a verified write-free state, every collection and index, historical dates, original and additional students, v2 snapshots, corrections, rates, overrides, plate shares, audit facts, daily/monthly integer-paise costs and original financial collection inventory. Preserve every collection in the encrypted full archive; import only approved historical meal, snapshot, rate, correction, student and audit domains. Old accounts and operational ledgers remain excluded.

Stage A binds the base archive and seven sequential action checkpoints. After freeze and the final complete archive, independently verify the sidecar, all collection/index drift, bounded meal delta and exact historical costs. Stage B is a fresh dual-signed amendment bound to the same release ID. Compare frozen SOURCE = verified archive = TARGET for every date, student, plate/share allocation, effective price, revision, actor, correction chain and integer-paise cost. Repeat per month and for the whole history. A single-paisa difference blocks the next action. Legitimate non-meal v2 changes require an exact base/final archive-bound signed review and stay in v2/recovery; they never become fresh v3 liabilities. An oversized delta or failed transaction requires a new base archive and empty target, not an ad hoc retry.

## Owner financial start decision record

The release owner must fill and sign a protected record before `configure-financial-boundary`. The review validator requires all of these explicit decisions and never selects a date:

| Decision | Required value |
| --- | --- |
| Approved date and timezone | `YYYY-MM-DD`, `Asia/Kolkata` |
| Imported meal on boundary date | Explicit yes/no |
| Boundary-day classification | `historical` or `operational`; an imported boundary meal remains historical |
| Partial-month billing policy | `daily-operational-only` or `defer-monthly-charges` |
| First Mess and Room Fee periods | Explicit `YYYY-MM`, neither before the boundary month |
| Initial active students | Exact stable student IDs |
| Meal eligibility | Explicit start date for every initially active student |
| Fresh rooms, fee plans, deposits and accounts | Explicit lists, including empty lists when not requested |

The corresponding operation remains blocked if any required decision is missing. This review record does not itself write settings or open billing. Historical costs remain readable regardless of the boundary. No historical payment, deposit, credit, Stay, rent, Room Fee, expense or account is imported into fresh operations.

## Deployment and reconciliation gates

Render evidence must bind an immutable backend revision, TARGET identity, protected configuration, a fresh JWT key, canonical-only auth, secure cookies, exact CORS and WebSocket origins, readiness, stopped old writers, and a verified previous-release rollback handle. Vercel evidence must bind an immutable build, API rewrite and backend origin, plus real login/session, students, dashboard, calendar, historical reports, PDF/CSV, payments, Room Fees, expenses and mobile checks. The current validators accept independently obtained observations but perform no deployment. Browser fixtures and a successful Vercel commit status are not production smoke tests.

After switch, a restricted reconciliation register must preserve v3-only meals and corrections, Mess and Room payments, Room Charges, expenses/reimbursements, deposits, credits/allocations, students and account changes. It records IDs, checksums, actor, time, exact paise, status and external references without password hashes. Duplicate external references are flagged. A target outage may delay this inventory; it does not erase the obligation. SOURCE stays unchanged and writes remain closed until separate approval.

## Remaining gates by category

| Category | Required closure |
| --- | --- |
| Code defect | No known defect accepted for cutover; review any newly failing test or audit before proceeding. |
| Missing production evidence | Genuine SOURCE inventory, complete encrypted base/frozen archives, historical paise/correction proof, recovery restore, TARGET and CONTROL observations, live Render/Vercel smoke and finance evidence. |
| Missing authorization | Separate read-only source request, current owner/operator approvals per action, owner eligibility and financial-boundary decisions, reviewed procedure, explicit cutover approval. |
| Missing operational configuration | Protected secrets/archive keys, actual principal scopes, release journal, writer-stop controls, previous release/config and emergency runbook/communication path. |
| Infrastructure dependency | Independently reviewed authenticated Atlas/Render/Vercel providers, isolated process/credential boundaries and the ability to stop all writers while TARGET is unavailable. |
| Documented nonblocking maintenance | Existing lint warnings may be addressed separately if lint exits with zero errors; record their exact count in the final verification report. |

The final release decision remains **`NOT READY — BLOCKERS REMAIN`** until genuine-source verification, recovery evidence, reviewed live providers and procedure, owner decisions and explicit authorization all pass. Even `READY FOR OWNER CUTOVER REVIEW` would request a new owner decision, not authorize execution.

## Isolated verification record — 2026-11-06

- Starting SHA: `142fd761dde9465b0bb0cfcaf6a4a39ff57a4b99` on `feat/mealkhata-v3-dynamic-students`. The containing Task 18B commit is the final local SHA; it is reported in the operator handoff. No push, merge, live deployment or Atlas connection was made.
- The starting SHA has a successful Vercel commit status. The connector's PR-triggered GitHub Actions lookup returned no runs; it does not establish every Actions workflow's status, so a successful GitHub Actions run is **not** claimed. The new local commit has no remote CI run.
- Backend: **723 passed, 0 failed, 0 skipped**. This includes isolated replica-set archive/restore, source evidence, historical authority, staged approval/journal, emergency rollback, migration and financial snapshot/concurrency tests. The emergency module's focused test file passed **10/10**; production provider contracts **2/2**; owner financial decision **1/1**; rollback register **3/3**.
- Frontend: **234 passed, 0 failed, 0 skipped**. Isolated Chromium E2E: **3 passed, 0 failed, 0 skipped**, including fourth-student finance, dynamic student lifecycle and desktop/mobile pages.
- Lint: exit 0, **0 errors, 203 existing warnings**. Frontend production build and backend production verification: pass. Application security check: pass. Production dependency audit: **0 vulnerabilities**. All-dependency audit: **4 moderate development-toolchain advisories** through `minimatch`/ESLint; the suggested forced ESLint downgrade was not applied. Performance: 50 requests each to seven endpoints, 0 errors, all p95 below 250 ms (highest observed p95 55.8 ms).
- `git diff --check` on the staged changes: pass. The final operator handoff records the committed SHA and clean working-tree status.

Synthetic historical fixtures include the original 2026-09-30 legacy meal and a 2026-08 monthly baseline of **5,000 paise**. Tests authenticate snapshots and corrections, compare daily/monthly/household paise and reject a one-paisa mismatch. These values are fixture evidence only; genuine historical date coverage, costs and correction chains remain unknown until a separately authorized source inventory.

Changed files: `emergencyRollbackController.js`, `financialStartDecision.js`, `productionProviderContracts.js`, `releaseStepRegistry.js`, `v3ProductionGate.service.js`, `v3StagedRelease.service.js`, four backend test files (`v3EmergencyRollback`, `v3FinancialDecision`, `v3ProductionProviderContracts`, `v3RollbackRegister`) and four release documents (this file, cutover and rollback, production architecture, Task 18A integration). No frontend application file, historical `meal_days` record, production database or deployment configuration was changed.
