# MealKhata

Meals tracked. Bills sorted.

MealKhata is a private, mobile-first meal and shared-bill utility for Gaurav, Nikhil, and Devansh.

It provides:

- daily Morning/Night meal tracking with a default Taking schedule
- a monthly calendar and person-wise bills
- configurable UPI payment preparation and an immutable manual-payment ledger
- Viewer, shared Admin, and Super Admin roles
- real-time synchronization across open clients
- lightweight in-app and opt-in browser reminders
- explicit Morning, Night, and daily plate totals derived from Taking/Skip status

## Stack

- React + Vite frontend
- Express + Node.js backend
- MongoDB/Mongoose persistence
- Socket.IO synchronization
- one Render Web Service serving the React build, API, and Socket.IO endpoint

## Development

MealKhata is tested with Node.js 24.19 and pins the Node 24 LTS line through `.node-version` and `package.json`.

```bash
npm install
copy backend\.env.example backend\.env
npm run hash-password
npm run dev
```

Add a valid `MONGODB_URI` and the authentication values from `backend/.env.example` before starting the backend. Run `npm run hash-password` once for the Admin password and again for the Super Admin password, then place only the resulting cost-12 hashes in `backend/.env`.

Generate a unique JWT secret locally and copy the output to `AUTH_JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use `APP_ORIGIN=http://localhost:5173` locally. Set it to the exact HTTPS service origin in production. Never commit `backend/.env`.

Frontend: `http://localhost:5173`  
Backend health: `http://localhost:5000/api/health`
Backend readiness: `http://localhost:5000/api/ready`

## Commands

```bash
npm run dev
npm run lint
npm test
npm run build
npm start
```

## Roles & Identity (Phase 7)

MealKhata supports four distinct roles:
1. **Viewer**: Public view-only access to household dashboard, calendar, reports, and payments. Cannot edit meals or payments.
2. **Member**: Individual household accounts for Gaurav (`gaurav`), Nikhil (`nikhil`), and Devansh (`devansh`).
   - Log in with individual email and password.
   - Directly edit **their own** Morning and Night meals for today from the home dashboard.
   - Initiate and record **their own** payments from the Payments page.
   - Cannot edit other members' meals or payments (enforced with 403 on backend).
   - Cannot edit past or future meal dates.
   - Cannot access the `/admin` panel or modify rates/settings.
3. **Admin**: Household management interface for editing today's meals for any roommate and managing payments. Cannot edit past/future dates or administrative settings.
4. **Super Admin**: Full administrative authority, including past/future meal date edits, monthly billing rates, payment receiver settings, reminder schedules, and payment voids.

### Identity-Aware Audit History
All meal updates and payment confirmations capture the authenticated actor's identity:
- For Member actions: `actorRole: "member"` and `actorMemberId` (e.g. `"gaurav"`).
- For Admin actions: `actorRole: "admin"` and `actorMemberId: null`.
- For Super Admin actions: `actorRole: "superadmin"` and `actorMemberId: null`.
- *Backward compatibility note:* Legacy records created before Phase 7 identify only the previous `admin` role with no `actorMemberId` and remain valid.

All authorization is server-authoritative; client requests cannot declare or tamper with actor identity.

### Member Account Bootstrap / Seeding
Member accounts are stored in MongoDB and initialized using an idempotent bootstrap script. Set placeholder environment variables in `backend/.env` for each member:
- `MEMBER_GAURAV_EMAIL` and `MEMBER_GAURAV_PASSWORD_HASH`
- `MEMBER_NIKHIL_EMAIL` and `MEMBER_NIKHIL_PASSWORD_HASH`
- `MEMBER_DEVANSH_EMAIL` and `MEMBER_DEVANSH_PASSWORD_HASH`

Then run:
```bash
npm run seed-members
```
Password hashes must be generated with bcrypt cost 12 using `npm run hash-password`. Seeding is safe to run multiple times. Once seeded in MongoDB, member authentication does not depend on the seeding environment variables.

## Daily meal API

