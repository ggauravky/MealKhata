# MealKhata Production-Readiness Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining transactional and financial-consistency blockers, prove the actual Atlas state read-only, and verify the real application stack against an isolated persisted database.

**Architecture:** Keep the existing domain services and add one fail-closed transaction boundary for Mongo-backed Stay mutations. Serialize checkout against financial mutations through a shared member/stay financial guard that participates in the same MongoDB sessions, while retaining explicit ambiguity warnings for legacy history. Extend read-only integrity checks instead of mutating genuine data.

**Tech Stack:** Node.js, Express, Mongoose/MongoDB transactions, React/Vite, Node test runner, Playwright CLI.

**Spec:** `C:/Users/gkuma/.codex/attachments/3976b8df-0190-4e48-936a-b472cce70d7f/Pasted text.txt`

## Global Constraints

- Work only on `update-v2---phases`; do not merge, deploy, or mutate `main`.
- Genuine Atlas access is read-only; never reset, repair, or generate test records there.
- Preserve canonical IDs `gaurav`, `nikhil`, and `devansh` and all financial/audit history.
- Mongo-backed lifecycle and multi-document financial mutations must fail closed when transactions are unavailable.
- All production changes follow RED → GREEN tests and retain current API compatibility.

## Review Focus

- A Mongo connection whose `startSession()` rejects must return 503 before the first write.
- A valid concurrent financial mutation must conflict with or precede checkout; it must never leave an incorrect No-Dues clearance.
- Checked-out historical records must remain correctable only through an audited/reissue-safe path.
- Same-month multiple Stays must not duplicate financial amounts and must block automatic No-Dues when attribution is ambiguous.
- Integrity checks must detect interval overlaps and broken references without creating indexes or changing documents.

---

### Task 1: Atlas connectivity and genuine read-only audit

**Files:**
- Modify: `.superpowers/sdd/2026-10-22-production-readiness-repair/progress.md`

**Interfaces:**
- Consumes: `env.mongoUri`, `connectDatabase()`, `verifyIndexes()`, `verifyDataIntegrity()`.
- Produces: redacted connectivity classification, genuine record summary, and anomaly counts used by Tasks 4 and 6.

- [ ] Verify branch/SHA and redacted environment selection.
- [ ] Compare system and public DNS SRV resolution, then run an authenticated read-only ping.
- [ ] Query only projected non-secret member/accommodation fields and aggregate financial-reference counts.
- [ ] Run read-only integrity functions in summary mode and record gaps between observed data and current checks.

### Task 2: Fail-closed Stay transaction startup

**Files:**
- Modify: `backend/src/stays/stay.service.js`
- Modify: `backend/test/stays.test.js`
- Modify: `backend/test/mongoReplSetIntegrations.test.js`

**Interfaces:**
- Produces: `startLifecycleTransaction()` behavior internal to `createStayService`; Mongo-backed calls return 503 before writes if transaction startup fails, while in-memory repositories remain supported.

- [ ] Add a failing service test proving injected transaction startup failure performs zero writes.
- [ ] Run the focused test and confirm the expected partial-write risk is exposed.
- [ ] Implement the shared fail-closed transaction starter and use it in create, cancel, correction, transfer, checkout, and clearance reissue.
- [ ] Run Stay unit and replica-set failure-injection tests to GREEN.

### Task 3: Checkout/financial mutation serialization

**Files:**
- Create: `backend/src/finance/financialMutationGuard.js`
- Modify: `backend/src/stays/stay.model.js`
- Modify: `backend/src/stays/stay.service.js`
- Modify: `backend/src/roomFees/room.repository.js`
- Modify: `backend/src/expenses/expense.repository.js`
- Modify: `backend/src/stays/stay.repository.js`
- Modify: `backend/src/payments/payment.repository.js`
- Modify: `backend/test/mongoReplSetIntegrations.test.js`

**Interfaces:**
- Produces: session-required guard operations that touch the relevant Stay/member revision and reject unsafe post-clearance mutations.
- Consumes: exact member/date or member/month from financial records; checkout consumes the same guard within its transaction.

- [ ] Replace the sequential checkout test with a deterministic truly concurrent financial-adjustment race and watch it fail for false No-Dues or missing conflict enforcement.
- [ ] Add RED races for room-payment void, expense correction/reimbursement, deposit refund, and reimbursement void where the fixture supports the operation.
- [ ] Implement the minimal shared guard and pass sessions through each covered mutation.
- [ ] Ensure checkout obtains the guard before the authoritative review and retries/rejects on write conflict.
- [ ] Run all concurrency tests to GREEN, including rollback and sequence tests.

### Task 4: Historical attribution and read-only integrity coverage

**Files:**
- Modify: `backend/src/stays/stayAttribution.service.js`
- Modify: `backend/scripts/verifyData.js`
- Modify: `backend/test/securityReliability.test.js`
- Modify: `backend/test/mongoReplSetIntegrations.test.js`

**Interfaces:**
- Produces: non-duplicating same-month Stay statements or explicit blocking warnings; integrity output for overlaps, occupancy, references, and deposit lifecycle.

- [ ] Add failing fixtures for overlapping Fee Plans, conflicting assignments, orphan deposits/references, and checked-out/open-deposit state.
- [ ] Add a same-month two-Stay test covering Room/Mess ambiguity as well as exact-date Expenses.
- [ ] Extend read-only verification and attribution warnings without repairing data.
- [ ] Run focused integrity and attribution tests to GREEN.

### Task 5: Real isolated stack and browser verification

**Files:**
- Modify only test/support files if a reproducible launcher is missing.

**Interfaces:**
- Consumes: built frontend, real Express routes, isolated MongoDB replica set and controlled credentials.
- Produces: route/action/refresh/console evidence with no mocked HTTP responses.

- [ ] Start an isolated MongoDB-backed backend and Vite frontend with controlled fixtures.
- [ ] Verify Members, Admin Stays, all Room Fee member switches, My Stay states, Expenses, and Admin Expenses through real HTTP.
- [ ] Exercise authorized correction/soft-void and account security only against isolated credentials; verify persistence after refresh.
- [ ] Record console/network failures and stop all local processes.

### Task 6: Release gates and CI evidence

**Files:**
- Modify: `.superpowers/sdd/2026-10-22-production-readiness-repair/progress.md`

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: exact command/count/status report and merge decision.

- [ ] Run `npm ci`, lint, full tests, build, production verifier, security check, and `git diff --check`.
- [ ] Run `verify-indexes` and `verify-data` against an isolated database; run only summarized read-only checks against Atlas.
- [ ] Inspect `.github/workflows/ci.yml` and report actual GitHub status without opening a PR.
- [ ] Review the complete diff, commit validated changes, and leave the working branch clean.

