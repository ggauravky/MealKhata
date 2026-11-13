import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium',
    viewport: { width: 1365, height: 900 }, acceptDownloads: true },
  webServer: { command: 'node backend/scripts/startIsolatedE2E.js',
    url: 'http://127.0.0.1:5173/login', timeout: 180_000,
    env: { E2E_REQUIRE_FIXED_PORTS: 'true' },
    reuseExistingServer: false },
});
