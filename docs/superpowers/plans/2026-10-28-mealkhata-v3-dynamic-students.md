# MealKhata 3.0 Dynamic Students Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully dynamic student-based MealKhata 3.0 and a verified blue-green migration path without mutating the production source database.

**Architecture:** Use an expand-contract rollout. A database-backed student registry and date-aware resolver replace fixed identity lists behind compatibility APIs; dynamic meal maps and frozen legacy snapshots preserve history; downstream finance uses an explicit start boundary before fixed-roster adapters are removed.

**Tech Stack:** Node.js 24, Express 5, Mongoose 9/MongoDB replica sets, React 19, Vite 8, Node test runner, Supertest.

**Spec:** `docs/superpowers/specs/2026-10-28-mealkhata-v3-dynamic-students-design.md`

## Global Constraints

- Preserve immutable IDs `gaurav`, `nikhil`, and `devansh`.
- Use `2026-10-01` only for Gaurav's confirmed date; never invent Nikhil or Devansh dates.
- Keep money as integer paise and old six-unit share semantics unchanged.
- Never derive historical membership or rounding from the current active roster.
- Never import old operational finance into the new operational database.
- Require an explicit `financialStartDate`; an unset value blocks financial issuance.
- Require `--dry-run`, `--verify`, and `--target-db` for migration commands.
- Do not run migrations at application startup or write to production during implementation.
- Only Super Admin can create/archive/reactivate students; all privileged changes are audited.
- Node must satisfy `>=24.19.0 <25` before release.

## Review Focus

- A historical meal contains an archived or no-longer-eligible student: history and frozen cost remain visible and unchanged.
- A malicious/imported student ID contains `.`, `$`, a null byte, or an object-injection shape: every write path rejects it.
- `financialStartDate` is missing or a pre-boundary month is requested: no new liability or payment is issued.
- Migration is pointed at the source database or a target with unexpected records: it refuses to write and reports the mismatch.
- Two Super Admins concurrently create/archive/reactivate the same identity: unique indexes and revision checks produce one consistent audit trail.

---

### Task 0: Phase 0 archive and baseline safety tooling

**Files:**
- Modify: `backend/src/backup/backupEngine.js`
- Modify: `backend/scripts/backupDatabase.js`
- Modify: `backend/scripts/verifyBackup.js`
- Modify: `backend/scripts/restoreDatabase.js`
- Create: `backend/src/migrations/sourceInventory.service.js`
- Create: `backend/test/v3ArchiveBaseline.test.js`

**Interfaces:**
- Produces: runtime collection/index discovery, count and checksum manifests, read-only calendar/API/cost baselines, encrypted archive metadata, and disposable-target restore verification consumed by Task 13.

- [ ] Add failing disposable-database tests proving unknown collections are discovered, every collection/index enters the manifest, encrypted archives verify, restore recreates counts and sampled documents, API/cost baselines are stable, and source=restore-target is rejected.
- [ ] Run `rtk node --test --import ./test/setup-env.js test/v3ArchiveBaseline.test.js` from `backend`; expect failure because inventory/restore-baseline behavior is missing.
- [ ] Implement discovery and verification behind explicit commands without connecting to Atlas in tests or application startup.
- [ ] Run the focused test, `rtk npm run db:backup:verify --workspace backend -- --help`, and the backend suite; expect 0 failures and no database mutation.
- [ ] Commit `feat(backup): verify complete v3 source archives`.

### Task 1: Authoritative student persistence

**Files:**
- Create: `backend/src/students/student.constants.js`
- Create: `backend/src/students/studentId.js`
- Create: `backend/src/students/student.model.js`
- Create: `backend/src/students/studentAuditEvent.model.js`
- Create: `backend/src/students/student.repository.js`
- Create: `backend/test/helpers/inMemoryStudentRepository.js`
- Test: `backend/test/students.test.js`

