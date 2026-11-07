# Task 17 local release evidence

Starting commit: `4ea23df58b3a0b85f89f00f6397be0df6d735977` on `feat/mealkhata-v3-dynamic-students`. Node.js: `24.22.1`. All source, journal, migration and recovery tests used disposable local MongoDB replica sets or mocks. No genuine Atlas source, user data, production backup, target, financial boundary, deployment or cutover was accessed or changed. Nothing was pushed or merged.

## Implemented and verified

- Two-stage release lineage: immutable Stage A with optional base archive hash, seven separately approved actions, then a separately dual-signed Stage B frozen-source amendment. The amendment binds the original release ID/digest, unchanged identities and boundary, actual archive, authenticated sidecar, frozen inventory, freeze attestation, collection comparison and final meal delta. The protected journal atomically consumes nonce hashes and preserves approvals, checkpoints, failures and phase history. No plan-version change can reuse a failed or completed release action.
- Read-only source evidence: injected independent source identity, credential-scope and monotonic write-epoch observations; primary snapshot document reads; before/after collection and index checks; a bounded snapshot lifetime. The collector makes no source write calls. Unknown collections are retained in the archive and flagged. A live production adapter and a trustworthy write-epoch/freeze observer remain unimplemented.
- Historical cost evidence: authenticated archive and legacy sidecar, versioned legacy/v3 authority, exact date and monthly student/household paise, preserved audit/timestamps, correction chain, fourth identity and separate boundary metadata. Missing or duplicate dates/snapshots and one-paisa target drift fail.
- Frozen amendment artifacts: base/final archive and inventory matching, independent injected freeze verification, authenticated final sidecar, exact non-meal drift review, bounded meal delta and deterministic SHA-256 evidence binding.
- Recovery evidence: re-scan the original source, compare complete restored collection documents and indexes, verify separate recovery identity and v2 read access, and reject v3-only financial IDs in the recovery copy. External payment references require protected manual reconciliation during any real rollback.
- Protected machine-readable JSON and human-readable review artifacts: no overwrite, restrictive file mode, deterministic checksum, private student paise and signatures, safe aggregate return summary. Synthetic data cannot be classified as genuine-source evidence.

## Local verification

| Gate | Result |
| --- | --- |
| Complete backend suite | **693 passed, 0 failed, 0 skipped** |
| New staged/source/recovery targeted suite | **17 passed, 0 failed** |
| Complete frontend suite | **234 passed, 0 failed, 0 skipped** |
| Isolated Chromium browser suite | **3 passed, 0 failed** |
| Full lint | **0 errors, 203 existing unused-symbol warnings** |
| Frontend build and backend dual-mode production build check | **Passed**; existing 644.34 kB main-chunk warning |
| Application security check | **Passed**; zero production dependency vulnerabilities |
| `npm audit --audit-level=high` | **Passed**; four moderate ESLint/minimatch development dependency advisories remain |
| Performance baseline | **7 endpoints × 50 requests, 0 errors, all p95 < 250 ms**; highest p95 61.5 ms |

The full backend suite includes isolated migration, backup/restore, approval-journal, historical snapshot/correction, source consistency, data/index and exact financial reconciliation tests. Browser setup uses a disposable replica set and runs data/index checks before acceptance. These results prove only the code and synthetic fixtures exercised locally.

## Readiness

**NOT READY — SOURCE EVIDENCE PENDING.** No real source inventory, archive, sidecar, recovery restore, read-only scope attestation, independent Atlas identity observation, owner/operator current-authority check, student eligibility decision or actual financial boundary has been verified. The Stage B freeze verifier and action observers/handlers are injected interfaces, not production adapters. A future read-only genuine-source inspection needs the separate explicit owner authorization in [V3_TASK17_SOURCE_EVIDENCE.md](V3_TASK17_SOURCE_EVIDENCE.md). A separate, reviewed production execution and rollback procedure remains necessary before Task 18 or any cutover decision.
