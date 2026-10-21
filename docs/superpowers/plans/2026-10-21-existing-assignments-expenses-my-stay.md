# Existing Assignments, Expenses, and My Stay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing room assignments authoritative across Room Fees, Hostel Stays, Expenses, and My Stay without rewriting genuine records or duplicating financial artifacts.

**Architecture:** Normalize backend DTOs at the frontend boundary, extend the canonical member/stay summaries with current assignment context, and add an explicit transactional Stay admission mode that links validated existing assignments and fee plans with ownership metadata. Reuse the existing expense dialogs and backend void/correction endpoints, preserving exact integer-paise values.

**Tech Stack:** Node.js 24, Express 5, Mongoose 9, React 19, Vite 8, Tailwind, Radix Dialog, Node test runner, Supertest, mongodb-memory-server.

**Spec:** `C:/Users/gkuma/.codex/attachments/261e9112-234b-411c-b802-30fca254fe0d/Pasted text.txt`

## Global Constraints

- Do not delete, reset, recreate, backdate, or mass-update genuine member, room, assignment, fee-plan, charge, payment, expense, or Stay records.
- Keep Room Assignment, Hostel Stay, Fee Plan, Monthly Charge, and Payment as separate concepts.
- Preserve role authorization, audit history, capacity/overlap validation, reimbursement guards, and MongoDB transaction requirements.
- Do not merge or deploy.

## Review Focus

- A member switch during the same month must clear the previous member's Room Fee payload until the keyed response arrives.
- A historical Stay date before an existing assignment must require explicit Super Admin acknowledgement and must not backdate the assignment or generate fees.
- Cancelling a Stay linked to pre-existing artifacts must not void those artifacts.
- Expense corrections must preserve fractional rupees and must not expose privileged actions to non-Super Admin roles.
- My Stay must distinguish API errors, assignment-only accommodation, no accommodation, active Stay, and completed Stay.

---

### Task 1: Room Fee response contract and request identity

**Files:**
- Create: `frontend/src/lib/roomFeeContracts.js`
- Modify: `frontend/src/hooks/useRoomFees.js`
- Modify: `frontend/src/pages/RoomFeesPage.jsx`
- Test: `frontend/test/roomFeesFrontend.test.js`

**Interfaces:**
- Produces: `mapMemberRoomFeeOverview(payload)` returning `room`, `assignment`, `feePlan`, `statement`, `metrics`, and `settings` with no fabricated charge.
- Produces: `roomFeeRequestKey(memberId, month)` for stale-response isolation.

- [ ] Write adapter and key tests that fail against the current code.
- [ ] Run the focused frontend test and confirm the expected contract/key failures.
- [ ] Implement the mapper and key `useMyRoomFees` by member plus month.
- [ ] Render configured-but-unissued plans as “Fee not issued” while keeping missing assignment, missing plan, and API errors distinct.
- [ ] Run the focused frontend test to green.

### Task 2: Canonical assigned-resident roster

**Files:**
- Modify: `backend/src/members/member.service.js`
- Modify: `frontend/src/lib/memberContracts.js`
- Modify: `frontend/src/pages/AdminStaysPage.jsx`
- Test: `backend/test/memberAccountManagement.test.js`
- Test: `frontend/test/memberLifecycleRegression.test.js`

**Interfaces:**
- Extends each member row with current assignment dates and current fee-plan status.
- Produces derived counts for configured members, current assignments, assigned rooms, active registered Stays, and registration-needed members.

- [ ] Add failing service and UI contract tests for three assigned members with zero registered Stays.
- [ ] Run focused tests and confirm occupancy/roster failures.
- [ ] Extend the canonical member summary using read-only repository lookups.
- [ ] Update Admin Stays metrics and resident table labels without hardcoded member counts.
- [ ] Run focused tests to green.

### Task 3: Transactional linking of existing room assignments

**Files:**
- Modify: `backend/src/stays/stay.model.js`
- Modify: `backend/src/stays/stay.service.js`
- Modify: `backend/src/routes/stay.routes.js`
- Modify: `frontend/src/lib/api.js`
- Modify: `frontend/src/components/stays/JoinStayDialog.jsx`
- Modify: `frontend/src/pages/AdminStaysPage.jsx`
- Test: `backend/test/stays.test.js`
- Test: `backend/test/mongoReplSetIntegrations.test.js`
- Test: `frontend/test/staysFrontend.test.js`