**Interfaces:**
- Produces: `generateStudentId()`, `assertSafeStudentId(value)`, `createStudentRepository()`, and persistence methods `create`, `findById`, `list`, `updateProfile`, `transitionStatus`, `createAuditEvent`.

- [ ] Write tests proving generated IDs are immutable-key-safe, original IDs are accepted, unsafe IDs are rejected, profile email is normalized, duplicate IDs fail, and audit payloads exclude unknown/secret fields.
- [ ] Run `rtk node --test --import ./test/setup-env.js test/students.test.js` in `backend`; expect failure because the student domain does not exist.
- [ ] Implement strict schemas, unique/index constraints, ID helpers, Mongo repository, and a behaviorally equivalent in-memory repository.
- [ ] Run the focused test; expect all Task 1 cases to pass.
- [ ] Run the backend suite; expect 0 failures.
- [ ] Commit `feat(students): add authoritative student persistence`.

### Task 2: Student lifecycle and date-aware resolver

**Files:**
- Create: `backend/src/students/student.service.js`
- Create: `backend/src/students/studentResolver.service.js`
- Modify: `backend/test/students.test.js`

**Interfaces:**
- Consumes: Task 1 repository methods.
- Produces: `createStudentService({ repository, accounts, now, generateId })` and `createStudentResolver({ repository })` with `listCurrent`, `listAll`, `listEligibleOn(date)`, `assertKnown(studentId)`, and `assertEligible(studentId, date)`.

- [ ] Add failing tests for create, edit, archive, reactivate, stable roster ordering, no hard delete, inclusive Asia/Kolkata eligibility boundaries, null-start exclusion for new meals, unknown Nikhil/Devansh dates staying null, Gaurav migration fixture date, archived historical lookup, duplicate contacts, concurrency conflict, audit actor/reason, optional account disable, and session revocation.
- [ ] Run the focused test; expect missing service/resolver failures.
- [ ] Implement allow-listed lifecycle transitions and resolver behavior without creating Stays or accounts implicitly.
- [ ] Run focused and backend suites; expect 0 failures.
- [ ] Commit `feat(students): add audited lifecycle and eligibility resolver`.

### Task 3: Student API and authorization

**Files:**
- Create: `backend/src/routes/student.routes.js`
- Modify: `backend/src/app.js`
- Modify: `backend/test/students.test.js`

**Interfaces:**
- Consumes: Task 2 student service/resolver.
- Produces: `/api/students` list/detail/create/patch/archive/reactivate endpoints with repository-standard response envelopes.

- [ ] Add failing Supertest cases for read roles, Super Admin-only mutations, strict body allow-lists, object injection, duplicate conflicts, archive reason, optional account disable, and sanitized errors.
- [ ] Run focused tests; expect 404 or missing-router failures.
- [ ] Register and implement the router using existing middleware conventions.
- [ ] Run focused, backend, security, and lint checks; expect no new failures or lint errors.
- [ ] Commit `feat(api): expose dynamic student administration`.

### Task 4: Compatibility roster backed by students

**Files:**
- Modify: `backend/src/members/member.service.js`
- Modify: `backend/src/routes/member.routes.js`
- Modify: `backend/test/memberAccountManagement.test.js`
- Modify: `backend/test/memberLifecycleRegression.test.js`

**Interfaces:**
- Consumes: `studentResolver.listCurrent()` and `studentResolver.listAll()`.
- Produces: unchanged `/api/members` DTO shape plus `status`, eligibility, and archived-history-safe lookup.

- [ ] Change roster tests first to inject four students and prove list order/data come from the resolver rather than `MEMBERS`.
- [ ] Run both member test files; expect the fourth-student assertion to fail.
- [ ] Replace fixed roster iteration with injected resolver results while retaining account/Stay/room enrichment.
- [ ] Run member tests and the backend suite; expect 0 failures.
- [ ] Commit `refactor(members): source roster from student registry`.

### Task 5: Dynamic canonical accounts

