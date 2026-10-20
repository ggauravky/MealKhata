# MealKhata Member Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair member Room Fees and My Stay, expose the canonical three-member roster, complete safe Stay cancellation/historical admission, and add secure Super Admin member-account management without changing stable member IDs or genuine financial history.

**Architecture:** Keep configured member identities, canonical `user_accounts`, Hostel Stays, Room Assignments, and financial records as separate domains joined by stable `memberId`. Add explicit DTO mappers and one date-aware assignment resolver; implement lifecycle and credential mutations in transaction-aware services with immutable audit records and session-version revocation.

**Tech Stack:** React 19, React Router 7, Node.js 24, Express 5, MongoDB/Mongoose 9, node:test, Supertest.

**Spec:** `C:/Users/gkuma/.codex/attachments/4d72b683-469e-4ad2-a583-232f2e989611/Pasted text.txt`

## Global Constraints

- Work only on `update-v2---phases`; do not merge or deploy.
- Preserve stable IDs `gaurav`, `nikhil`, and `devansh` and all genuine records.
- Never fabricate admissions, charges, balances, credentials, or production data.
- Use Asia/Kolkata logical dates and explicit transactions for coupled financial/lifecycle mutations.
- `user_accounts` is the canonical editable authentication source; legacy access must not bypass canonical password, email, active-state, or session controls.
- Sensitive routes require Super Admin, trusted-origin protection, rate limiting, reauthentication, validation, audit, and session revocation.

## Review Focus

- Multiple assignments in one month resolve deterministically for billing while current occupancy uses exact dates.
- A canonical account blocks legacy-password and legacy-token fallback after email/password/status changes.
- Stay cancellation touches only admission-created assignment/plan/deposit artifacts and is blocked by any real financial activity.
- API failures remain errors rather than becoming empty UI states or fake zero totals.
- Backdated admission preserves the supplied date, requires a Super Admin reason, validates historical occupancy, and creates no charges/meals.

---

### Task 1: Frontend Stay and Lifetime Contracts

**Files:**
- Create: `frontend/src/lib/stayContracts.js`
- Modify: `frontend/src/hooks/useStays.js`
- Modify: `frontend/src/pages/MyStayPage.jsx`
- Modify: `frontend/src/components/stays/LifetimeFinancialOverview.jsx`
- Modify: `frontend/src/App.jsx`
- Test: `frontend/test/memberLifecycleRegression.test.js`

**Interfaces:**
- Produces: `parseMyStayResponse(payload)` and `mapLifetimeSummary(report)` with explicit null/error-safe shapes.
- Consumes: backend `{ success, configured, isActive, data: Stay|null }` and lifetime `{ lifetimeTotals, depositOverview, monthlySummaries }`.

- [ ] Write and run failing tests for active/empty/historical Stay parsing and lifetime field mapping.
- [ ] Implement the DTO helpers and update hooks/page/components to use them.
- [ ] Add section-level Retry states plus a route-level error boundary.
- [ ] Run the focused frontend tests and build.

### Task 2: Authoritative Room Assignment Resolution

**Files:**
- Modify: `backend/src/roomFees/room.repository.js`
- Modify: `backend/test/helpers/inMemoryRoomFeeRepository.js`
- Modify: `backend/src/roomFees/roomFee.service.js`
- Test: `backend/test/memberLifecycleRegression.test.js`
- Test: `backend/test/mongoReplSetIntegrations.test.js`

**Interfaces:**
- Produces: deterministic `findActiveAssignment(memberId, month)` for any occupancy within a billing month and `findAssignmentOnDate(memberId, date)` for current occupancy.
- Consumes: exact assignment dates with legacy month-only fallback.

- [ ] Write failing tests for mid-month assignment, transfer, legacy rows, deterministic ordering, and wrong-member isolation.
- [ ] Implement date-aware repository queries and matching in-memory behavior.
- [ ] Wire billing to month resolution and Stay/member summaries to exact-date resolution.
- [ ] Run focused room-fee and Mongo transaction tests.

### Task 3: Canonical Member Roster and Historical Admission

**Files:**
- Create: `backend/src/members/member.service.js`
- Create: `backend/src/routes/member.routes.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/routes/stay.routes.js`
- Modify: `backend/src/stays/stay.service.js`
- Modify: `frontend/src/hooks/useStays.js`
- Modify: `frontend/src/pages/AdminStaysPage.jsx`
- Modify: `frontend/src/components/stays/JoinStayDialog.jsx`
- Test: `backend/test/memberLifecycleRegression.test.js`
- Test: `frontend/test/memberLifecycleRegression.test.js`

**Interfaces:**
- Produces: `GET /api/admin/members` roster rows combining configured identity, account, current Stay, and current room; `POST /api/stays` accepts audited `historicalReason` for Super Admin backdating.
- Consumes: canonical `MEMBERS`, account repository, Stay repository, and exact-date assignment resolver.

- [ ] Write failing roster and historical-admission tests.
- [ ] Implement roster serialization without fake Stay records or password hashes.
- [ ] Enforce role/date/reason policy and include the historical reason in Stay audit history.
- [ ] Redesign Residents tab around the three-member roster with actionable errors.
- [ ] Run focused backend/frontend tests.

