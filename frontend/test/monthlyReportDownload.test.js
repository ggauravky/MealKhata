import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadMonthlyReport } from '../src/lib/reportDownload.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(currentDir, '../src');

function setOnlineStatus(online) {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    value: online,
    configurable: true,
    writable: true,
  });
}

describe('Monthly Report PDF Download Client Logic', () => {
  test('Requirement 131: downloadMonthlyReport throws error when offline', async () => {
    const originalOnline = globalThis.navigator?.onLine;
    setOnlineStatus(false);

    try {
      await assert.rejects(
        () => downloadMonthlyReport('2026-10'),
        /Connect to the internet to download this report\./,
      );
    } finally {
      setOnlineStatus(originalOnline ?? true);
    }
  });

  test('Requirement 126, 127, 129, 130: downloadMonthlyReport fetches same-origin endpoint and triggers download', async () => {
    let capturedUrl = null;
    let capturedOptions = null;
    let clickedHref = null;
    let clickedDownload = null;
    let objectUrlRevoked = false;

    const originalOnline = globalThis.navigator?.onLine;
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    setOnlineStatus(true);

    const mockBlob = { size: 12345 };

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => {
            if (name.toLowerCase() === 'content-type') return 'application/pdf';
            if (name.toLowerCase() === 'content-disposition') {
              return 'attachment; filename="MealKhata-Monthly-Report-2026-10.pdf"';
            }
            return null;
          },
        },
        blob: async () => mockBlob,
      };
    };

    globalThis.window = {
      URL: {
        createObjectURL: () => 'blob:http://localhost/test-uuid',
        revokeObjectURL: () => {
          objectUrlRevoked = true;
        },
      },
    };

    const mockLink = {
      href: '',
      download: '',
      click: () => {
        clickedHref = mockLink.href;
        clickedDownload = mockLink.download;
      },
    };

    globalThis.document = {
      createElement: (tag) => {
        if (tag === 'a') return mockLink;
        return {};
      },
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
    };

    try {
      const result = await downloadMonthlyReport('2026-10');
      assert.equal(capturedUrl, '/api/reports/monthly/2026-10/report.pdf');
      assert.equal(capturedOptions.credentials, 'same-origin');
      assert.equal(result.filename, 'MealKhata-Monthly-Report-2026-10.pdf');
      assert.equal(result.size, 12345);
      assert.equal(clickedHref, 'blob:http://localhost/test-uuid');
      assert.equal(clickedDownload, 'MealKhata-Monthly-Report-2026-10.pdf');

      // Wait 1.1s for setTimeout URL revocation
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.equal(objectUrlRevoked, true);
    } finally {
      setOnlineStatus(originalOnline ?? true);
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
    }
  });

  test('Requirement 128: downloadMonthlyReport handles error JSON safely', async () => {
    const originalOnline = globalThis.navigator?.onLine;
    const originalFetch = globalThis.fetch;

    setOnlineStatus(true);
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      headers: {
        get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({
        success: false,
        message: 'Month must be a valid calendar month in YYYY-MM format.',
      }),
    });

    try {
      await assert.rejects(
        () => downloadMonthlyReport('invalid-month'),
        /Month must be a valid calendar month in YYYY-MM format\./,
      );
    } finally {
      setOnlineStatus(originalOnline ?? true);
      globalThis.fetch = originalFetch;
    }
  });

  test('Requirement 120, 121, 123, 177: ReportsPage incorporates Download PDF button with accessible metadata', () => {
    const reportsPageFile = fs.readFileSync(path.join(srcDir, 'pages/ReportsPage.jsx'), 'utf8');

    assert.match(reportsPageFile, /downloadMonthlyReport/, 'ReportsPage must call downloadMonthlyReport');
    assert.match(reportsPageFile, /Download\s+className/, 'ReportsPage must render Lucide Download icon');
    assert.match(reportsPageFile, /Download PDF/, 'ReportsPage must have visible button label "Download PDF"');
    assert.match(reportsPageFile, /aria-label=\{`Download \$\{monthLabel\} monthly report as PDF`\}/, 'ReportsPage button must have aria-label');
    assert.match(reportsPageFile, /aria-busy=\{isDownloading\}/, 'ReportsPage button must indicate loading state via aria-busy');
    assert.match(reportsPageFile, /Preparing PDF/, 'ReportsPage must display "Preparing PDF" during download');
    assert.match(reportsPageFile, /role="status"/, 'ReportsPage error display must use role="status"');
  });
});
