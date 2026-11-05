# V3 production cutover control design

**Preparation only. No Atlas connection or production migration is implemented by this document.** The existing `migrate:v3` and `db:restore` CLIs remain restricted to disposable local replica sets. Never weaken their `isolated-test` guard or add a generic production override. Task 15's `v3ProductionGate.service.js` is offline validation for an independently reviewed future executor; importing it makes no network connection.

## Trust boundaries

Three different Atlas database identities are required: immutable v2 **source**, independent full-archive **recovery**, and empty v3 **target**. Each identity is the triple `(Atlas cluster ID, database name, replica-set name)`, not a URI substring or a database-name convention. The release owner supplies an exact allowlist through a protected, separately controlled channel. A second operator obtains the observed cluster ID from the Atlas control plane and the connected replica-set name/database name from the MongoDB handshake using read-only credentials, and signs the observation. The proposed plan, allowlist, and observed values must match exactly. A production executor must independently verify these observations again immediately before each connection or mutation; passing caller-supplied objects to the offline validator alone does not establish trust.

`validateProductionCutoverPlan` rejects unknown fields, URI material, missing archive fingerprints, overlapping identities and any mismatch among plan, allowlist and observation. The plan digest binds all three identities, both archive fingerprints, and the explicitly chosen financial boundary. It does **not** choose a date. Revalidate the frozen archive fingerprint after the write freeze; a changed fingerprint invalidates earlier approvals.

Each production-changing step has its own short-lived, single-use authorization. `verifyProductionActionApproval` checks an Ed25519 signature from a release owner and a different operator over `planDigest`, exact action, expiry and nonce. Keys come from a protected signer registry, never the source database or a request payload. A future executor must atomically record nonce consumption in an immutable release journal and reject replay. It must also verify the approvers' current authorization and stop on expired approval, changed plan, changed observed identity, failed checksum, or changed write-freeze state. Approval of one step never authorizes the next. No production executor is shipped in Task 15.

## Credentials, artifacts and audit

- Give the inventory/archive principal read-only source permissions. Give the recovery principal creation and read/write rights only on the approved recovery database. Give the target principal rights only on the approved target. Keep separate application runtime credentials for v2 and v3. No principal can drop the source or create arbitrary databases.
- Obtain short-lived credentials and encryption/signing keys from the operator's secret manager. Do not put them in plan JSON, shell history, CLI flags, Git, CI logs, or HTTP responses. Restrict archive, sidecar, manifest, report and approval journals to the operator group. Store the archive and recovery key separately, with an immutable off-host copy.
- Record step name, plan digest, approval identifiers, operator IDs, UTC time, archive and target fingerprints, read-only verification result and rollback checkpoint. Redact URI, username, password, token, backup key and signing material. Use append-only storage outside both source and target for the release journal.
- Before any service switch, revoke old sessions or rotate the JWT signing key under a separately approved step; test canonical-only authentication, primary and recovery Super Admin access, and blocked legacy fallback. Keep rollback credentials protected and independently tested.

## Application and data flow

1. Run the **offline** archive preflight on an authorized source backup and authenticated snapshot sidecar. The source itself remains read-only. Independently restore and verify the entire encrypted archive in the approved recovery database.
2. Apply allowlisted historical meal, snapshot, correction, rate, student and audit records to a new empty target. Preserve original IDs and exact integer-paise costs. Do not copy old payments, settlements, rooms, Stays, rent, deposits, expenses or credits. Create two fresh Super Admin accounts and leave the financial boundary unset.
3. Freeze all v2 writers, archive the frozen source, capture the matching sidecar and replay the complete final meal-domain delta. Compare every source/final/target date and paise checksum. A non-meal source change or one-paisa difference stops cutover.
4. After a separate approval, set the owner-approved boundary and explicitly initialize active student eligibility and fresh operational configuration. Keep missing eligibility or financial configuration blocked. Prepare Render and Vercel separately; switch active service/connection only on another approval. Open writes only after login, historical, finance, browser and monitoring checks pass.
5. Rollback means stop v3 writes, preserve the v3 target, reconcile any v3-only records separately, and restore the prior release and protected v2 source connection. Never delete either database or silently insert v3 transactions into v2.

The operator sequence and stop conditions are in [V3_CUTOVER_AND_ROLLBACK.md](V3_CUTOVER_AND_ROLLBACK.md). The source evidence process is in [V3_SOURCE_PREFLIGHT.md](V3_SOURCE_PREFLIGHT.md).
