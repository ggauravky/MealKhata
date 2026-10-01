process.env.NODE_ENV = 'test';

import http from 'node:http';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/auth/auth.service.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { MEMBERS } from '../src/config/members.js';
import { createDashboardService } from '../src/dashboard/dashboard.service.js';
import { createMealService } from '../src/meals/meal.service.js';
import { createPaymentService } from '../src/payments/payment.service.js';
import { createPaymentSettingsService } from '../src/payments/paymentSettings.service.js';
import { createPaymentSummaryService } from '../src/payments/paymentSummary.service.js';
import { createReportService } from '../src/reports/report.service.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { createBillingRouter } from '../src/routes/billing.routes.js';
import { createCalendarRouter } from '../src/routes/calendar.routes.js';
import { createDashboardRouter } from '../src/routes/dashboard.routes.js';
import { createHealthRouter } from '../src/routes/health.routes.js';
import { createMealRouter } from '../src/routes/meal.routes.js';
import { createPaymentRouter } from '../src/routes/payment.routes.js';
import { createPaymentSettingsRouter } from '../src/routes/paymentSettings.routes.js';
import { createReminderSettingsRouter } from '../src/routes/reminderSettings.routes.js';
import { createReportRouter } from '../src/routes/report.routes.js';
import { createSettlementRouter } from '../src/routes/settlement.routes.js';
import { createReminderSettingsService } from '../src/settings/reminderSettings.service.js';
import { createSettlementService } from '../src/settlement/settlement.service.js';
import { InMemoryMealRepository } from '../test/helpers/inMemoryMealRepository.js';
import { InMemoryMemberAccountRepository } from '../test/helpers/inMemoryMemberAccountRepository.js';
import { InMemoryMonthlyRateRepository } from '../test/helpers/inMemoryMonthlyRateRepository.js';
import { InMemoryMonthlySettlementRepository } from '../test/helpers/inMemoryMonthlySettlementRepository.js';
import { InMemoryPaymentRepository } from '../test/helpers/inMemoryPaymentRepository.js';
import { InMemoryPaymentSettingsRepository } from '../test/helpers/inMemoryPaymentSettingsRepository.js';
import { InMemoryReminderSettingsRepository } from '../test/helpers/inMemoryReminderSettingsRepository.js';

const RUNS_PER_ENDPOINT = 50;
const CONCURRENCY = 5;
const P95_THRESHOLD_MS = 250;

