# MealKhata

**Meals tracked. Bills sorted.**

MealKhata is a private, production-grade meal tracking and shared-accounting progressive web application (PWA) built for three roommates: **Gaurav**, **Nikhil**, and **Devansh**.

---

## Overview

MealKhata simplifies daily household meal coordination and monthly shared-expense settlement:
- **Daily Meal Scheduling**: Morning and Night meal tracking with an automatic Taking default.
- **Role-Aware Home Dashboard**: Personalized views for individual Members, household Admins, Super Admin, and public Viewers.
- **Transparent Monthly Accounting**: Integer paise billing derived on-the-fly from daily meal consumption and approved monthly rates.
- **Self-Service & Admin Payments**: Direct UPI intent generation and an immutable, idempotent payment ledger with Super Admin void correction.
- **Formal Month Closing & Settlements**: Exact-settlement validation ($Remaining = 0$), versioned audit snapshots, mutation locks, and downloadable PDF/CSV financial statements.
- **Mobile-First Progressive Web App (PWA)**: Standalone installation, offline-safe application shell, and graceful update management.
- **Smart Dual-Mode Reminders**: In-app proactive reminder banners and optional background Web Push notifications.
- **Production Hardening & Operations**: Structured secret-redacted logging, request correlation (`X-Request-ID`), bounded graceful shutdown with traffic draining, non-destructive data/index verification, and AES-256-GCM encrypted backup/restore tooling.

---

## Features

- **Personalized Daily Dashboard**: Instant Taking/Skip toggle for today's meals, household kitchen plate counts, personal month-to-date financial summary, and contextual quick actions.
- **Interactive Calendar**: Visual monthly schedule showing roommate attendance, saved overrides, and date-specific meal permissions.
- **Monthly Reports**: Real-time consumption analytics, room totals, person-wise breakdown, and projected month-end bills.
- **Immutable Payment Ledger**: Every confirmed payment creates an immutable ledger entry. Payment status is derived dynamically (Pending, Partial, Paid, Overpaid).
- **Formal Month Settlement**: Super Admin closing freezes month financials into an immutable statement snapshot with full version history upon reopening.
- **Statement Downloads**: Clean, server-rendered A4 PDF statements and RFC-compliant CSV exports.
- **Realtime Synchronization**: Socket.IO broadcasts synchronization signals to ensure multi-device state consistency without payload leakage.
- **Production PWA**: Offline-safe application shell, responsive mobile layouts (320px–1440px+), safe-area insets, and instant service-worker update lifecycle.

---

## Screens / Workflow

1. **Dashboard (`/`)**: Daily home view. Members toggle today's meals; Admins oversee roommate plate requirements; Super Admin monitors settlement and rate configuration attention items.
2. **Calendar (`/calendar?month=YYYY-MM`)**: Household monthly view. Inspect any past, current, or future month with date-level plate counts.
3. **Reports (`/reports?month=YYYY-MM`)**: Monthly financial report detailing breakfast/dinner plate counts, current rates, total bill, paid amounts, and projected month-end totals.
4. **Payments (`/payments?month=YYYY-MM`)**: Financial ledger page. Members prepare and confirm personal payments via UPI deep links or copy-and-pay details; Super Admin can void mistaken entries with an audit reason.
5. **Admin Panel (`/admin`)**: Administrative controls for configuring monthly rates, managing payment receiver details, setting reminder schedules, and closing/reopening monthly settlements.
6. **Login (`/login`)**: Secure role-aware authentication with 7-day persistent HttpOnly sessions for Admin and Super Admin, and 12-hour sessions for Members. Sessions persist across browser closures while remaining subject to active account status and session version revocation.

---

## Architecture

MealKhata deploys as a unified service on Node.js and MongoDB:

