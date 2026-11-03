import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFinancialBoundaryService } from '../src/finance/financialBoundary.service.js';
import { createReportService } from '../src/reports/report.service.js';
import { createPaymentSummaryService } from '../src/payments/paymentSummary.service.js';
import { createPaymentService } from '../src/payments/payment.service.js';

function boundary(financialStartDate) {
  return createFinancialBoundaryService({ repository: {
    get: async () => financialStartDate ? {
      settingsId: 'system', financialStartDate, timezone: 'Asia/Kolkata', revision: 1,
    } : null,
  } });
}

test('unset boundary keeps historical reads available but blocks financial issuance', async () => {
  const service = boundary(null);
  assert.equal((await service.getFinancialBoundary()).financialStartDate, null);
  assert.equal(await service.isHistoricalViewOnly('2026-11-16'), true);
  await assert.rejects(service.assertOperationalFinancialDate('2026-11-16'),
    (error) => error.statusCode === 409 && error.details?.code === 'FINANCIAL_BOUNDARY_UNSET');
});

test('boundary is inclusive and a partially historical month has an operational subperiod', async () => {
  const service = boundary('2026-11-15');
  assert.equal(await service.isHistoricalViewOnly('2026-11-14'), true);
  assert.equal(await service.isHistoricalViewOnly('2026-11-15'), false);
  assert.equal(await service.isHistoricalViewOnly('2026-11-16'), false);
  await assert.rejects(service.assertOperationalFinancialDate('2026-11-14'), /historical/i);
  await service.assertOperationalFinancialDate('2026-11-15');
  assert.deepEqual(await service.getMonthScope('2026-11'), {
    month: '2026-11', kind: 'partial', historicalEndDate: '2026-11-14',
    operationalStartDate: '2026-11-15', operationalEndDate: '2026-11-30',
  });
  assert.equal((await service.getMonthScope('2026-10')).kind, 'historical');
  assert.equal((await service.getMonthScope('2026-12')).kind, 'operational');
  await assert.rejects(service.assertFullOperationalMonth('2026-11'), /partial/i);
  await service.assertFullOperationalMonth('2026-12');
});

test('imported boundary-day meal needs explicit manifest classification', async () => {
  const service = boundary('2026-11-15');
  assert.equal(await service.isOperationalMealDay({ date: '2026-11-14', schemaVersion: 3 }), false);
  assert.equal(await service.isOperationalMealDay({ date: '2026-11-15', calculationVersion: 'legacy-v2' }), false);
  assert.equal(await service.isOperationalMealDay({ date: '2026-11-15', calculationVersion: 'legacy-v2', financialClassification: 'operational' }), false);
  assert.equal(await service.isOperationalMealDay({ date: '2026-11-15', calculationVersion: 'legacy-v2', financialClassification: 'operational', cutoverClassificationSource: 'migration-manifest' }), true);
  assert.equal(await service.isOperationalMealDay({ date: '2026-11-15', schemaVersion: 3 }), true);
  assert.equal(await service.isOperationalMealDay({ date: '2026-11-15', schemaVersion: 3, importedFromLegacy: true }), false);
  assert.equal(await service.isOperationalMealDay({ date: '2026-11-15', schemaVersion: 3, importedFromLegacy: true,
    financialClassification: 'operational', cutoverClassificationSource: 'migration-manifest' }), true);
  assert.equal(await service.isOperationalMealDay({ date: '2026-11-16', calculationVersion: 'legacy-v2' }), true);
});

test('partial month keeps historical cost visible without creating historical debt', async () => {
  const days = ['2026-11-14', '2026-11-15', '2026-11-16'].map((date) => ({
    date, saved: true, schemaVersion: 3, participantOrder: ['student_fourth'],
    meals: { morning: { student_fourth: 'taking' }, night: { student_fourth: 'not_set' } },
    allocations: { morning: null, night: null },
  }));
  const reports = createReportService({
    meals: { getMonth: async () => ({ days }) },
    rates: { getRate: async () => ({ configured: true, morningPricePaise: 100, nightPricePaise: 100 }) },
    boundary: boundary('2026-11-15'),
    now: () => new Date('2026-12-01T12:00:00Z'),
  });
  const report = await reports.getMonthlyReport('2026-11');
  assert.equal(report.toDate.members.student_fourth.amountPaise, 300);
  assert.equal(report.operationalToDate.members.student_fourth.amountPaise, 200);
  const summary = await createPaymentSummaryService({ reports,
    repository: { findSummaryByMonth: async () => [] },
  }).getSummary('2026-11');
  assert.equal(summary.members.student_fourth.historicalMealCostPaise, 100);
  assert.equal(summary.members.student_fourth.operationalMessBillPaise, 200);
  assert.equal(summary.members.student_fourth.operationalMessRemainingPaise, 200);
  assert.equal(summary.members.student_fourth.billAmountPaise, 200);
});

test('pre-cutover meal cost produces zero live Mess liability without fake payment', async () => {
  const reports = createReportService({
    meals: { getMonth: async () => ({ days: [{ date: '2026-10-10', saved: true, schemaVersion: 3,
      participantOrder: ['student_fourth'], meals: { morning: { student_fourth: 'taking' }, night: {} },
      allocations: { morning: null, night: null } }] }) },
    rates: { getRate: async () => ({ configured: true, morningPricePaise: 2500, nightPricePaise: 2500 }) },
    boundary: boundary('2026-11-15'), now: () => new Date('2026-12-01T12:00:00Z'),
  });
  const summary = await createPaymentSummaryService({ reports,
    repository: { findSummaryByMonth: async () => [] } }).getSummary('2026-10');
  assert.equal(summary.members.student_fourth.historicalMealCostPaise, 2500);
  assert.equal(summary.members.student_fourth.operationalMessBillPaise, 0);
  assert.equal(summary.members.student_fourth.operationalMessRemainingPaise, 0);
  assert.equal(summary.members.student_fourth.paidAmountPaise, 0);
});

test('fourth student can prepare operational payment but historical month is blocked', async () => {
  const service = createPaymentService({
    boundary: boundary('2026-11-15'),
    students: { assertKnown: async (id) => id === 'student_fourth' ? { studentId: id, status: 'ACTIVE' } : null },
    summaries: { getSummary: async () => ({ periodType: 'past', ratesConfigured: true,
      members: { student_fourth: { remainingAmountPaise: 200, status: 'pending' } } }) },
    settings: { getSettings: async () => ({ configured: true, receiverName: 'Payee', upiId: 'payee@upi', receiverMobile: null }) },
  });
  await assert.rejects(service.preparePayment({ month: '2026-10', memberId: 'student_fourth' }),
    (error) => error.statusCode === 409);
  const intent = await service.preparePayment({ month: '2026-11', memberId: 'student_fourth' });
  assert.equal(intent.amountPaise, 200);
  await assert.rejects(service.preparePayment({ month: '2026-11', memberId: 'student_fourth',
    actorRole: 'member', actorMemberId: 'gaurav' }), (error) => error.statusCode === 403);
  await assert.rejects(service.preparePayment({ month: '2026-11', memberId: 'ghost' }),
    (error) => error.statusCode === 404);
});
