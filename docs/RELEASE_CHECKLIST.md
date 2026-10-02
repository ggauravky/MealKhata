# MealKhata v1.0.0 Release Checklist

This checklist must be executed prior to and following any production deployment of MealKhata v1.0.0.

---

## 1. Code & Quality Gates
- [ ] Working tree is clean: `git status` shows zero uncommitted modifications or untracked temporary files.
- [ ] Code formatting and linting pass with zero warnings: `npm run lint`.
- [ ] All automated tests pass: `npm test` (312+ tests passing, 0 failed).
- [ ] Production frontend build compiles successfully: `npm run build`.
- [ ] Dual-mode build verification passes: `npm run verify-production-build`.
- [ ] Performance benchmark passes within budget: `npm run perf:check` (p95 $< 250\text{ ms}$).
- [ ] Unified release verification passes: `npm run release:check`.

---

## 2. Security & Credentials
- [ ] Security audit passes: `npm run security:check`.
- [ ] Zero hardcoded production secrets, API tokens, or MongoDB URIs exist in tracked files.
- [ ] Production dependencies have zero high or critical advisories: `npm audit --omit=dev --audit-level=high`.
- [ ] Built frontend (`frontend/dist`) contains zero references to `AUTH_JWT_SECRET`, database URIs, or password hashes.
- [ ] `AUTH_JWT_SECRET` meets minimum production length requirement (min 48 bytes base64url).
- [ ] Admin and Super Admin passwords use bcrypt cost factor 12 hashes.

---

## 3. Database & Member Accounts
- [ ] Target MongoDB cluster is active and reachable with network whitelist permitting the application server.
- [ ] Member accounts exist in MongoDB (`gaurav`, `nikhil`, `devansh`) with active status and valid password hashes.
- [ ] Database indexes verified non-destructively: `npm run verify-indexes`.
- [ ] Database data integrity verified non-destructively: `npm run verify-data`.
- [ ] Current month meal rates verified (operational check; warn if not yet configured).
- [ ] UPI payment receiver settings verified (operational check).

---

## 4. Environment Configuration
Verify required environment variables:
### Render Web Service (`meal-khata-api`)
- [ ] `NODE_ENV=production`
- [ ] `APP_TIMEZONE=Asia/Kolkata`
- [ ] `APP_ORIGIN=https://<your-vercel-domain>.vercel.app`
- [ ] `MONGODB_URI=<secured-mongodb-connection-string>`
- [ ] `AUTH_JWT_SECRET=<high-entropy-jwt-secret>`
Optional (if background Web Push reminders enabled on Render):
- [ ] `VAPID_PUBLIC_KEY`
- [ ] `VAPID_PRIVATE_KEY`
- [ ] `VAPID_SUBJECT=mailto:<admin-email>`

### Vercel Project (Frontend)
- [ ] `VITE_SOCKET_URL=https://<your-render-service>.onrender.com`

---

## 5. Backup & Disaster Recovery Pre-Check
- [ ] MongoDB Atlas continuous cloud backups confirmed enabled OR manual offline backup generated: `npm run db:backup`.
- [ ] Backup verified: `npm run db:backup:verify -- <backup-file>`.
- [ ] Backup archive stored in durable off-box location (Render local disk is ephemeral and will not persist across restarts).

---

## 6. Deployment Procedure
1. [ ] Push release commit to `main` branch: `git push origin main`.
2. [ ] Deploy Render backend web service (`npm ci --omit=dev` and `npm run start --workspace backend`).
3. [ ] Verify backend readiness check passes: `/api/ready` $\to 200$.
4. [ ] Deploy Vercel frontend project from repository root (`npm ci`, `npm run build --workspace frontend`, output `frontend/dist`).
5. [ ] Ensure `vercel.json` rewrites `/api/*` to the Render HTTPS origin.

---

## 7. Post-Deploy Smoke Testing
Execute `npm run release:smoke -- --url https://<your-vercel-domain>.vercel.app` or verify manually:
- [ ] `GET /api/health` returns status `ok`, version `1.0.0`, and uptime through Vercel proxy.
- [ ] `GET /api/ready` returns status `ready`.
- [ ] `GET /manifest.webmanifest` returns valid standalone manifest.
- [ ] `GET /sw.js` returns valid service worker.
- [ ] `GET /` serves SPA HTML shell.
- [ ] `GET /.env` returns `404 Not Found` (dotfile defense verified).
- [ ] Manual Member Login (`gaurav`): Home dashboard loads personal meals, plate totals, and India greeting.
- [ ] Daily Meal Toggle: Member toggles today's meal status, optimistic UI updates, and plate count reflects change.
- [ ] Realtime Sync: Second browser tab/device updates immediately upon meal toggle.
- [ ] Navigation Check: Deep navigation to `/calendar`, `/reports`, `/payments` functions without 404s.
- [ ] PWA Installation: Browser shows install prompt / desktop install capability.

---

## 8. Rollback Plan
If a critical production defect or outage is detected:

### Application Rollback
1. In Render dashboard, select previous successful deployment and trigger **Rollback**.
2. Alternatively, revert git commit: `git revert HEAD` and push to `main`.
3. Verify prior deployment starts and `/api/ready` returns 200.

### Database Safety Guarantee
- Application rollback does **not** corrupt database state because v1.0.0 schema changes maintain 100% backward compatibility.
- Never restore database backups merely to fix an application deployment defect. Database restores are strictly reserved for verified data corruption incidents.