### Task 4: Safe Stay Cancellation and Correction

**Files:**
- Modify: `backend/src/stays/stay.constants.js`
- Modify: `backend/src/stays/stay.model.js`
- Modify: `backend/src/stays/stay.repository.js`
- Modify: `backend/src/stays/stay.service.js`
- Modify: `backend/src/routes/stay.routes.js`
- Modify: `backend/src/roomFees/roomFee.service.js`
- Modify: `frontend/src/hooks/useStays.js`
- Create: `frontend/src/components/stays/CancelStayDialog.jsx`
- Modify: `frontend/src/pages/AdminStaysPage.jsx`
- Test: `backend/test/memberLifecycleRegression.test.js`
- Test: `frontend/test/memberLifecycleRegression.test.js`
- Test: `backend/test/mongoReplSetIntegrations.test.js`

**Interfaces:**
- Produces: Super Admin-only `POST /api/stays/:stayId/cancel` with `{ reason, expectedRevision }`; `CANCELLED` stays remain auditable and non-occupying.
- Consumes: activity checks across charges/payments, deposits, clearances, and attributable mess/expense obligations.

- [ ] Write failing safe/unsafe/concurrency/rollback tests.
- [ ] Implement transactionally guarded cancellation, artifact ownership checks, and blocker details.
- [ ] Add confirmation UI and refresh behavior.
- [ ] Add a financially-safe correction endpoint for joining date/room with revision and audit.
- [ ] Run focused and real replica-set tests.

### Task 5: Canonical Member Account Administration

**Files:**
- Create: `backend/src/members/memberAccountAudit.model.js`
- Create: `backend/src/members/memberAccount.repository.js`
- Create: `backend/src/members/memberAccount.service.js`
- Modify: `backend/src/routes/member.routes.js`
- Modify: `backend/src/auth/userAccount.repository.js`
- Modify: `backend/src/auth/memberAccount.repository.js`
- Modify: `backend/src/auth/auth.service.js`
- Modify: `backend/src/auth/token.service.js`
- Modify: `backend/src/backup/backupEngine.js`
- Test: `backend/test/memberAccountManagement.test.js`
- Test: `backend/test/mongoReplSetIntegrations.test.js`

**Interfaces:**
- Produces: member detail, provision, email update, password reset, activate/deactivate APIs; all return safe serializers only.
- Produces: deterministic policy where a canonical member row disables legacy credential/token fallback for that member.

- [ ] Write failing authorization, uniqueness, reauthentication, audit, session-revocation, legacy-bypass, and no-secret-response tests.
- [ ] Implement repository/service/API with bcrypt cost 12 and immutable audit events.
- [ ] Add idempotent read-only legacy conflict audit and document migration behavior.
- [ ] Run focused auth/security/Mongo tests.

### Task 6: Member Management UI and Navigation

**Files:**
- Create: `frontend/src/hooks/useMembers.js`
- Create: `frontend/src/pages/AdminMembersPage.jsx`
- Create: `frontend/src/components/members/MemberAccountDialog.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/layout/AccountMenu.jsx`
- Modify: `frontend/src/components/layout/MobileNav.jsx`
- Test: `frontend/test/memberLifecycleRegression.test.js`

**Interfaces:**
- Consumes: Task 5 member APIs and Task 3 roster serializer.
- Produces: `/admin/members` with all three stable identities, explicit account/stay distinctions, loading/empty/error/retry, and Super Admin credential actions.

- [ ] Write failing route/roster/action/error tests.
- [ ] Implement hook, page, dialogs, and navigation using existing UI primitives.
- [ ] Ensure password values are write-only in UI state and never rendered after submission.
- [ ] Run focused frontend tests and build.

### Task 7: Financial Integrity Regression Gaps

**Files:**
- Modify: `backend/test/mongoReplSetIntegrations.test.js`
- Modify only proven production defects in `backend/src/expenses`, `backend/src/roomFees`, or `backend/src/stays`.

**Interfaces:**
- Consumes: existing transaction APIs.
- Produces: genuine concurrent tests and correct `recordReimbursement()` usage.

- [ ] Correct the reimbursement-race invocation and verify it fails for the intended invariant before any production change.
- [ ] Replace sequential pseudo-concurrency with `Promise.allSettled` races asserting one accepted state and preserved totals.
- [ ] Fix only defects reproduced by these tests.
- [ ] Run replica-set integration tests.

### Task 8: Integrated Verification and Browser Reproduction

**Files:**
- Modify: documentation only if verification exposes a required operational note.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: release evidence and an explicit merge-readiness verdict.

- [ ] Run focused suites, then `npm run lint`, `npm test`, `npm run build`, `npm run verify-production-build`, and `npm run security:check`.
- [ ] Run safe `verify-indexes` and `verify-data` only against an isolated configured database.
- [ ] Reproduce `/room-fees`, `/my-stay`, `/admin/stays`, and `/admin/members` in a local browser; capture console/network results without mutating production.
- [ ] Inspect the final diff and perform a security-focused whole-branch review.