**Interfaces:**
- Consumes: `admissionMode`, optional `assignmentId`, and `allowUnverifiedPreAssignmentPeriod` in `POST /api/stays`.
- Produces: Stay provenance fields identifying whether admission assignment/fee plan were created or reused.

- [ ] Add failing tests for compatible reuse, historical pre-assignment acknowledgement, idempotency, fee-plan reuse, rollback, and cancellation preservation.
- [ ] Run focused backend tests and verify each failure is behavior-specific.
- [ ] Validate selected assignment ownership, room, dates, and historical gap without mutating it.
- [ ] Reuse compatible fee plans; create only missing artifacts inside the existing transaction.
- [ ] Make cancellation affect only Stay-owned artifacts and reject unsafe correction of reused artifacts.
- [ ] Surface structured conflict details through `ApiError` and the admission dialog.
- [ ] Fetch member assignment/Stay/plan status in the dialog and default to safe linking.
- [ ] Run focused backend/frontend tests to green.

### Task 4: Shared Expense edit and soft-delete flows

**Files:**
- Modify: `frontend/src/pages/ExpensesPage.jsx`
- Modify: `frontend/src/pages/AdminExpensesPage.jsx`
- Modify: `frontend/src/components/expenses/EditExpenseDialog.jsx`
- Modify: `frontend/src/lib/money.js`
- Test: `frontend/test/expensesFrontend.test.js`
- Test: `backend/test/expenses.test.js`

**Interfaces:**
- Reuses `EditExpenseDialog` and `POST /api/expenses/:expenseId/void` with stable expense IDs and mandatory reasons.
- Produces exact decimal display strings from integer paise.

- [ ] Add failing tests for details-to-edit, card edit/delete, exact `14950 -> "149.50"`, stable refresh, and role gating.
- [ ] Run focused tests and confirm failures.
- [ ] Wire controlled sibling dialogs on `/expenses` and pass the target expense on both pages.
- [ ] Preserve paise in amount and custom-allocation initialization.
- [ ] Refresh list, summary, and authoritative selected record after correction/void.
- [ ] Run focused frontend and backend expense tests to green.

### Task 5: Minimal assignment-aware My Stay

**Files:**
- Modify: `backend/src/stays/stay.service.js`
- Modify: `backend/src/routes/stay.routes.js`
- Modify: `frontend/src/lib/stayContracts.js`
- Modify: `frontend/src/hooks/useStays.js`
- Modify: `frontend/src/pages/MyStayPage.jsx`
- Modify: `frontend/src/components/stays/StayEmptyState.jsx`
- Test: `backend/test/stays.test.js`
- Test: `frontend/test/staysFrontend.test.js`

**Interfaces:**
- Extends `/api/stays/me` with `currentAssignment` and `currentRoom` while retaining the existing Stay envelope.
- Requires explicit `memberId` for Admin/Super Admin preview; never silently defaults to a member.

- [ ] Add failing tests for assignment-only, no accommodation, active, completed, pending checkout, admin selection, history, and API failure states.
- [ ] Run focused tests and confirm state-contract failures.
- [ ] Add assignment context to the existing endpoint and mapper.
- [ ] Render one compact primary card; keep advanced components behind relevant optional sections.
- [ ] Show only valid actions and explicit admin navigation/selection.
- [ ] Run focused tests to green.

### Task 6: Integration and release verification

**Files:**
- Modify as required by failures in the files above only.

- [ ] Run backend and frontend focused suites.
- [ ] Run isolated MongoDB replica-set integration tests.
- [ ] Inspect configured local database read-only when a URI is available; do not run mutation workflows against it.
- [ ] Run real HTTP contract checks and browser workflows against isolated data when services are available.
- [ ] Run `npm run lint`, `npm test`, `npm run build`, `npm run verify-production-build`, `npm run security:check`, and `git diff --check`.
- [ ] Inspect the final diff and report exact evidence, unverified items, branch/SHA/status, and merge readiness.
