import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createMonthlyRateService } from '../src/billing/monthlyRate.service.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { createPaymentSummaryService } from '../src/payments/paymentSummary.service.js';
import { createReportService } from '../src/reports/report.service.js';
import { createMonthlyReportExportService } from '../src/reports/monthlyReportExport.service.js';
import { createMonthlyReportPdfService } from '../src/reports/monthlyReportPdf.service.js';
import { createReportRouter } from '../src/routes/report.routes.js';
import { createSettlementService } from '../src/settlement/settlement.service.js';
import { InMemoryMealRepository } from './helpers/inMemoryMealRepository.js';
import { InMemoryMonthlyRateRepository } from './helpers/inMemoryMonthlyRateRepository.js';
import { InMemoryMonthlySettlementRepository } from './helpers/inMemoryMonthlySettlementRepository.js';
import { InMemoryPaymentRepository } from './helpers/inMemoryPaymentRepository.js';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const TIMEZONE = 'Asia/Kolkata';

describe('Monthly Report PDF Export & Canonical DTO', () => {
  let mealRepo;
  let rateRepo;
  let paymentRepo;
  let settlementRepo;

  let monthMealService;
  let rateService;
  let reportService;
  let paymentSummaryService;
  let settlementService;
  let exportService;
  let pdfService;
  let app;
  let memberCookie;

  beforeEach(async () => {
    mealRepo = new InMemoryMealRepository();
    rateRepo = new InMemoryMonthlyRateRepository();
    paymentRepo = new InMemoryPaymentRepository();
    settlementRepo = new InMemoryMonthlySettlementRepository();

    monthMealService = createMonthMealService({ repository: mealRepo, timezone: TIMEZONE });
    rateService = createMonthlyRateService({ repository: rateRepo });
    reportService = createReportService({
      meals: monthMealService,
      rates: rateService,
      now: () => NOW,
      timezone: TIMEZONE,
    });
    paymentSummaryService = createPaymentSummaryService({
      reports: reportService,
      repository: paymentRepo,
    });
    settlementService = createSettlementService({
      reports: reportService,
      summaries: paymentSummaryService,
      repository: settlementRepo,
      now: () => NOW,
    });

    exportService = createMonthlyReportExportService({
      meals: monthMealService,
      reports: reportService,
      summaries: paymentSummaryService,
      payments: paymentRepo,
      settlements: settlementService,
      rates: rateService,
      now: () => NOW,
      timezone: TIMEZONE,
    });

    pdfService = createMonthlyReportPdfService({ exportService });

    const reportRouter = createReportRouter({
      service: reportService,
      pdfService,
    });

    app = createApp({
      reports: reportRouter,
    });

    const memberToken = await createSessionToken(ROLES.MEMBER, {
      memberId: 'gaurav',
    });
    memberCookie = `${SESSION_COOKIE_NAME}=${memberToken}`;
  });

  test('Requirement 152: Unauthenticated request to /report.pdf returns 401', async () => {
    const response = await request(app).get('/api/reports/monthly/2026-10/report.pdf');
    assert.equal(response.status, 401);
    assert.equal(response.body.success, false);
  });

  test('Requirement 153: Invalid month returns 400', async () => {
    const invalidMonths = ['2026', '26-10', '2026-13', 'invalid'];
    for (const m of invalidMonths) {
      const response = await request(app)
        .get(`/api/reports/monthly/${m}/report.pdf`)
        .set('Cookie', memberCookie);
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
    }
  });

  test('Requirement 154, 155: Valid authenticated request returns PDF buffer with exact headers', async () => {
    const response = await request(app)
      .get('/api/reports/monthly/2026-10/report.pdf')
      .set('Cookie', memberCookie);

    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/pdf');
    assert.equal(response.headers['content-disposition'], 'attachment; filename="MealKhata-Monthly-Report-2026-10.pdf"');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(response.headers['content-length']);

    // Assert buffer begins with %PDF-
    const buffer = response.body;
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Requirement 156: Empty month generates valid PDF with zero totals', async () => {
    const data = await exportService.buildMonthlyReportExport('2026-09');
    assert.equal(data.summary.recordedDayCount, 0);
    assert.equal(data.summary.totalPhysicalPlates, 0);
    assert.equal(data.summary.roomAmountPaise, 0);
    assert.equal(data.summary.paidAmountPaise, 0);
    assert.equal(data.summary.remainingAmountPaise, 0);

    const pdfBuffer = await pdfService.generateMonthlyReportPdf('2026-09');
    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(pdfBuffer.length > 1000);
  });

  test('Requirement 157, 158: One full morning and one full night calculate exact amounts', async () => {
    await mealRepo.create({
      date: '2026-10-01',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'not_set', devansh: 'not_set' },
        night: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
      },
      changes: [],
    });

    await mealRepo.create({
      date: '2026-10-02',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
        night: { gaurav: 'taking', nikhil: 'not_set', devansh: 'not_set' },
      },
      changes: [],
    });

    const exportData = await exportService.buildMonthlyReportExport('2026-10');
    assert.equal(exportData.summary.morningPhysicalPlates, 1);
    assert.equal(exportData.summary.nightPhysicalPlates, 1);
    assert.equal(exportData.summary.totalPhysicalPlates, 2);
    assert.equal(exportData.summary.roomAmountPaise, 12000); // 5000 + 7000

    assert.equal(exportData.members.gaurav.morningAmountPaise, 5000);
    assert.equal(exportData.members.gaurav.nightAmountPaise, 7000);
    assert.equal(exportData.members.gaurav.billAmountPaise, 12000);
    assert.equal(exportData.members.nikhil.billAmountPaise, 0);
    assert.equal(exportData.members.devansh.billAmountPaise, 0);
  });

  test('Requirement 159: Half share (2-way split) allocates exact 2500 paise each', async () => {
    await mealRepo.create({
      date: '2026-10-03',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'taking', devansh: 'skip' },
        night: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
      },
      allocations: {
        morning: {
          mode: 'custom',
          plates: [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }],
        },
      },
      changes: [],
    });

    const exportData = await exportService.buildMonthlyReportExport('2026-10');
    assert.equal(exportData.summary.morningPhysicalPlates, 1);
    assert.equal(exportData.summary.roomAmountPaise, 5000);
    assert.equal(exportData.members.gaurav.morningAmountPaise, 2500);
    assert.equal(exportData.members.nikhil.morningAmountPaise, 2500);
    assert.equal(exportData.members.devansh.morningAmountPaise, 0);
  });

  test('Requirement 160: Three-way split divides exactly with deterministic integer paise', async () => {
    await mealRepo.create({
      date: '2026-10-04',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
        night: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
      },
      allocations: {
        morning: {
          mode: 'custom',
          plates: [{ shares: { gaurav: 2, nikhil: 2, devansh: 2 } }],
        },
      },
      changes: [],
    });

    const exportData = await exportService.buildMonthlyReportExport('2026-10');
    assert.equal(exportData.summary.morningPhysicalPlates, 1);
    assert.equal(exportData.summary.roomAmountPaise, 5000);

    const mGaurav = exportData.members.gaurav.morningAmountPaise;
    const mNikhil = exportData.members.nikhil.morningAmountPaise;
    const mDevansh = exportData.members.devansh.morningAmountPaise;
    assert.equal(mGaurav + mNikhil + mDevansh, 5000);
  });

  test('Requirement 161, 162: Two plates / 3 equal and 1 full + 2 half split accurately', async () => {
    // Oct 5: 2 plates Morning split equally by 3 (10000 paise)
    await mealRepo.create({
      date: '2026-10-05',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
        night: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
      },
      allocations: {
        morning: {
          mode: 'custom',
          plates: [
            { shares: { gaurav: 2, nikhil: 2, devansh: 2 } },
            { shares: { gaurav: 2, nikhil: 2, devansh: 2 } },
          ],
        },
        night: {
          mode: 'custom',
          plates: [
            { shares: { gaurav: 6, nikhil: 0, devansh: 0 } }, // 1 full
            { shares: { gaurav: 0, nikhil: 3, devansh: 3 } }, // 2 half
          ],
        },
      },
      changes: [],
    });

    const exportData = await exportService.buildMonthlyReportExport('2026-10');
    assert.equal(exportData.summary.morningPhysicalPlates, 2);
    assert.equal(exportData.summary.nightPhysicalPlates, 2);
    assert.equal(exportData.summary.morningAmountPaise, 10000);
    assert.equal(exportData.summary.nightAmountPaise, 14000);
    assert.equal(exportData.summary.roomAmountPaise, 24000);

    // Night plate split check: Gaurav full = 7000, Nikhil half = 3500, Devansh half = 3500
    assert.equal(exportData.members.gaurav.nightAmountPaise, 7000);
    assert.equal(exportData.members.nikhil.nightAmountPaise, 3500);
    assert.equal(exportData.members.devansh.nightAmountPaise, 3500);
  });

  test('Requirement 163, 164: not_set and skip contribute 0 share and 0 cost', async () => {
    await mealRepo.create({
      date: '2026-10-06',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'skip', nikhil: 'skip', devansh: 'skip' },
        night: { gaurav: 'not_set', nikhil: 'not_set', devansh: 'not_set' },
      },
      changes: [],
    });

    const exportData = await exportService.buildMonthlyReportExport('2026-10');
    assert.equal(exportData.summary.morningPhysicalPlates, 0);
    assert.equal(exportData.summary.nightPhysicalPlates, 0);
    assert.equal(exportData.summary.roomAmountPaise, 0);
    for (const id of MEMBER_IDS) {
      assert.equal(exportData.members[id].morningAmountPaise, 0);
      assert.equal(exportData.members[id].nightAmountPaise, 0);
    }
  });

  test('Requirement 165: Future scheduled meals in current month do not enter actual bill to date', async () => {
    // Current date is Oct 15. Create meal on Oct 20 (future in current month)
    await mealRepo.create({
      date: '2026-10-20',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
        night: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
      },
      changes: [],
    });

    const exportData = await exportService.buildMonthlyReportExport('2026-10');
    // Actual bill to date must be 0 because Oct 20 is beyond today (Oct 15)
    assert.equal(exportData.summary.roomAmountPaise, 0);
    assert.equal(exportData.summary.morningPhysicalPlates, 0);
    assert.equal(exportData.summary.nightPhysicalPlates, 0);

    // But scheduled future days should have it
    assert.equal(exportData.scheduledFutureDays.length, 1);
    assert.equal(exportData.scheduledFutureDays[0].date, '2026-10-20');
  });

  test('Requirement 166: Closed month reconciles with frozen settlement snapshot and rates', async () => {
    // Populate 10 days in August 2026 so daily meals reconcile with the 30 physical morning + 30 physical night plates
    for (let day = 1; day <= 10; day++) {
      const dateStr = `2026-08-${String(day).padStart(2, '0')}`;
      await mealRepo.create({
        date: dateStr,
        saved: true,
        revision: 1,
        meals: {
          morning: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
          night: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
        },
        changes: [],
      });
    }

    for (const id of MEMBER_IDS) {
      await paymentRepo.create({
        paymentId: `pay-settle-${id}`,
        idempotencyKey: `idem-settle-${id}`,
        month: '2026-08',
        memberId: id,
        amountPaise: 100000,
        status: 'recorded',
        recordedAt: new Date('2026-08-25T10:00:00.000Z'),
      });
    }

    await settlementRepo.createSettlement({
      settlementId: 'settle-2026-08-01',
      month: '2026-08',
      sequence: 1,
      snapshotVersion: 2,
      closedAt: new Date('2026-09-01T10:00:00.000Z'),
      closedByRole: 'superadmin',
      snapshot: {
        rates: {
          morningPricePaise: 4000,
          nightPricePaise: 6000,
        },
        members: {
          gaurav: {
            morningParticipationCount: 10,
            nightParticipationCount: 10,
            morningShareUnits: 60,
            nightShareUnits: 60,
            totalShareUnits: 120,
            billAmountPaise: 100000,
            paidAmountPaise: 100000,
            remainingAmountPaise: 0,
          },
          nikhil: {
            morningParticipationCount: 10,
            nightParticipationCount: 10,
            morningShareUnits: 60,
            nightShareUnits: 60,
            totalShareUnits: 120,
            billAmountPaise: 100000,
            paidAmountPaise: 100000,
            remainingAmountPaise: 0,
          },
          devansh: {
            morningParticipationCount: 10,
            nightParticipationCount: 10,
            morningShareUnits: 60,
            nightShareUnits: 60,
            totalShareUnits: 120,
            billAmountPaise: 100000,
            paidAmountPaise: 100000,
            remainingAmountPaise: 0,
          },
        },
        room: {
          morningPhysicalPlates: 30,
          nightPhysicalPlates: 30,
          totalPhysicalPlates: 60,
          morningParticipants: 30,
          nightParticipants: 30,
          billAmountPaise: 300000,
          paidAmountPaise: 300000,
          remainingAmountPaise: 0,
        },
      },
    });

    const exportData = await exportService.buildMonthlyReportExport('2026-08');
    assert.equal(exportData.reportState, 'closed');
    assert.equal(exportData.prices.morningPricePaise, 4000);
    assert.equal(exportData.prices.nightPricePaise, 6000);
    assert.equal(exportData.prices.isFrozen, true);
    assert.equal(exportData.summary.roomAmountPaise, 300000);
    assert.equal(exportData.summary.paidAmountPaise, 300000);
    assert.equal(exportData.summary.remainingAmountPaise, 0);
  });

  test('Requirement 167: Payments history counts recorded payments and excludes voided payments', async () => {
    // Record payment
    await paymentRepo.create({
      paymentId: 'pay-001',
      idempotencyKey: 'idem-001',
      month: '2026-10',
      memberId: 'gaurav',
      amountPaise: 5000,
      method: 'UPI',
      upiReference: 'UPI-1234567890',
      recordedAt: new Date('2026-10-02T10:00:00.000Z'),
      recordedByRole: 'member',
      status: 'recorded',
    });

    // Record and void another payment
    await paymentRepo.create({
      paymentId: 'pay-002',
      idempotencyKey: 'idem-002',
      month: '2026-10',
      memberId: 'nikhil',
      amountPaise: 3000,
      method: 'UPI',
      upiReference: 'UPI-VOIDED-001',
      recordedAt: new Date('2026-10-03T10:00:00.000Z'),
      recordedByRole: 'member',
      status: 'recorded',
    });
    await paymentRepo.voidIfRecorded({
      paymentId: 'pay-002',
      voidedAt: new Date('2026-10-04T10:00:00.000Z'),
      voidedByRole: 'superadmin',
      voidReason: 'Accidental duplicate payment entry',
    });

    const exportData = await exportService.buildMonthlyReportExport('2026-10');
    assert.equal(exportData.summary.paidAmountPaise, 5000);
    assert.equal(exportData.members.gaurav.paidAmountPaise, 5000);
    assert.equal(exportData.members.nikhil.paidAmountPaise, 0);

    // Payments audit table contains both payments
    assert.equal(exportData.payments.length, 2);
    const voided = exportData.payments.find((p) => p.paymentId === 'pay-002');
    assert.equal(voided.status, 'voided');
    assert.equal(voided.isVoid, true);
  });

  test('Requirement 168, 169, 170: Reconciliation invariants verify daily sums equal member and room totals', async () => {
    // Create multiple days of varied activity
    await mealRepo.create({
      date: '2026-10-01',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'taking', devansh: 'skip' },
        night: { gaurav: 'taking', nikhil: 'taking', devansh: 'taking' },
      },
      changes: [],
    });

    await mealRepo.create({
      date: '2026-10-02',
      saved: true,
      revision: 1,
      meals: {
        morning: { gaurav: 'taking', nikhil: 'not_set', devansh: 'not_set' },
        night: { gaurav: 'not_set', nikhil: 'taking', devansh: 'skip' },
      },
      changes: [],
    });

    const exportData = await exportService.buildMonthlyReportExport('2026-10');

    // 1. Daily room sum equals room bill
    const dailyRoomSum = exportData.days.reduce((acc, d) => acc + d.dailyTotalPaise, 0);
    assert.equal(dailyRoomSum, exportData.summary.roomAmountPaise);

    // 2. Sum of member bills equals room bill
    const memberBillsSum = MEMBER_IDS.reduce((acc, id) => acc + exportData.members[id].billAmountPaise, 0);
    assert.equal(memberBillsSum, exportData.summary.roomAmountPaise);

    // 3. For each member: sum of daily rows equals member bill
    for (const id of MEMBER_IDS) {
      const mDaily = exportData.days.reduce((acc, d) => acc + d.members[id].dailyTotalPaise, 0);
      assert.equal(mDaily, exportData.members[id].billAmountPaise);
    }
  });

  test('Requirement 171: Multi-page 31-day populated activity generates PDF successfully without errors', async () => {
    // Populate all 15 past days in October
    for (let day = 1; day <= 15; day++) {
      const dateStr = `2026-10-${String(day).padStart(2, '0')}`;
      await mealRepo.create({
        date: dateStr,
        saved: true,
        revision: 1,
        meals: {
          morning: { gaurav: 'taking', nikhil: day % 2 === 0 ? 'taking' : 'skip', devansh: 'taking' },
          night: { gaurav: 'taking', nikhil: 'taking', devansh: day % 3 === 0 ? 'skip' : 'taking' },
        },
        changes: [],
      });
    }

    const pdfBuffer = await pdfService.generateMonthlyReportPdf('2026-10');
    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
    // Multi-page PDF is larger than 10KB
    assert.ok(pdfBuffer.length > 10000);
  });
});
