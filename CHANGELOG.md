# Changelog

All notable changes to MealKhata are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.0-rc] - Unreleased

### Added
- Dynamic MongoDB student roster, optional canonical accounts, eligibility, archival and historical lookup; original student IDs remain stable.
- Exact integer-paise meal allocation and reports for arbitrary student counts, with historical snapshot and correction authority.
- Local-only blue-green migration rehearsal with read-only v2 archive baselines, authenticated legacy snapshot sidecars, full frozen-source meal-domain delta replay, pre/post verification and rollback checklist.
- Chromium browser acceptance on an isolated MongoDB replica set and a feature-branch CI path for quality and browser checks.

### Fixed
- Final delta replays changed legacy snapshots, correction chains and monthly rates atomically with meal days and its checkpoint; a one-paisa drift fails verification.
- Migration, restore and snapshot database tools require explicit isolated-test classification and local cluster identity for Task 14 execution.
- Meal sharing row saves prevent overlapping clicks; meal audit uses resolved student names and its markup has no invalid nested paragraph.

### Release status
- Production cutover, real financial start date, Atlas target connection, deployment and live rollback remain subject to separate review and approval.

## [1.0.0] - 2026-10-01

### Added
- **Production Progressive Web App**: Installable standalone mobile-first application shell with precaching, background sync, and update notification lifecycle.
- **Individual Member Accounts**: Dedicated accounts for Gaurav, Nikhil, and Devansh with identity-aware authorization and personal meal control.
- **Role-Aware Home Dashboard**: Unified composition endpoint (`GET /api/dashboard`) rendering personalized daily home views, India greeting, roommate plate requirements, and monthly financial summaries.
- **Immutable Payment Ledger & UPI Flow**: Idempotent manual payment confirmation, exact UPI intent link generation, partial/paid/overpaid derived states, and Super Admin audit void flow.
- **Monthly Accounting Settlement**: Exact settlement validation ($Remaining = 0$), versioned audit snapshots upon reopening, closed-month mutation locks, and downloadable PDF/CSV statement exports.
- **Dual-Mode Reminders**: Proactive in-app reminder banners with optional background Web Push via VAPID keys and smart meal-attendance dispatch filtering.
- **Disaster Recovery & Backup Engine**: High-fidelity BSON Extended JSON archiving, gzip compression, and AES-256-GCM encryption with SHA-256 manifest verification and targeted restore tooling.
- **Operational Verification Tooling**: Safe non-destructive index verification (`npm run verify-indexes`), data integrity audit (`npm run verify-data`), performance baseline check (`npm run perf:check`), and release verification suite (`npm run release:check`).

### Security
- **Perimeter Defense**: Strict Content Security Policy, HTTP Strict Transport Security (HSTS), Permissions-Policy, `nosniff`, and disabled `X-Powered-By`.
- **Authentication**: `HttpOnly`, `SameSite=Lax`, `Secure` session cookies with signed high-entropy JWTs and constant-time bcrypt cost factor 12 password hashing.
- **Cross-Site Request Forgery (CSRF)**: Strict `Origin === APP_ORIGIN` validation on all mutating API routes and WebSocket handshakes.
- **Centralized Redaction Engine**: Automatic recursive scrubbing of passwords, hashes, tokens, cookies, auth headers, VAPID private keys, and MongoDB connection strings from all server logs.
- **Rate Limiting**: Multi-tiered rate limiting across generic API requests (300/15m), login attempts (10/15m), and sensitive financial/settlement mutations (60/15m).
- **Error Boundaries**: Sanitized user-facing errors preventing stack trace disclosure; malformed JSON payloads safely return 400 Bad Request.

### Reliability & Observability
- **Lifecycle Management**: Explicit server lifecycle state machine (`starting` $\to$ `ready` $\to$ `draining` $\to$ `stopped`) returning 503 during graceful shutdown.
- **Request Correlation**: End-to-end request correlation via `X-Request-ID` across HTTP requests, error logs, and JSON responses.
- **Structured Logging**: Machine-readable single-line NDJSON logs in production with response timing and automatic slow-request detection ($\ge 1000\text{ ms}$).
- **Database Resilience**: Bounded connection pools, Mongoose connection lifecycle listeners, and bounded database readiness probes.

### Fixed
- Stale phase-era documentation contradictions regarding background notification delivery.
- Overly broad regex matching in security scanning tools preventing multiline false positives.
- Eliminated all potential N+1 database queries on high-traffic reporting and dashboard paths.