**Files:**
- Modify: `backend/src/auth/userAccount.model.js`
- Modify: `backend/src/auth/token.service.js`
- Modify: `backend/src/auth/permissions.js`
- Modify: `backend/src/members/memberAccount.service.js`
- Modify: `backend/src/members/memberAccountAudit.model.js`
- Modify: `backend/test/memberAccountManagement.test.js`
- Modify: `backend/test/auth.integration.test.js`

**Interfaces:**
- Consumes: resolver `assertKnown(studentId)`.
- Produces: one optional unique account-to-student relationship without configured-ID enums; tokens validate identity against account/student state.

- [ ] Add failing tests that provision/login a generated fourth student, reject an unknown student, reject duplicate links/emails, deny archived-disabled accounts, revoke sessions, and prevent legacy fallback.
- [ ] Run focused auth tests; expect generated student validation to fail.
- [ ] Remove fixed Mongoose enums, add the unique partial index, and enforce dynamic references in service/auth boundaries.
- [ ] Run auth, member, backend, security, and index verification; expect 0 failures.
- [ ] Commit `refactor(auth): validate accounts against dynamic students`.

### Task 6: Dynamic student frontend and Super Admin CRUD

**Files:**
- Create: `frontend/src/lib/studentContracts.js`
- Create: `frontend/src/hooks/useStudents.js`
- Create: `frontend/src/components/students/StudentDialog.jsx`
- Create: `frontend/src/components/students/StudentLifecycleDialog.jsx`
- Modify: Admin member-management page/components discovered during implementation.
- Modify: `frontend/src/lib/memberContracts.js`
- Test: `frontend/test/studentsFrontend.test.js`
- Modify: `frontend/test/memberLifecycleRegression.test.js`

**Interfaces:**
- Consumes: Task 3 `/api/students` and Task 4 compatibility roster.
- Produces: a reusable dynamic roster query and Super Admin add/edit/archive/reactivate controls.

- [ ] Add failing contract/component tests for zero, one, three, four, and more-than-four students; optional onboarding steps; eligibility dates; archive confirmation; historical visibility; and error envelopes.
- [ ] Run focused frontend tests; expect missing modules/behavior.
- [ ] Implement dynamic normalization, query invalidation, forms, and accessible lifecycle controls without importing `ROOMMATES`.
- [ ] Run focused and full frontend suites plus build; expect 0 failures.
- [ ] Commit `feat(frontend): manage dynamic students`.

### Task 7: Frozen legacy meal snapshots