- `GET /api/meals/today` — public, using the backend `Asia/Kolkata` date
- `GET /api/meals/:date` — public, with virtual all-Taking defaults for untouched dates
- `PATCH /api/meals/:date` — authenticated; Admin can edit today, Super Admin can edit any valid date
- `GET /api/meals/:date/history` — Admin or Super Admin, newest changes first
- `GET /api/calendar/:month` — public month schedule assembled with one bulk meal query
- `GET /api/reports/monthly/:month` — public derived counts, current totals, and projections
- `GET /api/billing/rates/:month` — public monthly Morning/Night rates
- `PUT /api/billing/rates/:month` — Super Admin-only rate update
- `GET /api/payments/summary/:month` — public derived bill, paid, remaining, and status values
- `GET /api/payments/history/:month` — public sanitized recorded/voided ledger history
- `POST /api/payments/prepare` — Admin/Super Admin preparation from month/member; the server derives the exact remaining amount and creates no payment
- `POST /api/payments` — Admin/Super Admin manual confirmation with UUID idempotency
- `POST /api/payments/:paymentId/void` — Super Admin-only correction that preserves history
- `GET /api/payment-settings` — authenticated receiver details
- `PUT /api/payment-settings` — Super Admin-only singleton receiver configuration
- `GET /api/settings/reminders` — public, safe Morning/Night reminder schedule
- `PUT /api/settings/reminders` — Super Admin-only schedule update
- `GET /api/health` — lightweight process liveness
- `GET /api/ready` — database-backed readiness

REST is the only mutation path. After persisted changes, Socket.IO broadcasts small sanitized synchronization events. Clients refetch after reconnect because MongoDB remains authoritative.

Meal prices are stored and calculated as integer paise. Current-month payable totals include dates through backend India today; projections include the complete calendar month. Reports are calculated from MealDay plus MonthlyMealRate and are never stored as duplicate bill documents.

Payments are also stored as integer paise, one immutable ledger entry per user-confirmed transfer. Monthly payment status is derived from the authoritative monthly bill minus non-voided ledger entries—not stored as a permanent `paid` boolean—so later meal or rate corrections automatically produce Partial or Overpaid states. Mistakes are voided rather than deleted.

A `upi://pay` deep link is generated only when a verified UPI ID is configured. If only an Indian mobile number is configured, MealKhata displays the normalized mobile and exact server-derived amount with copy actions; it never fabricates a VPA. Opening a payment app cannot prove that a bank transfer succeeded. The user must return and choose “Yes, payment done”; “Not yet” creates no ledger entry. These records are user-confirmed, not bank-verified.

One Taking status represents exactly one plate for the current product model. Morning, Night, and daily plate totals are derived from effective meal state and are never stored as duplicate database fields.

Reminder banners use Asia/Kolkata time and remain visible for 60 minutes after each configured time. Browser notifications are requested only after the user selects **Enable**. They are device-local, deduplicated per meal/day, and only guaranteed while MealKhata remains open; there is no push service or background delivery.

## Production environment

Configure these names through Render environment settings—never in Git:

```text
NODE_ENV
PORT
MONGODB_URI
APP_TIMEZONE
ADMIN_EMAIL
ADMIN_PASSWORD_HASH
SUPERADMIN_EMAIL
SUPERADMIN_PASSWORD_HASH
AUTH_JWT_SECRET
APP_ORIGIN
```

Use `NODE_ENV=production`, `APP_TIMEZONE=Asia/Kolkata`, and set `APP_ORIGIN` to the exact HTTPS origin assigned to the deployed service. Both password hashes must use bcrypt cost 12, and the production JWT secret must contain at least 48 bytes.

## Render deployment

MealKhata deploys as one Node Web Service using [render.yaml](./render.yaml):

- build: `npm ci --include=dev && npm run build`
- start: `npm start`
- health check: `/api/ready`

Configure a secured MongoDB Atlas user and an Atlas network-access rule that permits the Render service. Deploy only after local production startup and real MongoDB persistence have been verified.

On Render's free Web Service plan, cold starts and spin-down can temporarily interrupt availability and live Socket.IO connections. Realtime resumes while the service is running, and reconnecting clients refetch authoritative state.

## Phase 9: Background Web Push Reminders

MealKhata includes background Web Push reminders allowing household members (`gaurav`, `nikhil`, `devansh`) to opt in to Morning and Night meal reminders per device. Notifications arrive even when MealKhata is closed, the PWA is minimized, or browser tabs are shut.

### How It Works

```
Super Admin Reminder Settings (09:00 / 20:00 Asia/Kolkata)
                        │
                        ▼
            Scheduled Reminder Runner
                        │
      ├──── Is reminder enabled globally?
      ├──── Is it due within the dispatch window?
      ├──── Is the member Taking? (Skips suppressed)
      ├──── Does device have active PushSubscription?
      ├──── Is period enabled in device preferences?
      └──── Was it already sent today? (Atomic deduplication)
                        │
                        ▼
               Web Push via VAPID
                        │
                        ▼
             Service Worker push event
                        │
                        ▼
            System Notification Alert
                        │
                        ▼
        Click focuses or re-opens MealKhata
```

