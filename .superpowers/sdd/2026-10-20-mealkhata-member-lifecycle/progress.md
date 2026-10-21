# SDD ledger — plan: docs/superpowers/plans/2026-10-20-mealkhata-member-lifecycle.md

Baseline: branch update-v2---phases at 4a365da; working tree initially clean.
Baseline: frontend stays/room-fees focused tests 38/38 passed.
Baseline: backend stays/room-fees/auth focused tests 65/65 passed with localhost access; sandbox-only run failed with EACCES on Supertest ports.
Pre-flight: Task 1 DTO helpers feed MyStayPage and LifetimeFinancialOverview; backend contracts are authoritative.
Pre-flight: Task 2 assignment resolver feeds Tasks 3 and 4 roster/cancellation; exact-date occupancy and month billing are separate interfaces.
Pre-flight: Task 3 roster route is extended by Task 5 account mutations and consumed by Tasks 3 and 6 UI.
Pre-flight: Task 4 cancellation relies on existing financial repositories and Task 2 assignment identity.
Pre-flight: Task 5 canonical-account policy is consumed by authentication and Task 6 UI.
Ruling: execution helper scripts require unavailable Bash/WSL access; keep this manual ledger with equivalent task evidence.
Ruling: do not create intermediate commits because the user requested working-tree implementation, not history mutation; preserve a focused final diff and verification record instead.
Task 1: complete (tests: frontend member lifecycle + stays 23/23 passed; Vite production build exit 0).
Task 1: root causes confirmed — `/api/stays/me` envelope was discarded while consumers expected it; completed stays were never selected; lifetime and deposit components consumed obsolete flattened DTOs; section request failures had no rendered error state.
Task 2: complete (tests: assignment resolver + room-fee suite 24/24 passed).
Task 2: month billing now selects the newest assignment overlapping the month; exact-date occupancy has a separate resolver; legacy month-only records remain supported.
Task 3: complete (backend assignment/roster/historical tests plus Stay suite 25/25 passed; frontend lifecycle tests 24/24 and build passed).
Task 3: Residents now derives from the canonical three-member roster; historical admissions require Super Admin plus a reason in production and retain the original Asia/Kolkata logical date without issuing charges.
Task 3: Ruling: legacy Phase 4 tests construct historical admissions under NODE_ENV=test; the service factory exposes `enforceHistoricalPolicy` so regression tests opt in explicitly while production defaults to enforcement.
Task 4: complete. Super Admin cancellation and admission correction are revision-guarded, transactionally update only admission-owned artifacts, preserve audit history, block financial/clearance activity, release capacity, and allow valid re-admission.
Task 5: complete. Canonical `user_accounts` provisioning, email/password/status mutations, reauthentication, bcrypt hashing, session-version revocation, audit records, legacy fallback blocking, and duplicate-identity concurrency protection are implemented.
Task 6: complete. `/admin/members` lists the three stable identities, separates account and Stay state, provides Super Admin credential controls, and exposes read-only account state to regular Admins.
Integration: `/room-fees` has an explicit Admin member selector; `/admin/stays` uses the canonical roster; `/my-stay` maps stay, deposit, room-history, and lifetime DTOs and is protected by an actionable error boundary.
Financial safety: ambiguous month-level attribution is reported and blocks automatic No-Dues clearance; the checkout wizard now renders authoritative review totals and requires an audited Super Admin exception for ambiguity.
Verification: backend 439/439; frontend 205/205; real MongoDB replica-set subset 30/30; focused final lifecycle contracts 29/29; Vite build passed; production verification passed; security check passed with zero production dependency vulnerabilities; lint passed with 0 errors and 221 pre-existing warnings; `git diff --check` passed.
Browser verification: static production preview with isolated API mocks rendered `/admin/members`, `/my-stay`, `/room-fees?memberId=nikhil`, and `/admin/stays`; password inputs were empty and masked, all three identities rendered, and the selected Room Fees member remained explicit. Socket.IO connection refusal was expected because no live backend was started for this isolated browser pass.
Skipped: `verify-indexes` and `verify-data` were not run because no explicitly isolated database URI was supplied; no production or genuine records were mutated.
