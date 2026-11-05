# V3 source inventory and offline preflight

**Task 15 did not connect to genuine Atlas.** Current counts and costs from tests describe isolated fixtures only. A future authorized operator must obtain an independent, read-only source inventory before cutover. It must run under a principal with `listCollections`, `listIndexes` and read access, and no write, drop or database creation privilege.

## Authorized future procedure

1. Independently attest the exact source cluster ID, database name and replica-set name against the approved allowlist. Record server time and read-only credential identity without logging the URI. List **all** collections, document counts and indexes; compare required source indexes and flag every unknown collection. Capture meal date coverage, revisions, all participant IDs, monthly rate months, stored snapshot/correction counts and historical cost totals in integer paise. Record malformed dates, duplicate dates, missing snapshot/correction authority and missing rates as stop conditions.
2. Create a complete encrypted source archive with the existing backup engine under the read-only source principal. Keep the manifest and archive separate. Generate an authenticated legacy snapshot sidecar from that exact archive, and verify it. If a source checksum changes, generate a fresh archive and sidecar; never reuse old authority.
3. Run the offline command below in a restricted operator environment. It **opens no database connection**. The key is injected from a secret manager into `BACKUP_ENCRYPTION_KEY` for this process only. Paths are private; the report is created without overwrite, mode `0600` where the operating system supports it. On Windows, additionally restrict the ACL to release operators. Preserve an immutable report copy.

```text
npm run preflight:v3-source --workspace backend -- --archive <encrypted-archive> --manifest <manifest-json> --snapshot-sidecar <authenticated-sidecar-json> --report <new-private-report-json>
```

The **private JSON report** includes every archived collection, count, index definition and checksum; archive/manifest fingerprints; historical meal date range and months; participant IDs and presence of the original three IDs; archived and sidecar snapshot counts, correction count, rate months, historical household/member paise totals and unexpected/malformed-record issues. The CLI now requires `--report` and prints only pass/fail, collection/day/issue counts and a report-written flag to stdout. It never prints student IDs or student-level costs. `passed: false`, any issue, or a missing source identity blocks the cutover review. Compare report fingerprints with independent Atlas inventory and restored recovery database. The offline report cannot by itself prove the live source is unchanged or that credentials had read-only scope.

4. Restore the complete archive to an independently approved recovery database and verify all collection checksums, counts, indexes and read access using the v2 application. Retain the original source unchanged. Repeat inventory, archive and preflight after the write freeze for the final replay.