### Key Features & Design Rules

1. **Member-Only Push Subscriptions**: Personal meal reminders belong exclusively to authenticated household member accounts. Viewer, Admin, and Super Admin roles cannot register personal member push devices. Push APIs strictly derive identity from `req.auth.memberId` on the server and ignore any client-supplied member IDs.
2. **Meal-Aware Smart Dispatch**: At reminder time, the runner evaluates the member's authoritative effective meal schedule for today. If the member is `taking` (or untouched, which defaults to `taking`), the reminder is sent. If the member has explicitly set `skip`, the reminder is suppressed.
3. **Per-Device Preferences**: Each device supports toggling Morning and Night reminders independently without altering the global household schedule managed by Super Admin.
4. **Atomic Server Deduplication**: Keyed on `${logicalDate}:${mealType}:${subscriptionId}` via a unique index on `PushDelivery`. Running the runner repeatedly (e.g. every 5 minutes) produces exactly one notification per eligible device.
5. **Privacy by Design**: Notification payloads contain only minimal text and same-origin deep links (`/?meal=morning` or `/?meal=night`). Never any JWT tokens, passwords, bills, UPI IDs, or financial data.
6. **No Direct Mutation from Push**: Notifications only offer safe navigation back into MealKhata. No direct state mutations occur in the background from notification actions.
7. **Automatic Expired Subscription Cleanup**: Push provider responses of `410 Gone` or `404 Not Found` automatically deactivate the subscription record without manual admin intervention.
8. **Account Switch Safety**: When another account logs into a previously subscribed device, the device status returns a neutral state indicating it belongs to another account without revealing the prior user's identity. Explicit re-registration safely reassigns the endpoint to the active member.

### Web Push Configuration (Optional)

Web Push is strictly **OPTIONAL**. MealKhata itself does **NOT** require VAPID keys to run, start, log in, track meals, calculate bills, manage payments, close months, or export statements. In-app reminders and local browser notifications continue working normally without VAPID keys.

- **All absent**: Background Web Push is disabled; MealKhata runs normally.
- **All present**: Background Web Push is enabled.
- **Partially configured**: Throws a configuration error to prevent deployment misconfigurations.

To generate VAPID keys if you wish to enable background push reminders:

```bash
npm run generate-vapid-keys
```

Add these to `backend/.env` (and Render Web Service environment settings):

```bash
# Optional: only required for background Web Push reminders
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:you@example.com
```

### Scheduled Reminder Runner & Deployment

Background reminders require a scheduled trigger independent of the web process. In-process `setInterval` is strictly avoided in production.

- **Command**: `npm run send-push-reminders`
- **Recommended Schedule**: Every 5 minutes (`*/5 * * * *`)
- **Timezone**: Evaluated dynamically using `APP_TIMEZONE` (`Asia/Kolkata`) against database settings.

Deployment ergonomics:
- **Core MealKhata**: Deploy using [render.yaml](./render.yaml), which provisions the core Web Service only without requiring VAPID or background cron jobs.
- **Optional Push Cron**: If background push is configured, provision the cron runner using [render.push.yaml](./render.push.yaml) with schedule `"*/5 * * * *"`.

---

## Monthly Settlement & Month Closing (Phase 10)

MealKhata provides an authoritative accounting closure layer that freezes past months into immutable, auditable financial snapshots.

### 1. Live vs. Closed Accounting
- **Open Months**: Meal counts, rates, bills, and balances are calculated dynamically from `MealDay`, `MonthlyMealRate`, and the `Payment` ledger.
- **Closed Months**: Super Admin explicitly closes a completed past month once all members are fully settled. The resulting **Settlement Snapshot** is permanently frozen and immutable. All reports, displays, and exports for closed months consume this frozen snapshot.

### 2. Close Eligibility Rules
A month can be closed only when:
1. The month is a completed **past calendar month** in Asia/Kolkata (current and future months cannot be closed).
2. Meal rates are configured for that month.
3. Every member is **exactly settled**:
   $$\text{billAmountPaise} = \text{paidAmountPaise} \implies \text{remaining} = 0 \text{ and } \text{overpaid} = 0$$
4. Overpayments are blocked: any overpayment must be corrected via payment void before closing. Members with genuine zero bill and zero paid are considered settled.
5. Only **Super Admin** has permission to close or reopen a month.