```
                          INTERNET
                             │
                             ▼
                           HTTPS
                             │
                             ▼
                    Render Web Service
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
 Security Headers       Request ID          Rate Limiters
   (Helmet/CSP)       (X-Request-ID)      (API/Login/Mutations)
        └────────────────────┼────────────────────┘
                             ▼
                      Express Server
             (Lifecycle: Ready / Draining)
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   REST API Routes      Socket.IO          Static SPA / PWA
  (Auth, Meals, Pay,    (Realtime Sync)     (Vite Build, SW,
   Reports, Settle)                          Offline Shell)
        │                    │                    │
        └────────────────────┼────────────────────┘
                             ▼
                     Domain Services
                             │
                             ▼
                    MongoDB / Mongoose
             (Read-Only Audits & Verification)
                             │
                             ▼
                 Encrypted Offline Backup
                     (AES-256-GCM)
```

---

## Roles & Permissions

MealKhata enforces server-authoritative role-based access control (RBAC):

| Capability | Viewer | Member (`gaurav`, `nikhil`, `devansh`) | Admin | Super Admin |
| :--- | :---: | :---: | :---: | :---: |
| View Dashboard, Calendar, Reports, Payments | Yes | Yes | Yes | Yes |
| Edit **Own** Today Meals | No | **Yes** | **Yes** | **Yes** |
| Edit **Roommates'** Today Meals | No | No | **Yes** | **Yes** |
| Edit Past / Future Meal Dates | No | No | No | **Yes** |
| Prepare & Record **Own** Payments | No | **Yes** | **Yes** | **Yes** |
| Record Payments for Other Members | No | No | **Yes** | **Yes** |
| Void Payment Ledger Entries | No | No | No | **Yes** (with reason) |
| Configure Monthly Meal Rates | No | No | No | **Yes** |
| Configure UPI Payment Receiver | No | No | No | **Yes** |
| Configure Household Reminder Times | No | No | No | **Yes** |
| Register Personal Push Device | No | **Yes** (own device) | No | No |
| Close / Reopen Monthly Settlements | No | No | No | **Yes** |

All mutations capture the authenticated actor's identity (`actorRole` and `actorMemberId`) in audit history.

---

## Meal Rules & Scheduling

- **Default Taking**: Untouched dates default to `taking` for all three members without requiring advance database document creation.
- **Taking vs. Skip**: `taking` corresponds to exactly 1 plate for billing; `skip` corresponds to 0 plates.
- **Timezone Authority**: All date determinations, cutoff calculations, and reminders operate in `Asia/Kolkata`.
- **Member Ownership**: Members may only modify their own meals for today. Editing other members or past/future dates is strictly rejected with `403 Forbidden`.
- **Concurrency Control**: Meal updates use optimistic locking via document revisions (`revision` counter) to ensure concurrent edits resolve safely.

---

## Billing & Payments

- **Integer Paise Representation**: All financial amounts (rates, bills, payments, balances) are stored and calculated strictly as positive integer paise (e.g., ₹45.50 = `4550` paise) to eliminate floating-point arithmetic errors.
- **Dynamic Billing Derivation**: Monthly bills are derived on-the-fly from daily meal attendance multiplied by the configured Morning and Night rates for that month.
- **Immutable Payment Ledger**: Payments are recorded as individual, immutable ledger entries with UUID idempotency keys. Re-submitting the same idempotency key safely returns the original record without duplicate charges.
- **Correction via Void**: Payments cannot be silently deleted or edited. If an erroneous payment is entered, Super Admin voids the payment with a mandatory audit reason, preserving complete historical transparency.
- **Derived Financial Status**:
  - **Pending**: Zero paid towards an active bill.
  - **Partial**: Paid amount is less than total bill.
  - **Paid**: Paid amount exactly equals total bill.
  - **Overpaid**: Paid amount exceeds total bill (requires correction before closing).
- **UPI Deep Linking**: Configured UPI IDs produce an exact, encoded `upi://pay` URI. If only a phone number is provided, MealKhata provides normalized copy-and-pay details; it never fabricates a fake VPA.

---

## Monthly Settlement & Closures

