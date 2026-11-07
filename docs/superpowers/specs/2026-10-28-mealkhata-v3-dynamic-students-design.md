# MealKhata 3.0 Dynamic Students Design

## Intent

MealKhata 3.0 replaces the fixed three-roommate architecture with a database-backed student registry while preserving every genuine historical meal fact and its original financial meaning. Super Admin can manage student identity, account access, meal eligibility, residence, rooms, and post-cutover finance without source-code changes.

The production database is never reset in place. A new operational database is built and verified from a complete archive plus a selective meal-history migration, then cut over only after explicit approval.

## Goals

- Make `students` the authoritative source of student identity and lifecycle state.
- Preserve the immutable IDs `gaurav`, `nikhil`, and `devansh`.
- Allow any future student to be created, edited, archived, reactivated, and readmitted through Super Admin UI and APIs.
- Keep account status, student status, residence, and meal eligibility independent.
- Make meals, allocations, reports, payments, rooms, Stays, and authorization operate on dynamic student IDs.
- Preserve old meal attendance, sharing, overrides, revisions, actors, timestamps, prices, and exact integer-paise costs.
- Start new operational finance only at an explicit `financialStartDate`.
- Provide dry-run, verification, target-database, restore, and rollback tooling before cutover.

## Non-goals

- Importing the old Room Fee, Stay, payment, settlement, expense, reimbursement, deposit, credit, or reclassification ledgers into the new operational database.
- Hard-deleting a student referenced by historical data.
- Inventing Nikhil's or Devansh's joining or eligibility dates.
- Changing old six-unit plate-share meaning or recalculating old costs with the future roster.
- Running a migration automatically when the application starts.
- Performing an Atlas cutover, production reset, deployment, merge, or push without separate authorization.

## Anti-goals

- A compatibility layer that silently keeps three fixed identities as the business source of truth.
- A schema conversion that drops unknown historical student keys or Mongoose Map entries.
- Deriving historical reports from the current active roster.
- Allowing pre-cutover meal costs to become new unpaid balances.
- Coupling student creation to account creation, a Stay, a room, a deposit, or a rent plan.

## Constraints

- React 19/Vite frontend, Express 5, Mongoose 9, MongoDB transactions, Node `>=24.19.0 <25`.
- Existing public IDs and historical audit actors remain stable.
- `gaurav` has confirmed eligibility/residence evidence from `2026-10-01`; unknown dates stay `null` until derived from verified history or entered by Super Admin.
- All money remains integer paise with deterministic allocation.
- All lifecycle and privileged mutations are authorized and audited.
- The archived production database remains the source for genuine old finance.

## Approaches considered

### 1. Big-bang replacement

Replace static arrays, schemas, routes, and UI in one release. This minimizes temporary adapters but creates an unreviewable blast radius across more than 70 files and cannot provide safe historical comparison or rollback. Rejected.

### 2. Expand-contract with a date-aware compatibility boundary — selected

Introduce the student registry and resolver first while keeping old APIs operational through an explicit adapter. Convert meal storage and calculations next, freeze verified legacy results, then migrate finance/reporting and finally remove fixed-roster fallbacks. Each phase is independently testable and deployable to an isolated database. This matches the blue-green and rollback requirements.

### 3. Event-sourced identity rewrite

Rebuild student and residence state entirely from events. This can model history well but duplicates the mature Stay and audit systems and would make the migration substantially riskier. Rejected.

## Domain model

### Student

`students` stores:

- `studentId`: immutable, unique, Mongo-key-safe string.
- `displayName`: required human-facing name.
- `status`: `ACTIVE` or `ARCHIVED`.
- `email` and `phone`: optional profile contacts; login identity remains in `user_accounts`.
- `mealEligibilityFrom` and `mealEligibilityUntil`: nullable logical dates.
- `rosterOrder`: stable numeric ordering data used for current UI and new-meal participant ordering; it is not a hardcoded identity list.
- `archivedAt`, `archivedReason`, `createdAt`, and `updatedAt`.

The three historical IDs are inserted explicitly during migration. Future IDs are generated server-side as `student_<32 lowercase hex characters>` using cryptographic UUID randomness with hyphens removed. IDs containing `.`, `$`, null bytes, or unsafe Unicode controls are rejected on every write and migration boundary.

### Student audit event

`student_audit_events` records the actor, event type, student ID, timestamp, reason, and allow-listed before/after fields. Secrets never enter this collection.

### Lifecycle separation

- Archiving removes a student from the current operational roster but preserves history.
- Reactivation restores roster eligibility without creating a Stay.
- Ending residence closes the active Stay and Room Assignment but leaves the student active.
- Readmission creates a new Stay for the same immutable student.
- Account enablement remains a `user_accounts` concern and revokes sessions when disabled.

## Student resolution

A `studentResolver` exposes current and date-aware queries:

- active operational roster for current UI choices;
- all known students for historical labels and audits;
- students eligible for a requested meal date;
- validation that a referenced ID exists, including archived historical identities.

Historical calculations use IDs present in the historical document and the frozen snapshot, never the current roster. New records use the eligible roster for their date.

Eligibility rules are explicit:

