# Fresh MealKhata v3 target

This procedure initializes an existing, verified-empty application database. It never clears or migrates data. The initializer creates one canonical Super Admin, one financial start setting, required indexes, and a one-use initialization manifest. It creates no students, meals, rooms, Stays, payments, expenses, or other operational records.

Confirm the exact target database name and verify that every collection has zero documents before setup. Use a dedicated Atlas database user scoped to that target. Keep credentials, password hashes, approval files, signing keys, and runtime attestations outside Git and outside the project directory.

## Prepare and approve

1. Set `MONGODB_URI` to the TLS Atlas SRV URI whose path is the exact empty application database. Set `FRESH_TARGET_DATABASE` to that database name, plus `FRESH_SUPERADMIN_EMAIL` and `FRESH_FINANCIAL_START_DATE` (YYYY-MM-DD). Leave `FRESH_SOURCE_DATABASE` and `FRESH_TARGET_MONGODB_URI` unset for this empty-database mode. The financial date is an explicit owner decision; there is no default.
2. Generate a unique Super Admin password and run `npm run hash-password` interactively. Store its cost-12 bcrypt result as `FRESH_SUPERADMIN_PASSWORD_HASH` in a protected operator environment. Do not put the password or hash in a command argument or Git file.
3. From the repository root, run `npm run initialize:fresh:v3 -- --prepare`. This is read-only. It refuses a nonempty target and prints a body plus `signingDigest`. The digest is the lowercase SHA-256 hex string to sign, encoded as UTF-8 bytes.
4. The owner and a different operator each sign those bytes with separate Ed25519 private keys. Base64-encode each signature and assemble a protected JSON file containing exactly `{ "body": <printed body>, "signatures": { "owner": <base64>, "operator": <base64> } }`. The approval expires in five minutes. Set `V3_RELEASE_OWNER_PUBLIC_KEY`, `V3_RELEASE_OPERATOR_PUBLIC_KEY`, and `FRESH_APPROVAL_PATH` in the operator environment. Never send private keys or passwords through chat.
5. Run `npm run initialize:fresh:v3 -- --execute` once. It verifies the exact target URI path, cluster handshake, empty target, two signatures, expiry, password hash, and unique indexes. It inserts the Super Admin, financial boundary, and manifest in one replica-set transaction. A failed or repeated initialization does not overwrite existing application records. Record the returned `initializationChecksum` and user ID in protected release evidence.

No data deletion is part of this procedure. If the target contains any document, stop; do not clear it with this tool. A separate, verified backup and explicit reset decision would be required before deleting target data. For older blue-green setups, the separate-source compatibility mode remains available by setting `FRESH_SOURCE_DATABASE` and a distinct `FRESH_TARGET_MONGODB_URI`; that mode retains its source/target separation checks.

## Start the reviewed build

1. Set `V3_RELEASE_BUILD_SHA` to the exact reviewed commit, `FRESH_RELEASE_ID` to a unique release ID, and `FRESH_LAUNCH_STAGE=read-only` or `serving`. Run `npm run initialize:fresh:v3 -- --prepare-runtime`. It reads the target manifest, active Super Admin and indexes and prints a fresh runtime body plus signing digest.
2. Have the same independent roles sign the runtime digest. Store the resulting `{ body, signatures }` JSON outside Git at `V3_RELEASE_ATTESTATION_PATH`. A runtime attestation expires within 24 hours; issue and sign a new one before expiry. `serving` is required for API mutations, including login.
3. Configure the backend with the target `MONGODB_URI`, `MEALKHATA_RUNTIME_PROFILE=v3`, `CANONICAL_ONLY_AUTH=true`, a fresh `AUTH_JWT_SECRET`, exact `APP_ORIGIN`, both public keys, the attestation path, and the reviewed build SHA. The observed deployed build SHA must match. Do not switch a live service until its deployment and rollback procedure is separately reviewed.
4. Verify `/api/ready`, Super Admin login, an empty roster/calendar/financial view, and the full fresh student, meal, room, and payment journey. Confirm all operational collections remain empty until an authorized user creates records.

The legacy three-student constants remain for v2 source reads and historical migration verification only. The v3 runtime uses the database-backed student resolver and canonical accounts; normal startup does not invoke any seed script.
