# MealKhata v1.0.0 Release Notes

**Release Date**: October 1, 2026  
**Version**: `1.0.0`  
**Status**: Production Ready  

---

## 1. What is MealKhata?

MealKhata is a production-grade, private Progressive Web Application (PWA) designed for shared household meal tracking and monthly accounting among three roommates: **Gaurav**, **Nikhil**, and **Devansh**.

It bridges the gap between ad-hoc messaging group coordination and complex commercial accounting tools by providing an automated, tamper-evident system for daily meal attendance, exact integer-paise shared expense calculation, UPI payment reconciliation, and formal monthly settlement closure.

---

## 2. Key Capabilities & Feature Set

### Daily Meal Tracking
- Morning (lunch) and Night (dinner) attendance tracking with default `taking` status for all three members.
- Date permissions enforce that Members can modify their own meals for today, Admins can coordinate roommates for today, and Super Admin can manage historical corrections.
- Real-time plate count calculation for household kitchen coordination.

### Personalized Role-Aware Dashboard
- Dynamic Asia/Kolkata greeting and instant Today meal toggle hero.
- Live kitchen plate summary (e.g. "Morning: 3 plates · Night: 2 plates").
- Member month-to-date financial summary showing meals consumed, current bill, total payments recorded, remaining due, and projected bill.
- Deterministic Super Admin attention feed highlighting missing rates or pending settlements.

### Calendar & Financial Reports
- Interactive monthly calendar with daily attendance visualizer and date-level edit controls.
- Dynamic monthly billing engine calculating room totals and person-wise amounts from daily plate consumption multiplied by configured meal rates.
- Integer-paise precision throughout the entire calculation pipeline, eliminating floating-point rounding errors.

### Payments & Ledger Reconciliation
- Self-service payment preparation generating encoded `upi://pay` deep links or verified copy-and-pay details.
- User-confirmed manual ledger recording backed by UUID idempotency keys to prevent double-charging.
- Dynamic payment status derivation (Pending, Partial, Paid, Overpaid).
- Non-destructive Super Admin void flow capturing mandatory audit reasons.

### Monthly Settlement & Financial Closure
- Super Admin month closure freezing completed past months into immutable, auditable financial snapshots.
- Strict closing gate requiring exact settlement ($Remaining = 0\text{ paise}$).
- Closed-month mutation locks on meals, rates, and payments.
- Reopening workflow with full historical version tracking upon re-closure.
- Server-rendered A4 PDF statements and RFC-compliant CSV spreadsheet exports.

### Progressive Web App & Smart Reminders
- Standalone installable PWA with offline-safe application shell precaching.
- Network-Only strategy for all financial and authentication APIs.
- Smooth service worker update lifecycle with user-controlled activation (`SKIP_WAITING`).
- Dual-mode reminders: zero-config in-app alerts (Mode A) and optional background Web Push via VAPID keys (Mode B).

---

## 3. System Architecture

```
Client Tier:       React 19 + Vite 8 SPA (Standalone PWA Shell)
Perimeter Tier:    Render Web Service (Reverse Proxy, SSL, Keep-Alive 65s)
Application Tier:  Express 5 + Socket.IO 4 on Node.js 24 LTS
Persistence Tier:  MongoDB Atlas (Mongoose 9, Read-Only Audits)
Disaster Recovery: AES-256-GCM Encrypted Offline Backup Engine
```

All state mutations occur strictly over HTTPS REST endpoints. Socket.IO acts exclusively as an ephemeral, lightweight synchronization channel that emits notification events (`meal.updated`, `payment.recorded`, `settlement.closed`) containing only IDs and dates, triggering clients to refetch authoritative data.

---

## 4. Security & Compliance Architecture

MealKhata operates with enterprise-grade defensive hardening:
- **Session Boundary**: Cookies configured with `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` (production) carrying HMAC-signed JWTs.
- **CSRF & Handshake Origin**: Strict validation requiring `Origin === APP_ORIGIN` on all mutating HTTP routes and Socket.IO handshakes.
- **Centralized Redaction Engine**: Automatic recursive scrubber ensuring zero credentials, hashes, cookies, or database URIs are logged.
- **Request Correlation**: `X-Request-ID` assigned to every transaction and correlated through structured NDJSON logs.
- **Defensive Headers**: Strict CSP with script/connect self-boundaries, HSTS (`max-age=31536000`), Permissions-Policy, and disabled `X-Powered-By`.
- **Rate Limiting**: Multi-tiered protection against brute-force attacks across generic APIs, authentication endpoints, and sensitive financial mutations.

---

## 5. Operational Tooling & Maintenance

MealKhata provides operational commands designed for maintainability and disaster recovery:

1. **`npm run release:check`**: Unified release verification orchestrating linting, tests, production build, dual-mode verification, security audits, and performance baselines.
2. **`npm run perf:check`**: Automated read-endpoint benchmark verifying p95 latencies $< 250\text{ ms}$ under concurrent load.
3. **`npm run security:check`**: Static pattern detector, secret leak scanner, and production npm audit runner.
4. **`npm run verify-indexes`**: Non-destructive index audit comparing live MongoDB collections against Mongoose schemas.
5. **`npm run verify-data`**: Read-only consistency verifier auditing 12 domain invariants across all collections.
6. **`npm run db:backup`**: AES-256-GCM encrypted backup archive generator preserving BSON Extended JSON types.
7. **`npm run db:backup:verify`**: Cryptographic integrity and SHA-256 manifest verification tool.
8. **`npm run db:restore`**: Protected restoration tool requiring separate target configuration (`RESTORE_MONGODB_URI`).

---

## 6. Known Intentional Limitations

The following architectural choices are intentional for MealKhata v1.0.0:
1. **Three-Member Household Boundary**: Fixed member structure (`gaurav`, `nikhil`, `devansh`) by design; no public self-registration.
2. **User-Confirmed Payments**: Payments are confirmed by household users rather than banking webhook APIs.
3. **Optional Background Push**: Web Push is optional; core application functionality does not depend on VAPID configuration.
4. **Offline Read-Only Shell**: Meal updates and payments require a live connection to preserve audit consensus; offline mutations are disabled by design.
5. **Ephemeral Local Storage**: Backups generated on Render's ephemeral filesystem must be transferred off-box or MongoDB Atlas automated cloud backups must be configured as primary.

---

## 7. Deployment Requirements

- **Runtime**: Node.js `24.x`
- **Database**: MongoDB `7.x` or MongoDB Atlas Cluster
- **Hosting**: Render Web Service (Single instance, `render.yaml`)
- **Optional Push Cron**: Render Cron Job (`render.push.yaml`)
- **Required Core Environment**:
  `NODE_ENV`, `PORT`, `APP_TIMEZONE`, `APP_ORIGIN`, `MONGODB_URI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD_HASH`, `AUTH_JWT_SECRET`.