- a `null` `mealEligibilityFrom` means the student is not eligible for newly entered meals until Super Admin or verified migration evidence supplies a start date;
- a `null` `mealEligibilityUntil` means no configured end once a start exists;
- both bounds are inclusive logical dates in `Asia/Kolkata`;
- `ARCHIVED` students are excluded from current/new participant choices;
- historical reads and frozen calculations use the participants stored on that day even when the student is now archived or the present eligibility range differs.

## API and UI

The canonical API is `/api/students` with list, detail, create, patch, archive, and reactivate operations. Reads expose only allow-listed student/profile fields. Super Admin alone creates, archives, or reactivates; Admin may receive only the existing read permissions required by operational pages.

The existing `/api/members` route remains temporarily as an adapter that enriches students with account, Stay, room assignment, and fee-plan summaries. The frontend receives students from one query/cache boundary and passes the roster into components rather than importing `ROOMMATES`.

The Add Student workflow makes account, Stay, room, deposit, and rent steps independently optional.

## Dynamic meals

`meal_days` advances to `schemaVersion: 3`. Per-meal statuses and plate shares use validated dynamic maps. Serialization always converts maps to ordinary JSON objects and preserves every stored key.

For migrated records:

- old status and six-unit share values are copied exactly;
- revisions, audit arrays, actors, overrides, and timestamps are preserved;
- legacy-v2 allocation ordering remains tied to the historical participant order captured in the snapshot;
- no new student changes an old rounding result.

For new records, allocation accepts a bounded configurable maximum plate count, validates every participant against date eligibility, allocates each plate exactly once, and guarantees member paise sum equals the meal total.

New records continue to use integer six-unit shares until a separately versioned allocation model is approved. Each meal persists its participant order when it is first created. The initial students receive migration-data `rosterOrder` values matching their legacy order; later students receive a transactionally assigned order. Remainder paise rotate deterministically from the persisted order using logical date and meal type, so later roster changes cannot recalculate an existing day differently.

## Historical snapshots

Before changing calculation semantics, a read-only legacy runner creates `meal_history_snapshots` containing the source checksum, legacy algorithm version, effective prices, statuses, plate/share facts, and normalized per-student and room amounts. Capture is idempotent and verification compares every historical day. Historical reports read verified snapshots unless an authorized correction creates a new audited revision and snapshot.

## Financial boundary

A singleton system setting contains `financialStartDate`. It is an inclusive `Asia/Kolkata` logical date: dates before it are historical/view-only, while dates on or after it are operational. Pre-boundary meal history and costs are excluded from operational dues, settlements, payment preparation, and outstanding-balance totals. A migrated meal on the boundary date is operational only if the cutover manifest explicitly classifies it in the final write-free delta. An unset boundary blocks new financial issuance rather than guessing.

## Authentication

`user_accounts` becomes the only post-cutover credential registry. `memberId` becomes a dynamic student reference enforced by services and a unique partial index, not a Mongoose enum. Legacy authentication fallback is disabled only after replacement Super Admin login and recovery are verified. Archive can optionally disable the linked account and always supports explicit session revocation.

Account bootstrap is manifest-driven. A replacement Super Admin is required; additional Admin/Member accounts and student links are explicit operator inputs. Passwords/hashes arrive through secret inputs, never source files, CLI arguments, manifests, or logs. No current account is silently carried forward.

## Migration and rollout

1. Inventory every source collection and index, create an encrypted archive, restore it to a disposable database, and verify counts/checksums/queries.
2. Add the dynamic student registry and compatibility adapter.
3. Capture legacy meal snapshots and convert meals to dynamic storage/calculation.
4. Convert reports, rooms, Stays, expenses, payments, and settlements to the resolver and financial boundary.
5. Build a new isolated database containing students, verified meal history/snapshots/rates, fresh financial collections, and fresh accounts. It does not import old Stays, assignments, fee plans, rooms, deposits, or balances. Required cutover-day rooms, Stays, assignments, and fee plans are fresh, explicitly approved configuration effective no earlier than `financialStartDate`.
6. Run exact data comparisons, replica-set integration, browser, security, build, and CI checks.
7. During an approved maintenance window, block source writes, take a final production backup, run one idempotent meal delta/snapshot verification pass, and request explicit cutover approval. Dual-write/change-capture is not part of this migration.
8. Verify the new production system and lock the old archive read-only.

## Failure handling and rollback

- All migration tools require `--dry-run`, `--verify`, and `--target-db` and reject the current source database as a destination.
- Writes are idempotent and stop on unknown keys, count mismatches, checksum mismatches, or unverified snapshots.
- Cutover is a connection/configuration switch, not destructive source mutation.
- Rollback points the application back to the untouched source database while retaining the failed target for diagnosis.

## Verification

- Unit tests cover identity generation/validation, lifecycle transitions, eligibility boundaries, dynamic allocation, cutoff behavior, and authorization.
- Integration tests run against a replica set for transactions, indexes, and concurrent mutations.
- Migration tests compare every historical day, snapshot, participant, price, share, revision, and checksum.
- Browser tests add a fourth student and prove automatic appearance across the relevant modules, archive visibility in history, and independent optional onboarding steps.
- Release checks require the declared Node version, all existing suites, build, security verification, isolated migration verification, restore drill, and CI.
