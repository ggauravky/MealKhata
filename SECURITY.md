# Security Policy & Architecture

## Security Architecture Overview

MealKhata is a private, multi-user household meal and shared-expense management application designed with defense-in-depth principles:

```
INTERNET
   │
   ▼
 HTTPS (TLS)
   │
   ▼
 Render Web Service (Proxy Hop = 1)
   │
   ├── Security Headers (Helmet, CSP, HSTS, Permissions-Policy)
   ├── Request Correlation (X-Request-ID tracking)
   ├── Rate Limiting (Global API, Login Limiter, Sensitive Mutation Limiter)
   ├── CSRF & Trusted Origin Enforcement (Origin === APP_ORIGIN)
   ├── HttpOnly Cookie Session Authentication (JWT ES/HS, SameSite=Lax, Secure)
   │
   ▼
 Express API & Static Server
   ├── Zero dotfile / secret route exposure
   ├── Structured JSON logs with automated secret redaction
   ├── Safe error boundaries (No stack traces returned to client)
   │
   ▼
 MongoDB Database
   ├── Bounded connection pool (maxPoolSize: 5)
   ├── Immutable audit logs & write-once payment records
   └── Encrypted AES-256-GCM backups
```

---

## 1. Authentication & Session Security

- **Session Tokens**: Stateless JSON Web Tokens (JWT) signed with `AUTH_JWT_SECRET` (minimum 48 bytes in production).
- **Storage**: Delivered via `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/` session cookie named `mealkhata_session`.
- **JWT Claims**: Issuer (`mealkhata-api`), Audience (`mealkhata-client`), subject, role, memberId, and a bounded 12-hour expiration. Algorithms are restricted to prevent `alg=none` vulnerabilities.
- **Passwords**: Hashed with `bcryptjs` cost factor 12. Password hashes are never returned by APIs or logged.
- **Timing Attacks**: Authentication uses dummy hash evaluations on unknown emails to prevent timing-based user enumeration. Error responses remain generic: `"Invalid email or password."`.

---

## 2. Authorization & Ownership

MealKhata defines four strict operational roles:
1. **Viewer**: Public view-only access to schedule, kitchen plate totals, and public reports. Cannot mutate any records.
2. **Member**: Authenticated household member (`gaurav`, `nikhil`, `devansh`).
   - May only update their own meals for today (`PATCH /api/meals/:date`).
   - May only prepare and record payments for their own account.
   - Prohibited from accessing other members' records or administrative settings (enforced with 403).
3. **Admin**: Household meal manager.
   - May edit today's meals for any roommate.
   - Cannot modify past/future meal dates or administrative rates/settings.
4. **Super Admin**: System administrator.
   - Full authority over historical/future meal records, rate configuration, payment voids, monthly settlement closure, and reminder settings.

All authorization is verified server-side using session claims (`req.auth`); client-supplied parameters such as `?memberId=` are never trusted.

---

## 3. Network & Transport Security

- **HSTS**: `Strict-Transport-Security: max-age=31536000; includeSubDomains` in production.
- **Content Security Policy (CSP)**:
  - `default-src 'self'`
  - `frame-ancestors 'none'`
  - `object-src 'none'`
  - `style-src 'self' 'unsafe-inline'` (*Note: `'unsafe-inline'` is retained because Vite dynamically mounts stylesheets and CSS variables for light/dark themes*).
- **Permissions-Policy**: `camera=(), geolocation=(), microphone=()` blocks browser sensory APIs.
- **X-Powered-By**: Disabled on the Express application.
- **CSRF / Origin Check**: Every mutating HTTP request (`POST`, `PUT`, `PATCH`, `DELETE`) requires `Origin === APP_ORIGIN`. Foreign or missing origins on mutating routes are rejected with 403.
- **Socket.IO Origin**: In production, Socket.IO handshakes are strictly verified against `APP_ORIGIN`.

---

## 4. Rate Limiting & Proxy Configuration

- **Reverse Proxy**: Configured with `app.set('trust proxy', 1)` to match Render's single-hop load balancer.
- **Global API Rate Limit**: 300 requests per 15-minute window per IP in production.
- **Login Rate Limit**: 10 attempts per 15-minute window per IP.
- **Sensitive Mutation Rate Limit**: 60 requests per 15-minute window for payments, voids, settlements, and settings updates.

---

## 5. Observability & Central Log Redaction

- **Request Correlation**: All requests receive a unique `X-Request-ID` (UUID or validated client correlation token) propagated across logs and error responses.
- **Structured JSON Logging**: Production logs output single-line JSON with timestamps, log levels, event names, and request IDs.
- **Automated Redaction**: `backend/src/utils/sanitizer.js` recursively redacts sensitive fields matching passwords, hashes, tokens, auth headers, cookies, JWTs, VAPID private keys, push credentials, and MongoDB connection URIs.
- **No Raw Request Body Logging**: Global request logging explicitly excludes `req.body`.
- **Safe Client Errors**: 500-level errors return generic messages with request reference IDs; internal stack traces are never exposed to clients.

---

## 6. Secret Rotation Runbook

If a credential or secret must be rotated, follow these procedures:

### A. Rotating `AUTH_JWT_SECRET`
1. Generate a new cryptographically secure 48+ byte string:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Update `AUTH_JWT_SECRET` in the Render environment variables dashboard.
3. Deploy/restart the Web Service.
4. **Operational Impact**: All active sessions will become invalid immediately. Users will log in again. Historical data is completely unaffected.

### B. Rotating Admin or Super Admin Passwords
1. Generate a new cost-12 bcrypt hash:
   ```bash
   npm run hash-password
   ```
2. Update `ADMIN_PASSWORD_HASH` or `SUPERADMIN_PASSWORD_HASH` in Render environment variables.
3. Restart the service.
4. **Operational Impact**: Future logins require the new password. Existing active JWT sessions remain valid until expiration (max 12h) unless `AUTH_JWT_SECRET` is also rotated.

### C. Rotating Member Passwords
1. Run the member seeding script or update member account password hashes in MongoDB directly:
   ```bash
   MEMBER_GAURAV_PASSWORD_HASH="<new-hash>" npm run seed-members
   ```

### D. Rotating MongoDB Connection URI
1. Update `MONGODB_URI` in Render environment variables.
2. Restart the Web Service.

### E. Rotating VAPID Web Push Keys (Optional)
1. Generate a new keypair:
   ```bash
   npm run generate-vapid-keys
   ```
2. Update `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in Render environment variables.
3. **Operational Impact**: Previously subscribed client devices will receive invalid signature errors upon push dispatch and will automatically re-register on next app open.

---

## 7. Reporting a Vulnerability

If you identify a security vulnerability in MealKhata, please report it privately to the maintainers rather than opening a public GitHub issue.
