# MealKhata Production Runbook

This document serves as the operational guide for deploying, maintaining, monitoring, and troubleshooting the MealKhata production environment on Render with MongoDB.

---

## 1. Architecture & Core Boundaries

- **Hosting**: Render Web Service (Node.js runtime) running Express, serving static Vite assets, REST API, and Socket.IO.
- **Database**: MongoDB (Atlas or self-hosted) accessed through Mongoose.
- **Port**: Bound to `PORT` environment variable (`5000` by default).
- **Timezone**: Strict business timezone `Asia/Kolkata` for all daily rollover, reminders, greetings, and monthly accounting.
- **Proxy Configuration**: `trust proxy = 1` matching Render's single-hop ingress.
- **Client Protocol**: HTTPS only with HSTS enabled in production (`max-age=31536000`).

---

## 2. Health & Readiness Monitoring

MealKhata implements decoupled liveness and readiness probes:

### A. Liveness Probe (`GET /api/health`)
- **Purpose**: Verifies that the Node.js process is alive, listening, and responsive.
- **External Uptime URL**: Use this endpoint for third-party pingers (e.g. UptimeRobot, BetterUptime).
- **Expected Status**: `200 OK`
- **Response Format**:
  ```json
  {
    "success": true,
    "service": "MealKhata",
    "status": "ok",
    "uptimeSeconds": 1420
  }
  ```
- **Security**: Contains zero secrets, database connection strings, or system paths.

### B. Readiness Probe (`GET /api/ready`)
- **Purpose**: Verified by Render to determine whether the container can accept production traffic.
- **Evaluation Criteria**:
  1. Server is **not draining** (`LIFECYCLE_STATES.READY`).
  2. MongoDB is reachable (bounded ping check with 2,000ms timeout).
- **Expected Status**:
  - `200 OK` (`{"success": true, "status": "ready"}`) when healthy.
  - `503 Service Unavailable` (`{"success": false, "status": "draining"}`) during shutdown.
  - `503 Service Unavailable` (`{"success": false, "status": "unavailable"}`) if MongoDB disconnects.

---

## 3. Deployment & Release Verification Checklist

After deploying a new commit to Render, run through this checklist:

1. **Build Step**:
   - Check Render deployment logs: `npm ci --include=dev && npm run build` must complete without errors.
   - Verify frontend assets were written to `frontend/dist/`.
2. **Startup & Readiness**:
   - Verify log event: `server.started {"port": 5000}`.
   - Confirm Render reports successful health check on `/api/ready`.
3. **Smoke Verification**:
   - Open browser or PWA in standalone mode at `APP_ORIGIN`.
   - Confirm home dashboard renders with live India greeting ("Good morning", "Good evening").
   - Test login with a member account (e.g. `gaurav`).
   - Confirm meal Taking/Skip toggle works with immediate visual update.
   - Log out and verify clean cookie clearing.

---

## 4. Incident Response & Troubleshooting

### Incident A: Server Returns 503 / Render Reports Instance Unhealthy
1. Check Render service logs for database connection errors (`database.disconnected` or `database.error`).
2. Verify MongoDB Atlas network access allowlist (ensure Render egress IP or `0.0.0.0/0` with strong password is configured).
3. Check if server entered draining state (`server.shutdown.started`).
4. **Action**: If MongoDB is unreachable, resolve network/credential issues on Atlas. Do **NOT** delete or recreate collections.

### Incident B: Login Fails with 401 Across All Accounts
1. Confirm client is sending requests to the exact configured `APP_ORIGIN` (trusted origin check).
2. Check if `AUTH_JWT_SECRET` was recently regenerated or mismatched.
3. Test login with Super Admin credentials.
4. Verify user password against bcrypt hash locally using:
   ```bash
   node scripts/hashPassword.js
   ```

### Incident C: Member Reports Inaccurate Meal or Payment Entry
1. **Never edit MongoDB payment documents directly**.
2. **If payment was recorded with wrong amount**:
   - Super Admin must log in and navigate to `/payments`.
   - Click **Void** on the erroneous payment entry, entering a descriptive audit reason (e.g. *"Wrong amount entered by roommate"*).
   - Once voided, record the corrected payment entry. The voided transaction remains permanently visible in the audit ledger for financial traceability.
3. **If meal was misrecorded on a previous date**:
   - If the month is still open: Super Admin navigates to `/admin?date=YYYY-MM-DD` and corrects the entry.
   - If the month is already closed: see Incident D below.

### Incident D: Discovered Historical Error in a Closed Month
1. Super Admin navigates to `/reports?month=YYYY-MM`.
2. Click **Reopen Settlement**, providing an explicit audit reason (e.g. *"Missing night meal entry for Nikhil on 15 Sep"*).
3. Once reopened:
   - Edit the necessary meals or payments for that month.
   - Ensure all roommates reach exact settlement again (`billAmount === paidAmount`, `remaining === 0`).
4. Click **Close Month & Lock Statements** to generate a new active settlement snapshot (e.g. Settlement #2 Active).
5. Download updated PDF/CSV statement.

### Incident E: PWA Shows Outdated App Shell or Fails to Update
1. Service Worker automatically detects new bundles via `ETag` / `Cache-Control: no-cache` on `sw.js`.
2. When an update is detected, an in-app banner appears: *"App update ready [Reload]"*.
3. Clicking reload triggers `SKIP_WAITING` and controller change reloading.
4. To force clear on a mobile device: Settings > Safari / Chrome > Clear Website Data for `mealkhata.local` or reinstall the PWA.

---

## 5. Security & Audit Operations

Run the automated operational checks:

```bash
# Full security analysis (static checks, secret patterns, high npm audit)
npm run security:check

# Verify database indexes without mutating
npm run verify-indexes

# Run read-only consistency audit across all collections
npm run verify-data
```
