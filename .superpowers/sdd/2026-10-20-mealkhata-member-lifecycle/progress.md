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
