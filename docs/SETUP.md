# MealKhata setup and release

MealKhata starts from an empty database. The owner runs **one** command once to create
the only Super Admin. Everything after that happens in the website.

## What the one-time setup does

`npm run setup:admin` connects to the database in `backend/.env` (`MONGODB_URI`) and, in a
single MongoDB transaction:

- creates the **Super Admin** account (bcrypt cost 12 password hash),
- creates the **system settings** (financial start date, timezone `Asia/Kolkata`),
- writes the `app_initialization` record and an audit entry,
- creates all required indexes.

It never creates students, meals, rooms, stays, payments or expenses.

It refuses to run if the database is already set up, if a Super Admin exists, or if the
database already contains accounts or students. A unique index allows only one Super Admin
ever, so repeated or concurrent runs cannot create a second one. If the command is
interrupted, the transaction rolls back and it can simply be run again.

There is no web page or API that creates a Super Admin. Normal server startup only
creates indexes and reports whether setup has happened; it never creates an account.

## Owner steps (production)

1. Deploy the backend (Render) and frontend (Vercel) from `main` — see *Release steps*.
   Until setup runs, `/api/health` is `200`, `/api/ready` is `503`, the login page says
   setup is pending, and every write is refused with `SETUP_REQUIRED`.
2. On your computer, with `backend/.env` containing the Atlas `MONGODB_URI` (ending in
   `/mealkhata`), run:

   ```bash
   npm run setup:admin -- --email superadminmealkhata@gmail.com --start-date 2026-11-01
   ```

   The command shows the database name and host, asks you to type `SETUP`, then asks for
   the password twice (hidden). Use 12+ characters with upper, lower, number and symbol.
   Nothing is printed or stored except the password hash in the database.
3. Open the website and sign in. `/api/ready` now returns `200`.

## Forgotten Super Admin password

Only someone with the database credentials can recover the Super Admin. On your computer,
with the same `backend/.env`:

```bash
npm run setup:admin -- --reset-password --email superadminmealkhata@gmail.com
```

Type `RESET`, then enter the new password twice. Every existing Super Admin session is
signed out and the change is audited. There is no "forgot password" link on the website,
so nobody can take over the account from the internet.

## After setup (all in the web app)

| Task | Where |
| --- | --- |
| Add / edit / archive students, set "Meals start on" | Admin → Member management |
| Create a student login, reset it, disable it | Member management → student card |
| Add / disable administrators, reset their passwords | Settings & access (Super Admin) |
| Change your own password (any role) | Account menu → Change password |
| Financial start date (only before anything is recorded) | Settings & access |
| Meals, plate sharing, per-day price overrides | Mess admin panel |
| Rooms, fee plans, monthly charges, room payments | Room fee admin |
| Stays, deposits, transfers, checkout and refunds | Manage Hostel Stays |
| Shared expenses and reimbursements | Expense admin |
| Mess payments, month close/reopen, reports | Payments, Reports |

Every account and settings change asks for your current password, signs the affected
person out everywhere, and is recorded in the account audit log.

Default meal prices are ₹50 (morning) and ₹70 (night). A different price for a specific
day is set with the per-day price override on the Mess admin panel.

## Release steps (after the branch is approved)

1. Merge the development branch into `main`.
2. **Render** (`meal-khata-api`):
   - Health check path: `/api/health`.
   - Keep: `NODE_ENV=production`, `APP_TIMEZONE=Asia/Kolkata`, `MONGODB_URI` (must end in
     `/mealkhata`), `AUTH_JWT_SECRET` (48+ bytes), `APP_ORIGIN=https://mealkhata-by-gaurav.vercel.app`,
     optional `VAPID_*`.
   - Remove: `MEALKHATA_RUNTIME_PROFILE`, `CANONICAL_ONLY_AUTH`, `V3_RELEASE_*`,
     `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD_HASH`.
     They are no longer read.
   - Deploy the `main` commit manually (auto-deploy is off).
3. **Vercel**: keep `MEALKHATA_BACKEND_ORIGIN`, `MEALKHATA_BACKEND_ENV=production` and
   `VITE_SOCKET_URL` (= backend origin); `VITE_RUNTIME_PROFILE` is no longer needed. Redeploy.
4. Check `https://meal-khata-api.onrender.com/api/health` → `200` and `/api/ready` → `503`
   with `"initialized": false`.
5. Run the owner setup command above once.
6. Check `/api/ready` → `200`, then sign in at https://mealkhata-by-gaurav.vercel.app,
   add the first student, and record a meal.

## Local development and tests

- Never point a development `backend/.env` at the production database.
- `npm run e2e:browser` starts a disposable replica set, runs the same setup function, then
  drives the full flow in Chromium. Set `E2E_SKIP_SETUP=true` with
  `node backend/scripts/startIsolatedE2E.js` to see the pre-setup state.
- `npm test`, `npm run lint`, `npm run build`, `npm run verify-production-build`,
  `npm run security:check`, `npm run perf:check`.