### 3. Closed-Month Mutation Locks
Once a month is closed, the backend rejects all mutations affecting that month with `409 Conflict`:
- Meal edits (`PATCH /api/meals/:date` for dates in the closed month)
- Meal rate updates (`PUT /api/billing/rates/:month`)
- Payment preparation (`POST /api/payments/prepare`)
- Payment recordings (`POST /api/payments`)
- Payment voids (`POST /api/payments/:paymentId/void`)

Operations for current and future months continue normally.

### 4. Reopening & Historical Versioning
If a historical error is discovered:
1. Super Admin reopens the month via `POST /api/settlements/:month/reopen`, providing a required audit reason (e.g. *"Incorrect night meal entry on 18 Sep"*).
2. The existing settlement record is preserved in history with status `reopened`.
3. Meals, rates, and payments are unlocked for corrections.
4. Once exact settlement is reached again, Super Admin re-closes the month.
5. A new settlement sequence is generated (e.g. Settlement #2 Active), preserving Settlement #1 in the audit history.

### 5. Downloadable Statement Exports
Authenticated household users (Members, Admins, Super Admin) can download official settlement statements for any closed month:
- **PDF Statement** (`GET /api/settlements/:month/statement.pdf`): Professional, server-rendered A4 document formatted with approved rates, person-wise meal counts, bills, payments, room totals, and a financial confirmation notice.
- **CSV Export** (`GET /api/settlements/:month/statement.csv`): RFC-compliant comma-separated values with integer paise precision and properly escaped fields.

Statement downloads are served with `Cache-Control: no-store` under `/api/`, bypassing PWA service-worker caching to ensure privacy and security.

---

## Personalized Daily Dashboard & Role-Aware Experience (Phase 11)

Phase 11 transforms MealKhata from a functionally complete system into a polished, role-aware daily product where every identity immediately sees and accesses what matters to them.

### 1. Unified Composition Endpoint: `GET /api/dashboard`
To prevent the client from executing cascading independent requests (`/api/meals/today`, `/api/reports/...`, `/api/payments/...`, `/api/settlements/...`, `/api/settings/reminders`), the backend exposes a cached-free composition endpoint:
- **Route**: `GET /api/dashboard` (and alias `GET /api/dashboard/summary`)
- **Headers**: `Cache-Control: no-store` (Network Only, never cached by service workers)
- **Role Authority**: Session identity (`req.auth`) authoritatively dictates the derived payload; query parameters cannot spoof member identity.
- **Parallel Composition**: Invokes existing domain services (`mealService`, `reportService`, `paymentSummaryService`, `settlementService`, `reminderSettingsService`) in parallel using `Promise.allSettled`. If an optional service fails, the remaining dashboard renders gracefully without fabricating data.
- **Zero New Collections**: All dashboard data is derived on-the-fly; no `Dashboard` or `DashboardCache` MongoDB collections exist.

### 2. Role-Aware Dashboard Profiles
- **Member Profile** (Personalized Home):
  - **Authoritative India Greeting**: "Good morning", "Good afternoon", or "Good evening" calculated strictly using `Asia/Kolkata` logical hour.
  - **Your Meals Today Hero**: Direct Taking/Skip segmented controls for Morning and Night meals with instant optimistic feedback and server validation.
  - **Household Today Card**: Kitchen plate requirements (e.g. "Morning 3 plates · Night 2 plates") and roommate statuses.
  - **Your Month-to-Date Card**: Personal meal counts (Morning, Night, Total), authoritative bill to-date, total paid, remaining due, projected month-end bill, and direct payment CTA link.
  - **Next Meal Reminder**: Upcoming meal window and device reminder status (in-app active or Web Push enabled).
  - **Role-Aware Quick Actions**: Direct navigation to Calendar, Reports, and Payments with current month query parameter.
- **Admin Profile** (Household Manager):
  - Household Today plate counts and roommate breakdown.
  - One-tap **Manage Today's Meals** operational shortcut.
  - Household month-to-date financial summary (room plates, total bill, rates status).
  - Shortcuts to Reports, Payments, and Calendar.
- **Super Admin Profile** (Operational Attention & Control):
  - Household plate totals and roommate status overview.
  - **Attention Section**: Prioritized deterministic alerts:
    - *Configuration blockers*: Current month meal rates not configured.
    - *Settlement readiness*: Previous month is fully settled and ready to close.
    - *Settlement blockers*: Previous month cannot close due to outstanding balances or overpayments.
  - Quick management shortcuts: Manage Meals, Configure Rates, Payments, Monthly Settlement, and Reminder Settings.
- **Viewer Profile** (Public Guest):
  - Read-only daily meal schedule and household plate counts.
  - Shortcuts to public Calendar, Reports, and Payments pages with zero mutation controls.

### 3. Product-Wide UX Polish & Quality Improvements
- **Deep Query Navigation**: `/reports`, `/payments`, and `/calendar` support validated `?month=YYYY-MM` search parameters for seamless cross-page month linking with safe fallbacks on invalid input.
- **Document Titles**: Integrated lightweight `useDocumentTitle` updating the browser tab (`MealKhata — Dashboard`, `MealKhata — Calendar`, etc.).
- **Account Identity Badge**: Desktop header displays member avatar with initial, display name, and role badge without crowding mobile headers.
- **320px Viewport Hardening**: Compact responsive layouts with wrap-safe badges, touch-target compliance, and zero horizontal document scrolling across all mobile screen sizes.
- **Accessibility & Motion**: WCAG-compliant color contrast, icon + text state indicators, full keyboard/focus compliance, and `prefers-reduced-motion` compliance.

---

## Production Operations, Security & Reliability (Phase 12)

MealKhata includes production hardening, operational observability, data integrity verification, and disaster recovery tooling.

### 1. Observability & Logging Architecture
- **Request Correlation**: All incoming requests receive an `X-Request-ID` header generated via `crypto.randomUUID()` (or validated client correlation token) correlated through request completion, error handling, and client responses.
- **Structured JSON Logging**: In production, logs output single-line JSON format with timestamps, severity levels, request IDs, and event names.
- **Centralized Redaction**: `backend/src/utils/sanitizer.js` automatically and recursively scrubs passwords, hashes, tokens, auth headers, cookies, JWTs, VAPID private keys, and MongoDB URIs from all log outputs.
- **Performance Tracking**: API latency is recorded on response completion; requests taking $\ge 1000\text{ ms}$ automatically emit structured `request.slow` warnings.
- **Error Boundaries**: Unhandled 5xx errors log request references and safe error names, returning `{ success: false, message: "Something went wrong", requestId }` without exposing stack traces to clients. Malformed JSON returns `400 Bad Request`.

### 2. Server Lifecycle & Graceful Shutdown
- **Lifecycle States**: The server implements an explicit state machine: `starting` $\to$ `ready` $\to$ `draining` $\to$ `stopped`.
- **Draining State**: Upon receiving `SIGTERM` or `SIGINT`, the server transitions to `draining`. The readiness endpoint (`GET /api/ready`) immediately returns `503 Service Unavailable`, signaling reverse proxies (Render) to cease routing new traffic.
- **Bounded Graceful Shutdown**: HTTP listener closes, Socket.IO clients disconnect, and MongoDB disconnects with a bounded 15-second timeout guard preventing hung processes.
- **Process Failure Handling**: Global listeners for `uncaughtException` and `unhandledRejection` log sanitized fatal events, initiate graceful shutdown, and exit non-zero.

### 3. Operational & Verification Commands

| Command | Description |
| :--- | :--- |
| `npm run security:check` | Orchestrates static pattern analysis, secret leak scans, and dependency vulnerability audits. |
| `npm run verify-indexes` | Verifies that all expected Mongoose schema indexes are present in MongoDB without dropping or altering production indexes. |
| `npm run verify-data` | Runs read-only consistency checks across all collections (meal statuses, dates, positive paise, settlement sums). |
| `npm run db:backup` | Generates a compressed, AES-256-GCM encrypted backup archive preserving BSON Extended JSON types. |
| `npm run db:backup:verify -- <file>` | Verifies backup archive decryption, SHA-256 checksum, manifest schema, and collection record counts. |
| `npm run db:restore -- <file>` | Restores a verified backup to a target database (`RESTORE_MONGODB_URI`) with production overwrite guards. |

### 4. Operational Documentation
- **Security Policy & Secret Rotation**: [SECURITY.md](./SECURITY.md)
- **Production Operations & Troubleshooting**: [docs/PRODUCTION_RUNBOOK.md](./docs/PRODUCTION_RUNBOOK.md)
- **Backup & Disaster Recovery Guide**: [docs/BACKUP_AND_RECOVERY.md](./docs/BACKUP_AND_RECOVERY.md)


