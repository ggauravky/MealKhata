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