**Files:**
- Create: `backend/src/meals/mealHistorySnapshot.model.js`
- Create: `backend/src/meals/mealHistorySnapshot.repository.js`
- Create: `backend/src/migrations/legacyMealSnapshot.service.js`
- Create: `backend/scripts/captureLegacyMealSnapshots.js`
- Create: `backend/test/legacyMealSnapshots.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: deterministic source checksum, `calculationVersion: legacy-v2`, normalized status/allocation/price/cost facts, idempotent capture, and exact verification.

- [ ] Add failing fixtures for all legacy plate presets, price overrides, remainder rotation, revisions, unknown actors, checksum mismatch, and idempotent replay.
- [ ] Run focused tests; expect missing snapshot implementation.
- [ ] Implement a read-only legacy runner and strict snapshot persistence without changing the current meal engine.
- [ ] Add CLI parsing that requires `--target-db` and supports `--dry-run` and `--verify`; reject source=target.
- [ ] Run focused, backend, and isolated replica-set tests; expect exact fixture results.
- [ ] Commit `feat(migration): capture verified legacy meal snapshots`.

### Task 8: Dynamic meal document representation

**Files:**
- Modify: `backend/src/meals/meal.model.js`
- Modify: `backend/src/meals/meal.defaults.js`
- Modify: `backend/src/meals/meal.serializer.js`
- Modify: `backend/src/meals/meal.repository.js`
- Create: `backend/src/meals/mealParticipants.js`
- Modify: `backend/test/meals.integration.test.js`

**Interfaces:**
- Consumes: student resolver and Task 7 snapshots.
- Produces: schemaVersion 3 dynamic status/share maps serialized as plain objects; legacy documents remain readable.

- [ ] Add failing tests for zero/one/four/many participants, archived historical keys, Map/object hydration, unsafe keys, untouched audit arrays/timestamps, and legacy document compatibility.
- [ ] Run meal integration tests; expect the fourth-student case to fail.
- [ ] Replace fixed schema fields with validated dynamic maps and explicit serialization while preserving legacy reads.
- [ ] Run focused and backend suites; expect 0 failures and unchanged three-student fixtures.
- [ ] Commit `refactor(meals): store dynamic participant maps`.

### Task 9: Dynamic allocation and meal mutations

**Files:**
- Modify: `backend/src/meals/plateAllocation.constants.js`
- Modify: `backend/src/meals/plateAllocation.service.js`
- Modify: `backend/src/meals/meal.service.js`
- Modify: `backend/src/routes/meal.routes.js`
- Modify: `backend/src/calendar/monthMeal.service.js`
- Modify: relevant meal/allocation tests.

**Interfaces:**
- Consumes: date-aware eligible roster for new records and snapshot participant order for historical records.
- Produces: roster-parameterized deterministic allocation with bounded configurable plates and exact integer-paise conservation.

- [ ] Add failing tests for one through more-than-four students, all required sharing presets, six-unit custom weights, persisted participant order, plate bound, no lost/duplicate plate, deterministic date/meal-type remainder, later roster changes not altering an existing day, archived history, null/pre-eligibility rejection, and concurrent revision conflict.
- [ ] Run focused allocation/meal tests; expect dynamic roster cases to fail.
- [ ] Refactor allocation functions to accept explicit participants/order and update mutation authorization/locking.
- [ ] Run focused, backend, and data-verification suites; expect 0 failures and exact legacy snapshot comparisons.
- [ ] Commit `refactor(meals): calculate against date-aware students`.

### Task 10: Dynamic reports and settlements

**Files:**
- Modify: report, billing, settlement, dashboard, PDF, and export services that import fixed member constants.
- Modify: `backend/src/settlement/monthlySettlement.model.js`
- Modify: corresponding backend and frontend tests.

**Interfaces:**
- Consumes: dynamic serialized meals, student resolver, and frozen snapshots.
- Produces: historical reports from snapshots and current reports/settlements from eligible dynamic students.

- [ ] Add failing four-student, archived-history, empty-roster, snapshot-authority, PDF/export, and no-current-roster-affects-history tests.
- [ ] Run focused report/settlement tests; expect fixed-shape failures.
- [ ] Replace fixed object schemas/loops with validated maps and resolver-driven DTOs.
- [ ] Run report, settlement, backend, frontend, and build suites; expect 0 failures.
- [ ] Commit `refactor(reports): support dynamic historical rosters`.

### Task 11: Financial start boundary and dynamic operational domains

**Files:**
- Create: `backend/src/settings/systemSettings.model.js`
- Create: `backend/src/settings/systemSettings.repository.js`
- Create: `backend/src/finance/financialBoundary.service.js`
- Modify: payment, expense, room-fee, Stay, financial-overview, authorization, and push domains that validate fixed IDs.
- Test: `backend/test/financialBoundary.test.js`
- Modify: affected domain tests.

**Interfaces:**
- Produces: `assertOperationalFinancialDate(date)`, `isHistoricalViewOnly(date)`, and dynamic known-student validation throughout operational finance.

- [ ] Add failing tests for unset boundary, inclusive Asia/Kolkata before/on/after behavior, explicit classification of a migrated boundary-day meal, no old dues, new obligations, four students, archived historical records, authorization isolation, and transactional writes.
- [ ] Run focused tests; expect missing boundary and fixed validation failures.
- [ ] Implement the singleton setting and enforce it at issuance/mutation boundaries while keeping pre-cutover history readable.
- [ ] Run all affected domains, backend, security, and data verification; expect 0 failures.
- [ ] Commit `feat(finance): enforce dynamic students and start boundary`.

### Task 12: Remove frontend fixed rosters

**Files:**
- Modify: `frontend/src/lib/constants.js`
- Modify: all components/hooks/pages importing `ROOMMATES`.
- Modify: corresponding frontend tests.

**Interfaces:**
- Consumes: Task 6 dynamic student query and dynamic backend DTOs.
- Produces: no business UI dependency on static identity arrays.

- [ ] Convert relevant tests first to render zero/one/four/many/archived rosters and verify member privacy/editability.
- [ ] Run frontend tests; expect fixed-three assertions to fail.
- [ ] Pass roster data through page/component boundaries and keep only non-identity display constants static.
- [ ] Run `rtk rg` to prove no production import/reference to `ROOMMATES`, `MEMBERS`, `MEMBER_IDS`, or hardcoded original identity arrays remains outside the explicit migration adapter.
- [ ] Run frontend suite and build; expect 0 failures.
- [ ] Commit `refactor(frontend): remove fixed student identities`.

### Task 13: Blue-green data migration

**Files:**
- Create: `backend/src/migrations/v3Migration.service.js`
- Create: `backend/scripts/migrateV3Database.js`
- Create: `backend/test/v3Migration.test.js`
- Modify: backup collection discovery/manifest modules and scripts.
- Modify: root/backend package scripts.

**Interfaces:**
- Consumes: Task 0 source inventory/verified archive restore, student seed identities, dynamic meal conversion, snapshots, applicable `monthly_meal_rates`, and financial boundary.
- Produces: an isolated target with preserved meal history and fresh financial/account collections plus a machine-readable verification manifest.

- [ ] Add failing disposable-database tests for source/target guard, three preserved IDs/order, genuine date derivation, applicable monthly rates, no imported Stays/assignments/fee plans/rooms/old finance, explicitly supplied fresh cutover-day accommodation, exact meal comparisons, securely provisioned replacement Super Admin without credential logging, fresh indexes, idempotency, partial-target refusal, final write-free delta replay, and rollback manifest.
- [ ] Run migration tests; expect missing orchestrator failures.
- [ ] Implement explicit CLI flags and phase checkpoints; never import or call it from app startup.
- [ ] Execute dry-run then apply/verify only against disposable replica-set databases.
- [ ] Restore an archive fixture and compare manifests/API baselines.
- [ ] Commit `feat(migration): build verified blue-green v3 database`.

### Task 14: End-to-end acceptance and release gates

**Files:**
- Add/modify browser isolated E2E fixtures and tests.
- Modify release, production-build, security, index, and data-verification scripts.
- Update `README.md`, `SECURITY.md`, and `CHANGELOG.md`.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: release evidence and an explicit cutover checklist; no automatic production action.

- [ ] Add a browser test that creates a fourth student, verifies automatic cross-module appearance, sets eligibility, optionally provisions account/Stay/room/rent, records a meal, archives the student, and verifies historical visibility.
- [ ] Add browser/security cases for cross-student privacy, archived login, legacy fallback, session revocation, and Super Admin actor audits.
- [ ] Run backend, frontend, replica-set integration, isolated E2E, build, lint, security, index, data, performance, release, migration comparison, backup restore, and Node-version checks.
- [ ] Fix every Critical/Important finding with RED→GREEN coverage; record deferred minor findings.
- [ ] Document the maintenance-window write block, final idempotent delta, backup, target verification, reconciliation-aware rollback, and explicit approval steps without executing cutover.
- [ ] Commit `chore(release): verify MealKhata 3.0 migration readiness`.

## Execution boundary

Tasks 1-12 are development-only. Task 13 may write only to disposable/explicit isolated targets. Task 14 produces release evidence. Production backup, production target creation, connection switching, deployment, push, PR, merge, and cutover each require separate authorization.
