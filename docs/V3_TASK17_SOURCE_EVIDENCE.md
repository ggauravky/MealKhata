# Task 17: staged source evidence and review protocol

**Implementation and disposable-replica-set rehearsal only. No genuine Atlas access was authorized or performed. Status: NOT READY — SOURCE EVIDENCE PENDING.** No module here opens an Atlas connection, deploys, configures the financial boundary, or executes a production migration. The existing migration and restore CLIs remain restricted to local `isolated-test` replica sets.

## Two-stage release lineage

Stage A is the exact `mealkhata-v3-stage-a-v1` plan. It binds a stable release ID, exact source/recovery/target `(clusterId, databaseName, replicaSet)` identities, owner-intended financial start date, approved procedures SHA-256, expiry (at most 24 hours), and base archive SHA-256 when available. A missing base hash is represented by `null`; the `archive-source` checkpoint must then establish it. Distinct owner/operator Ed25519 signatures approve the Stage A digest. Each of the seven Stage A actions, from inventory through the frozen archive, needs its own distinct five-minute dual-signed approval. The frozen archive action is **after** the separately approved write freeze but **before** Stage B. Neither a test result nor a plan file authorizes an action.

Stage B is an explicit `mealkhata-v3-stage-b-amendment-v1` bound to the original release ID and Stage A digest. It binds the unchanged source identity and financial boundary, the base and frozen archive SHA-256 values, snapshot-sidecar SHA-256, frozen source inventory SHA-256, freeze attestation SHA-256, base/final inventory comparison SHA-256, verified final meal delta SHA-256, observed freeze timestamp, no unexplained drift, and a fresh expiry (at most 24 hours). An injected, independently reviewed evidence verifier must match every artifact hash before separate owner/operator signatures can approve the amendment. Approval is never automatic. Only then can `replay-final-meals` and later Stage B actions receive individual approvals.

Both phases use one separate, protected release-control MongoDB collection. A unique release-ID document retains original plan, amendment, signed approvals, action status and checkpoints. Every consumed nonce is stored as a SHA-256 `_id`; a transaction atomically records the nonce and release state. The controller re-hashes the stored plan and amendment before use, checks a known base archive against the Stage A archive checkpoint, and binds the Stage B freeze attestation to the Stage A freeze checkpoint. Restart, a changed digest, a new nonce, or a new plan version cannot reuse a consumed or failed action on the same release ID. Reserved or failed actions stop release progress; operators must inspect partial effects and prepare a newly reviewed release, never silently retry. Source/recovery/target identity observers are injected separately and rechecked for each action. No production observer or handler is bundled.

## Read-only source evidence

`v3SourceEvidence.service.js` receives an already-open connection and injected independent identity, permission-scope and monotonic write-epoch observers. The collector calls only `listCollections`, `listIndexes`, `find`, and a read-only MongoDB snapshot transaction on the primary. It inventories every collection, including unknown ones, records counts and checksums, preserves unique/partial index options, and profiles dates, months, participant IDs, original identities, legacy/v3 versions, revisions, audit changes, overrides, physical plates, snapshots, corrections, rate records and old financial collection counts. Unknown collections are findings; they remain in the complete archive even though they are not imported into the fresh operational target.

Collection names and indexes are read before and after the snapshot. The independent write epoch must be unchanged across all reads. A changed epoch, collection set, index set, expired snapshot or unverified read-only scope rejects the evidence. The snapshot scan has a 30-second default bound and must fail rather than silently retry against a new database state. In a future production adapter, the write epoch must come from a durable, monotonic database/control-plane observation; a caller-supplied constant is **not** proof. This collector establishes only a preliminary consistent inventory. It cannot itself prove writers are frozen, that no write was reverted, or that the connection was independently authorized.

The existing backup engine performs inventory and baseline queries separately, so an archive made while writers run is not assumed consistent. Compare every archived collection document checksum, count and index option with the consistent source inventory and its observed write epoch. If a source or backup preparation change occurs, discard the candidate evidence and archive. The final authoritative archive requires an independently verified writer stop, observed freeze timestamp, repeat inventory/epoch check, authenticated sidecar, exact archive comparison and the signed Stage B amendment. For an inventory that exceeds the supported snapshot lifetime, schedule a controlled write-freeze and build the archive from that verified stable state; do not increase transaction lifetime or combine different scan epochs by hand.