MealKhata provides an accounting closure layer that freezes past months into permanent financial records:
1. **Closing Criteria**:
   - Must be a completed **past calendar month** in `Asia/Kolkata`.
   - Rates must be configured for that month.
   - Every member must be **exactly settled**: $Bill = Paid \implies Remaining = 0 \text{ and } Overpaid = 0$.
2. **Mutation Lock**: Closing a month permanently locks all meals, rates, and payments for that month (`409 Conflict` on modification attempts).
3. **Reopening**: Super Admin can reopen a closed month by providing a required reason. A new sequence is started upon re-closing (e.g. Settlement #2), preserving prior versions in history.
4. **Official Statement Exports**: Authenticated users can download frozen statements for any closed month:
   - **PDF Statement** (`GET /api/settlements/:month/statement.pdf`): Professional server-rendered A4 statement.
   - **CSV Export** (`GET /api/settlements/:month/statement.csv`): RFC-compliant comma-separated spreadsheet with formula-injection mitigation.

---

## PWA & Reminders

### Progressive Web App
- Installable on desktop and mobile browsers (Chromium, Safari iOS, Android).
- Standalone display mode with custom theme colors and safe-area inset adaptation.
- Static precached application shell (`/index.html`, icons, manifest).
- Network-Only strategy for all `/api/*` and `/socket.io/*` routes.
- Seamless update banner allowing users to activate new releases via `SKIP_WAITING` with a single reload.

### Smart Reminders (Dual-Mode)
- **Mode A (Core / Default)**: Zero external configuration required. Displays smart in-app reminder banners and supports local browser notifications.
- **Mode B (Optional Background Web Push)**: When VAPID keys are configured, members can subscribe their personal mobile or desktop devices. A scheduled background runner dispatches push alerts even when the browser is closed:
  - Smart attendance filter: skips members who marked `skip`.
  - Atomic deduplication: guarantees at most one alert per meal window.
  - Automatic cleanup of expired (`410 Gone`) subscriptions.

---

## Security

- **Authentication**: Secure `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` (production) session cookies signed with high-entropy JWTs.
- **Password Hashing**: Passwords stored using `bcrypt` with cost factor 12 and dummy-hash timing mitigation against enumeration attacks.
- **CSRF Defense**: Mutating REST endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) require `Origin === APP_ORIGIN`.
- **WebSocket Boundary**: Production Socket.IO handshakes enforce strict `APP_ORIGIN` matching.
- **Rate Limiting**:
  - Global API: 300 req / 15 min
  - Authentication: 10 attempts / 15 min
  - Sensitive Mutations (payments, settlements, settings, push): 60 req / 15 min
- **Observability & Redaction**:
  - Every request tagged with unique `X-Request-ID`.
  - Machine-readable NDJSON logs in production.
  - Centralized recursive sanitizer redacts passwords, tokens, auth headers, cookies, VAPID keys, and MongoDB connection strings.
- **Security Headers**: Managed by Helmet: Strict CSP, HSTS (`max-age=31536000`), Permissions-Policy, X-Content-Type-Options (`nosniff`), and disabled `X-Powered-By`.

---

## Development Environment

MealKhata requires **Node.js 24 LTS** (`>=24.19.0 <25`) and npm workspaces.

### Quickstart
```bash
# 1. Install dependencies across workspaces
npm install

# 2. Setup local backend configuration
copy backend\.env.example backend\.env

# 3. Generate password hashes for Admin and Super Admin
npm run hash-password

# 4. Bootstrap Member accounts in MongoDB
npm run seed-members

# 5. Start concurrent development servers
npm run dev
```

- Frontend Dev Server: `http://localhost:5173`
- Backend API Server: `http://localhost:5000`
- API Health Check: `http://localhost:5000/api/health`
- API Readiness Check: `http://localhost:5000/api/ready`

---

## Operations & Tooling

MealKhata includes non-destructive operational and maintenance scripts:

| Command | Purpose |
| :--- | :--- |
| `npm run release:check` | Orchestrates all release gates: lint, tests, build, dual-mode verification, security audit, and performance baseline. |
| `npm run perf:check` | Benchmarks representative read endpoints against a local test dataset, enforcing a p95 $< 250\text{ ms}$ threshold. |
| `npm run release:smoke` | Performs a credential-free read-only smoke test against a running deployment target. |
| `npm run security:check` | Static analysis for dangerous patterns, credential leaks, and high-severity npm audit vulnerabilities. |
| `npm run verify-indexes` | Non-destructive audit comparing live MongoDB indexes against Mongoose schemas. |
| `npm run verify-data` | Non-destructive read-only audit validating 12 domain invariants across all collections. |
| `npm run db:backup` | Generates a compressed, AES-256-GCM encrypted backup archive preserving BSON Extended JSON. |
| `npm run db:backup:verify -- <file>` | Decrypts and verifies backup archive manifest, GCM auth tag, and SHA-256 payload checksum. |
| `npm run db:restore -- <file>` | Restores a verified backup to a designated target database (`RESTORE_MONGODB_URI`). |

---

## Production Deployment Architecture

MealKhata uses a decoupled production deployment:
- **Frontend / PWA**: Hosted on **Vercel** (`https://<vercel-domain>`)
- **Backend API & Realtime**: Hosted on **Render** Web Service (`https://meal-khata-api.onrender.com`)
- **Database**: **MongoDB Atlas**
- **Browser REST Traffic**: Calls relative `/api/*`, transparently reverse-proxied by Vercel to Render, preserving secure same-origin `HttpOnly`, `Secure`, `SameSite=Lax` cookie authentication.
- **Realtime Updates**: Socket.IO connects directly from the browser to Render (`VITE_SOCKET_URL`) with strict `APP_ORIGIN` CORS enforcement.

Users interact directly with the canonical frontend URL on Vercel:
- **Frontend / PWA**: `https://<vercel-domain>`
- **Backend API**: `https://meal-khata-api.onrender.com`

### Vercel Project Settings (Frontend)
- **Framework Preset**: Vite
- **Root Directory**: Repository root
- **Install Command**: `npm ci`
- **Build Command**: `npm run build --workspace frontend`
- **Output Directory**: `frontend/dist`
- **Configuration**: Root [`vercel.json`](./vercel.json) handles `/api/*` rewrites to Render and SPA deep-link routing to `/index.html`.
- **Environment Variables**:
  - `VITE_SOCKET_URL=https://meal-khata-api.onrender.com`

### Render Web Service Settings (Backend)
Configured via [`render.yaml`](./render.yaml):
- **Service Name**: `meal-khata-api`
- **Runtime**: Node 24.x
- **Build Command**: `npm ci --omit=dev`
- **Start Command**: `npm run start --workspace backend`
- **Health Check Path**: `/api/ready`

#### Required Backend Environment Variables
- `NODE_ENV=production`
- `APP_TIMEZONE=Asia/Kolkata`
- `MONGODB_URI=mongodb+srv://...`
- `AUTH_JWT_SECRET=<min-48-bytes-high-entropy-secret>`
- `APP_ORIGIN=https://<your-vercel-domain>.vercel.app`

#### Optional Web Push Variables (Render)
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT=mailto:admin@your-domain.com`

If background push is enabled, deploy the 5-minute cron runner via [`render.push.yaml`](./render.push.yaml).

---

## Documentation

- **Security Policy & Credential Rotation**: [`SECURITY.md`](./SECURITY.md)
- **Production Operations Runbook**: [`docs/PRODUCTION_RUNBOOK.md`](./docs/PRODUCTION_RUNBOOK.md)
- **Backup & Disaster Recovery Runbook**: [`docs/BACKUP_AND_RECOVERY.md`](./docs/BACKUP_AND_RECOVERY.md)
- **Release Checklist**: [`docs/RELEASE_CHECKLIST.md`](./docs/RELEASE_CHECKLIST.md)
- **v1.0.0 Release Notes**: [`docs/RELEASE_NOTES_v1.0.0.md`](./docs/RELEASE_NOTES_v1.0.0.md)
- **Changelog**: [`CHANGELOG.md`](./CHANGELOG.md)