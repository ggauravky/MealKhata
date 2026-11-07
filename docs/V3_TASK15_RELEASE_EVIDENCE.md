# Task 15 local cutover-preparation evidence

Starting branch: `feat/mealkhata-v3-dynamic-students` at `53661f0cc93851525c59b87e31a1ff86d92857ae`. The previous remote [GitHub Actions run](https://github.com/ggauravky/MealKhata/actions/runs/42015819604) passed at that SHA. This Task 15 commit has **not** been pushed, so no new remote CI result exists. Node.js used locally: `24.22.1`.

## Isolated rehearsal

`backend/test/v3Migration.test.js` uses a disposable one-node MongoDB replica set and three separate databases. It inventories an original v2 source, builds an encrypted archive with historical cost baselines, authenticates a legacy snapshot sidecar, restores a complete recovery copy, applies history to an empty v3 candidate with fresh Super Admin accounts and an unset boundary, simulates a source edit and freeze, re-archives and replays the final meal delta, verifies exact historical authority and indexes, and simulates an interruption before a transactional replay checkpoint. It then sets a **test-only** boundary, writes two new v3 payments, verifies the post-cutover audit, proves an orphan reference claim fails, switches the active connection reference back to v2, and compares every frozen source collection checksum. Neither v3 payment ID is in v2. No real connection string or Atlas database was used.

`v3OperationalFinanceAudit.test.js` covers post-boundary deposit receipts with historical Stay context, reclassifications, credit-funded reimbursements, orphan and pre-boundary obligations, duplicate charges, one-paisa credit imbalance, orphan payment claims, pre-boundary credit targets, embedded charge adjustments and clearance snapshots. `v3ProductionGate.test.js` exercises exact allowlisted/observed identity matching and independent per-action signatures. `v3SourcePreflight.test.js` uses an original-style source without stored snapshots, checks archive-only counts/indexes/dates/IDs/paise and sidecar authority, and exercises the offline CLI with verified files.

## Local gates

- Frontend tests: 234 passed.
- Backend tests: 663 passed in the final complete suite. The old-operational-identifier regression was observed failing before its fix and passing afterward.
- Browser E2E: 3 passed in an isolated replica set, including dynamic fourth-student finance and historical browser flows.
- Frontend production build, backend dual-mode build/security checks and representative endpoint performance: passed. Performance: 50 requests per endpoint, 0 errors, all p95 under 250 ms.
- `npm audit --audit-level=high`: passed with four **moderate development-only** ESLint/minimatch advisories. `npm run security:check` found zero production vulnerabilities, no hardcoded production secrets and passed its application controls.
- Lint: 0 errors, 203 existing unused-symbol warnings. Task 15 changed files pass targeted lint.

## Remaining production gates

The production executor, independent Atlas control-plane observations and one-use approval journal are not implemented or verified against real Atlas. No genuine production source inventory, archive, recovery restore or historical paise comparison was performed during Task 15. No real financial boundary was chosen. The release owner must review the architecture and approve an executor design, exact identities, read-only inventory, maintenance window and real boundary before any production action. The four moderate development dependency advisories and the 644 kB main frontend chunk warning are nonblocking maintenance items; an ESLint major-version rollback from `npm audit fix --force` and unrelated UI redesign were deliberately avoided.

**Recommendation: NOT READY — BLOCKERS REMAIN.** The local preparation can be reviewed, but it does not authorize or enable a production cutover.