`v3FrozenSourceEvidence.service.js` is the offline artifact verifier for the Stage B handoff. It authenticates both archives, compares each to its matching consistent inventory, checks unchanged source identity and base-archive → observed-freeze → final-archive chronology, requires an injected independent write-freeze verifier, authenticates the final snapshot sidecar, validates all final historical paise, compares every collection/index, enforces an exact review for v2-only changes, and hashes the bounded final meal-domain delta. It returns the frozen inventory, freeze attestation, sidecar, comparison and delta SHA-256 values that the signed amendment must bind. The injected freeze verifier is a trust boundary; Task 17 supplies no live Atlas implementation or production freeze probe.

## Historical and recovery proof

`v3HistoricalEvidence.service.js` authenticates the archive, manifest and legacy snapshot sidecar, runs the existing versioned migration/correction-chain validation, compares each archived daily baseline to its source authority, and optionally compares an exact proposed target authority. The full daily authority checksum includes status, allocation, physical plate/share information, pricing and member/household paise. Audit facts and timestamps are checked separately. Legacy days retain immutable `legacy-v2` snapshot authority; v3 days use their saved participant order and dynamic allocation rules. Daily student paise must sum to household paise, and daily totals must equal full monthly archived aggregates. A missing or duplicate date, missing snapshot, changed correction chain, audit change or one-paisa difference blocks approval. The financial boundary is recorded as a separate decision and never changes historical cost evidence.

The protected evidence package contains release ID/version, attestation references, inventory and archive fingerprints, sidecar checksum, collection counts/index hashes, exact historical daily/monthly/student paise, corrections, consistency findings, eligibility gaps, approval signatures and journal references where supplied, recovery results, blockers and a deterministic SHA-256 of the package. `writeProtectedReleaseEvidence` creates private JSON and human-readable review files with mode `0600` and no overwrite. Its returned summary contains only aggregate counts, statuses and a checksum. `verifyReleaseEvidencePackage` rejects tampering.

For recovery, restore the **complete** original archive to a distinct disposable/approved recovery identity, then independently compare every collection, count, document checksum and index against the manifest. Re-scan the source to prove its fingerprint remains unchanged, perform a read-only v2 application probe, and confirm known v3-only record IDs are absent from recovery. Keep a protected external-reference reconciliation register. A real rollback must stop v3 writes, preserve both databases, compare bank/processor references item by item, and obtain separate owner/finance approval before recording any new v2 transaction; never copy v3 payments into v2 silently.

## Genuine-source authorization request template

> Release ID: **[owner supplies]**
> Exact source Atlas cluster ID, database and replica-set name: **[owner supplies through protected channel]**
> Permitted operation: **read-only source inventory and archive verification only**
> Principal: **[short-lived, named principal]**, limited to `find`, `listCollections`, `listIndexes`; no write, drop, database creation, admin or target privilege
> Time window and credential expiry: **[owner supplies]**
> Archive encryption and private evidence storage location/retention: **[owner supplies separately]**
> Independent Atlas control-plane and database-handshake observers: **[named operator and method]**
> Required approvals: **release owner and different operator, each currently authorized, signed for this exact read scope**
> Stop conditions: identity/scope mismatch, write-epoch drift, snapshot expiry, unknown/unexplained collection, missing historical authority, one-paisa mismatch, archive or manifest mismatch
> Prohibited under this request: **migration, recovery/target creation, financial boundary change, deployment, connection switch, data import into tests**.

No such authorization is present in Task 17. Do not open a production connection from an import, application startup, test, or convenience CLI.

## Cutover review checklist and status meanings

- [ ] Independently attest exact source, recovery and target identities and short-lived read-only source scope.
- [ ] Verify a complete, stable source inventory; explain every unknown collection and invalid record.
- [ ] Authenticate the base and frozen archives and sidecars; compare original IDs, every date and monthly integer paise.
- [ ] Verify a complete recovery restore, indexes, source immutability and v2 access.
- [ ] Obtain explicit student eligibility decisions and an owner-approved financial start date, including partial-month policy.
- [ ] Independently review production observers, handlers, staged plan handoff, maintenance window and rollback commands.
- [ ] Validate current owner/operator authority, individual action approvals and protected journal lineage.
- [ ] Reconcile external references and outstanding v2 liabilities without importing them into fresh v3 finances.

`IMPLEMENTATION_VERIFIED` means code and synthetic fixtures passed. `SOURCE_EVIDENCE_PENDING` is mandatory until an authorized genuine-source review. `SOURCE_EVIDENCE_VERIFIED` requires a separately validated genuine attestation bound to the actual inventory and archive. `READY_FOR_CUTOVER_REVIEW` requires that source proof plus recovery, eligibility and executor review with no blockers; it is a request for further review, **not** permission to cut over. Otherwise the readiness remains `NOT_READY — BLOCKERS REMAIN`. Synthetic fixture data can never set the genuine-source status.
