# SDD ledger — plan: docs/superpowers/plans/2026-10-22-production-readiness-repair.md

Setup: `update-v2---phases` clean at `5ea1237f158f81863613fbdb4d0ea42143439335`; inline execution because subagent delegation is disabled for this task.
Pre-flight: Task 2 transaction starter is consumed by Task 3 checkout serialization; in-memory repositories must remain transactionless while live Mongo repositories fail closed.
Pre-flight: Task 3 financial guard is consumed by Task 4 attribution and Task 5 real-stack mutations; exact date/month context is required to avoid blocking unrelated post-hostel expenses.
Pre-flight: Task 1 genuine read-only findings drive Task 4 integrity checks; no production repair is authorized.
Task 1: DNS finding — PowerShell system and Cloudflare SRV lookups resolve the three Atlas nodes, while Node's initial system resolver returns `querySrv ECONNREFUSED`; existing `connectDatabase()` public-resolver fallback succeeds.
Task 1: Atlas ping — connected read-only to database `mealkhata`; 23 collections visible; no secrets printed.
Task 1: genuine records — three active member accounts; two active rooms; Nikhil and Devansh have open month-only assignments; Gaurav has two ended October assignments and one checked-out Stay; no current Gaurav assignment on 2026-10-22.
Task 1: anomaly — four open Gaurav Fee Plans start in 2026-10 (three at 480000 paise, one at 250000 paise); current verifier reports PASS and therefore lacks overlap detection. Checked-out Gaurav Stay has a zero-expected OPEN deposit account and legacy-null admission provenance.
Task 1: existing read-only checks — 22/22 model index sets PASS with 0 missing; 11/11 data sections report PASS and 0 issues, demonstrating the overlap/reference coverage gap to fix in Task 4.
Task 1: complete (read-only DNS, ping, projected record audit, and sanitized index/data summaries; zero Atlas writes).
Task 2: RED — `transaction startup failure rejects admission before any lifecycle write` resolved instead of rejecting, proving the downgrade path.
Task 2: complete (shared fail-closed lifecycle transaction starter; Stay tests 26/26; focused replica-set admission/rollback tests 3/3).
Task 3: RED — five deterministic races (room-payment void, Mess-payment void, financial expense correction, deposit refund, reimbursement void) all allowed checkout to resolve from the stale transactional review; the existing adjustment test was also converted from sequential to a gated concurrent race.
Task 3: ruling — a financial mutation attributable to a completed Stay is rejected with `CLEARANCE_REVIEW_REQUIRED`; callers must use the audited clearance-review/reissue workflow rather than silently changing an immutable clearance snapshot.
Task 3: complete — Stay `financialRevision` serializes checkout with attributable Mess, room, deposit, expense, and reimbursement mutations; all six targeted checkout races pass and the full real replica-set integration suite passes 37/37.
Task 4: RED — the read-only verifier passed fixtures containing overlapping Fee Plans, overlapping member assignments, over-capacity room intervals, missing Stay/deposit references, and a checked-out Stay with an OPEN deposit account. Same-month Stay statements also retained unresolved month-level Mess/Room amounts in attributed totals.
Task 4: complete — interval/reference/deposit lifecycle checks now report the fixtures; same-month Mess/Room amounts are preserved under explicit `unattributed` fields and warnings but excluded from each Stay's attributed totals, while exact-date Expenses remain separated and automatic No-Dues remains blocked.
Task 4: verification — Phase 12 security/integrity suite 27/27 and real replica-set suite 37/37 pass. Updated Atlas read-only verification now reports 7 blockers: 6 pairwise overlaps among Gaurav's 4 open Fee Plans and 1 checked-out Stay with an OPEN zero-expected deposit account; no genuine data was changed.