async function setupBenchmarkServer() {
  const mealRepo = new InMemoryMealRepository();
  const memberRepo = new InMemoryMemberAccountRepository();
  const rateRepo = new InMemoryMonthlyRateRepository();
  const paymentRepo = new InMemoryPaymentRepository();
  const paymentSettingsRepo = new InMemoryPaymentSettingsRepository();
  const settlementRepo = new InMemoryMonthlySettlementRepository();
  const reminderRepo = new InMemoryReminderSettingsRepository();

  const now = () => new Date('2026-10-15T12:00:00+05:30');
  const timezone = 'Asia/Kolkata';

  // Seed realistic October 2026 data
  await rateRepo.create({
    month: '2026-10',
    morningRatePaise: 4000,
    nightRatePaise: 5000,
    updatedByRole: 'superadmin',
  });

  for (let d = 1; d <= 31; d += 1) {
    const dayStr = String(d).padStart(2, '0');
    const date = `2026-10-${dayStr}`;
    await mealRepo.create({
      date,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: d % 2 === 0 ? 'skip' : 'taking', devansh: 'taking' },
        night: { gaurav: 'taking', nikhil: 'taking', devansh: d % 3 === 0 ? 'skip' : 'taking' },
      },
      changes: [],
    });
  }

  // Seed recorded payments
  await paymentRepo.create({
    paymentId: 'pay-bench-1',
    idempotencyKey: 'idem-bench-1',
    month: '2026-10',
    memberId: 'gaurav',
    amountPaise: 250000,
    method: 'upi_manual',
    status: 'recorded',
    recordedAt: new Date('2026-10-10T10:00:00+05:30'),
    recordedByRole: 'member',
  });

  // Seed previous month settlement
  await settlementRepo.createSettlement({
    settlementId: 'settle-2026-09-1',
    month: '2026-09',
    sequence: 1,
    snapshot: {
      month: '2026-09',
      rates: { morningRatePaise: 4000, nightRatePaise: 5000 },
      members: MEMBERS.map((m) => ({ memberId: m.id, morningCount: 30, nightCount: 30, billAmountPaise: 270000, paidAmountPaise: 270000 })),
      roomTotalBillPaise: 810000,
      roomTotalPaidPaise: 810000,
    },
  });

  const mealService = createMealService({ repository: mealRepo, timezone });
  const monthMealService = createMonthMealService({ repository: mealRepo, timezone });
  const rateService = createMonthlyRateService({ repository: rateRepo });
  const reportService = createReportService({ meals: monthMealService, rates: rateService, now, timezone });
  const paymentSummaryService = createPaymentSummaryService({ reports: reportService, repository: paymentRepo });
  const paymentSettingsService = createPaymentSettingsService({ repository: paymentSettingsRepo });
  const settlementService = createSettlementService({ reports: reportService, summaries: paymentSummaryService, repository: settlementRepo, now });
  const paymentService = createPaymentService({ repository: paymentRepo, reports: reportService, summaries: paymentSummaryService, settings: paymentSettingsService, settlements: settlementService, now });
  const reminderService = createReminderSettingsService({ repository: reminderRepo });
  const dashboardService = createDashboardService({
    mealService,
    reportService,
    paymentSummaryService,
    settlementService,
    reminderSettingsService: reminderService,
    pushConfigured: false,
    now,
    timezone,
  });
  const authService = createAuthService({ memberAccounts: memberRepo });

  const app = createApp({
    auth: createAuthRouter({ service: authService }),
    meals: createMealRouter({ service: mealService }),
    billing: createBillingRouter({ service: rateService }),
    calendar: createCalendarRouter({ service: monthMealService }),
    reports: createReportRouter({ service: reportService }),
    payments: createPaymentRouter({ service: paymentService, summaries: paymentSummaryService }),
    paymentSettings: createPaymentSettingsRouter({ service: paymentSettingsService }),
    reminderSettings: createReminderSettingsRouter({ service: reminderService }),
    settlements: createSettlementRouter({ service: settlementService }),
    dashboard: createDashboardRouter({ service: dashboardService }),
    health: createHealthRouter({ readiness: async () => true, drainingCheck: () => false }),
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return { server, baseUrl };
}

async function runBenchmarkForEndpoint(baseUrl, path) {
  const url = `${baseUrl}${path}`;
  const durations = [];
  let errors = 0;

  // Warmup 3 requests
  for (let i = 0; i < 3; i += 1) {
    try {
      await fetch(url);
    } catch {
      // Warmup catch
    }
  }

  const startTime = performance.now();
  const queue = Array.from({ length: RUNS_PER_ENDPOINT }, (_, i) => i);

  async function worker() {
    while (queue.length > 0) {
      queue.pop();
      const reqStart = performance.now();
      try {
        const res = await fetch(url);
        const reqDuration = performance.now() - reqStart;
        if (!res.ok) {
          errors += 1;
        } else {
          durations.push(reqDuration);
        }
      } catch {
        errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const totalDurationSeconds = (performance.now() - startTime) / 1000;

  durations.sort((a, b) => a - b);
  const min = durations.length > 0 ? durations[0] : 0;
  const p50 = durations.length > 0 ? durations[Math.floor(durations.length * 0.5)] : 0;
  const p95 = durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0;
  const max = durations.length > 0 ? durations[durations.length - 1] : 0;
  const reqPerSec = totalDurationSeconds > 0 ? Math.round(durations.length / totalDurationSeconds) : 0;

  return {
    path,
    runs: durations.length,
    errors,
    min: min.toFixed(1),
    p50: p50.toFixed(1),
    p95: p95.toFixed(1),
    max: max.toFixed(1),
    reqPerSec,
  };
}

async function main() {
  console.log('==========================================');
  console.log('   MealKhata Performance Baseline Audit   ');
  console.log('==========================================\n');

  const urlArgIndex = process.argv.indexOf('--url');
  let targetUrl = urlArgIndex !== -1 ? process.argv[urlArgIndex + 1] : process.env.TARGET_URL;
  let serverToClose = null;

  if (targetUrl) {
    const parsed = new URL(targetUrl);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (!isLocal && process.env.ALLOW_REMOTE_PERF !== '1') {
      throw new Error(`Refusing to benchmark non-local host (${parsed.hostname}) without ALLOW_REMOTE_PERF=1`);
    }
  } else {
    const { server, baseUrl } = await setupBenchmarkServer();
    targetUrl = baseUrl;
    serverToClose = server;
  }

  const baseUrl = targetUrl.replace(/\/+$/, '');

  const endpoints = [
    '/api/health',
    '/api/meals/today',
    '/api/dashboard',
    '/api/calendar/2026-10',
    '/api/reports/monthly/2026-10',
    '/api/payments/summary/2026-10',
    '/api/settlements/2026-10',
  ];

  console.log(`Target: ${baseUrl} (ephemeral test server with realistic 3-member dataset)`);
  console.log(`Runs per endpoint: ${RUNS_PER_ENDPOINT} | Concurrency: ${CONCURRENCY}\n`);

  let regressionFound = false;
  const results = [];

  for (const endpoint of endpoints) {
    const metric = await runBenchmarkForEndpoint(baseUrl, endpoint);
    results.push(metric);
    if (parseFloat(metric.p95) > P95_THRESHOLD_MS || metric.errors > 0) {
      regressionFound = true;
    }
  }

  // Format table output
  console.log('-----------------------------------------------------------------------------------------');
  console.log('Endpoint'.padEnd(32) + 'Runs'.padEnd(8) + 'Errors'.padEnd(8) + 'p50(ms)'.padEnd(10) + 'p95(ms)'.padEnd(10) + 'Max(ms)'.padEnd(10) + 'Req/s');
  console.log('-----------------------------------------------------------------------------------------');
  for (const r of results) {
    console.log(
      r.path.padEnd(32) +
      String(r.runs).padEnd(8) +
      String(r.errors).padEnd(8) +
      r.p50.padEnd(10) +
      r.p95.padEnd(10) +
      r.max.padEnd(10) +
      String(r.reqPerSec)
    );
  }
  console.log('-----------------------------------------------------------------------------------------\n');

  if (serverToClose) {
    await new Promise((resolve) => serverToClose.close(resolve));
  }

  if (regressionFound) {
    console.error(`FAIL: One or more endpoints exceeded p95 threshold (${P95_THRESHOLD_MS}ms) or recorded errors.`);
    process.exit(1);
  }

  console.log(`PASS: All representative endpoints verified with p95 < ${P95_THRESHOLD_MS}ms and 0 errors.`);
}

main().catch((err) => {
  console.error('Performance check failed:', err);
  process.exit(1);
});
