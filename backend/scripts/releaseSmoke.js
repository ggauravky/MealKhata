import assert from 'node:assert/strict';

async function main() {
  console.log('==========================================');
  console.log('       MealKhata Release Smoke Test       ');
  console.log('==========================================\n');

  const urlArgIndex = process.argv.indexOf('--url');
  const targetUrl = urlArgIndex !== -1 ? process.argv[urlArgIndex + 1] : (process.env.APP_ORIGIN || 'http://localhost:5000');
  const baseUrl = targetUrl.replace(/\/+$/, '');

  console.log(`Target URL: ${baseUrl}\n`);

  const checks = [
    {
      name: 'Liveness Endpoint (/api/health)',
      url: `${baseUrl}/api/health`,
      expectedStatus: 200,
      verify: async (res) => {
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.service, 'MealKhata');
        assert.equal(data.status, 'ok');
        assert.ok(data.version, 'version string must be present');
        assert.ok(!JSON.stringify(data).includes('mongodb'));
      },
    },
    {
      name: 'Readiness Endpoint (/api/ready)',
      url: `${baseUrl}/api/ready`,
      expectedStatus: [200, 503], // 200 when ready, 503 if draining or db reconnecting
      verify: async (res) => {
        const data = await res.json();
        assert.ok(typeof data.status === 'string');
      },
    },
    {
      name: 'PWA Web App Manifest (/manifest.webmanifest)',
      url: `${baseUrl}/manifest.webmanifest`,
      expectedStatus: 200,
      verify: async (res) => {
        const manifest = await res.json();
        assert.equal(manifest.name, 'MealKhata');
        assert.equal(manifest.display, 'standalone');
        assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
      },
    },
    {
      name: 'PWA Service Worker (/sw.js)',
      url: `${baseUrl}/sw.js`,
      expectedStatus: 200,
      verify: async (res) => {
        const text = await res.text();
        assert.ok(text.includes('mealkhata-shell-v1') || text.includes('CACHE_NAME'));
        assert.ok(text.includes('SKIP_WAITING'));
      },
    },
    {
      name: 'Single Page App Root (/)',
      url: `${baseUrl}/`,
      expectedStatus: 200,
      verify: async (res) => {
        const html = await res.text();
        assert.ok(html.includes('<div id="root"></div>') || html.includes('id="root"'));
        assert.ok(html.includes('MealKhata'));
      },
    },
    {
      name: 'SPA Navigation Route (/calendar)',
      url: `${baseUrl}/calendar`,
      expectedStatus: 200,
      verify: async (res) => {
        const html = await res.text();
        assert.ok(html.includes('id="root"'));
      },
    },
    {
      name: 'SPA Navigation Route (/reports)',
      url: `${baseUrl}/reports`,
      expectedStatus: 200,
      verify: async (res) => {
        const html = await res.text();
        assert.ok(html.includes('id="root"'));
      },
    },
    {
      name: 'SPA Navigation Route (/payments)',
      url: `${baseUrl}/payments`,
      expectedStatus: 200,
      verify: async (res) => {
        const html = await res.text();
        assert.ok(html.includes('id="root"'));
      },
    },
    {
      name: 'SPA Navigation Route (/login)',
      url: `${baseUrl}/login`,
      expectedStatus: 200,
      verify: async (res) => {
        const html = await res.text();
        assert.ok(html.includes('id="root"'));
      },
    },
    {
      name: 'API 404 Boundary (/api/unknown-endpoint)',
      url: `${baseUrl}/api/unknown-endpoint`,
      expectedStatus: 404,
      verify: async (res) => {
        const data = await res.json();
        assert.equal(data.success, false);
      },
    },
    {
      name: 'Sensitive Dotfile Protection (/.env)',
      url: `${baseUrl}/.env`,
      expectedStatus: 404,
      verify: async (res) => {
        const text = await res.text();
        assert.ok(!text.includes('AUTH_JWT_SECRET'));
        assert.ok(!text.includes('MONGODB_URI'));
      },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const check of checks) {
    try {
      const res = await fetch(check.url);
      const allowed = Array.isArray(check.expectedStatus) ? check.expectedStatus : [check.expectedStatus];
      if (!allowed.includes(res.status)) {
        throw new Error(`Expected status ${allowed.join(' or ')}, received ${res.status}`);
      }
      if (check.verify) {
        await check.verify(res);
      }
      console.log(`  ✓ ${check.name}: PASS (${res.status})`);
      passed += 1;
    } catch (err) {
      console.error(`  ✗ ${check.name}: FAIL - ${err.message}`);
      failed += 1;
    }
  }

  console.log(`\nSmoke Test Summary: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }

  console.log('All public release smoke checks PASSED.');
}

main().catch((err) => {
  console.error('Release smoke runner failed:', err);
  process.exit(1);
});
