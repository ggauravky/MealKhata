import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { defineConfig } from '@playwright/test';

process.env.E2E_V3_ATTESTATION_PATH ||= path.join(tmpdir(), `mealkhata-v3-e2e-${process.pid}.json`);
const attestationPath = process.env.E2E_V3_ATTESTATION_PATH;

export default defineConfig({
  testDir: './e2e',
  testMatch: 'v3-signed.spec.js',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium',
    viewport: { width: 1365, height: 900 } },
  webServer: { command: 'node backend/scripts/startIsolatedE2E.js',
    url: 'http://127.0.0.1:5173/login', timeout: 180_000,
    env: { E2E_REQUIRE_FIXED_PORTS: 'true', E2E_SIGNED_V3: 'true',
      E2E_V3_ATTESTATION_PATH: attestationPath },
    reuseExistingServer: false },
});
