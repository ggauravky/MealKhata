# SDD ledger — plan: docs/superpowers/plans/2026-10-21-existing-assignments-expenses-my-stay.md

Setup: branch update-v2---phases at adc50638893a08aae01d05c53e2b16473dc17a0f; existing working tree preserved.
Setup ruling: bundled SDD bash scripts cannot execute in this Windows sandbox (E_ACCESSDENIED); the plan-scoped workspace and ledger are maintained directly with apply_patch. Cost if wrong: task briefs and review packaging must be assembled manually.
Pre-flight: Task 1 Room Fee adapter feeds Task 5 assignment-aware Stay UI only conceptually; no shared function contract.
Pre-flight: Task 2 member roster feeds Task 3 Join Stay status and Admin Stays counts; canonical fields are memberId, account, stay, room, assignment, and feePlan.
Pre-flight: Task 3 extends parseMyStayResponse consumed by Task 5; envelope remains backward compatible while adding currentAssignment/currentRoom.
Pre-flight: Task 4 shares only existing expense IDs and dialogs; no new backend contract.

