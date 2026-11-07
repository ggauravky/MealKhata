import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateBillingSummary } from '../src/reports/billing.service.js';
import { createPaymentSummaryService } from '../src/payments/paymentSummary.service.js';
import { createSettlementService } from '../src/settlement/settlement.service.js';
import { MonthlySettlement } from '../src/settlement/monthlySettlement.model.js';
import { serializeSettlement } from '../src/settlement/monthlySettlement.serializer.js';
import { createFinancialOverviewService } from '../src/finance/financialOverview.service.js';
import { createMonthlyFinancialReportService } from '../src/finance/monthlyFinancialReport.service.js';
import { createMonthlyReportExportService } from '../src/reports/monthlyReportExport.service.js';
import { createMonthlyReportPdfService } from '../src/reports/monthlyReportPdf.service.js';
import { createReportService } from '../src/reports/report.service.js';
import { createMonthMealService } from '../src/calendar/monthMeal.service.js';
import { createDashboardService } from '../src/dashboard/dashboard.service.js';
import { financialPdfMemberRows } from '../src/finance/monthlyFinancialPdf.service.js';
import { generateSettlementCsv } from '../src/settlement/statementCsv.service.js';

const fourth = 'student_0123456789abcdef0123456789abcdef';

function day(date, ids, morningAmounts, { version = 'legacy-v2' } = {}) {
  const members = Object.fromEntries(ids.map((id) => [id, {
    morningAmountPaise: morningAmounts[id] ?? 0,
    nightAmountPaise: 0,
    totalAmountPaise: morningAmounts[id] ?? 0,
  }]));
  const roomAmount = Object.values(morningAmounts).reduce((sum, amount) => sum + amount, 0);
  return {
    date, saved: true, calculationVersion: version, participantOrder: ids,
    meals: { morning: Object.fromEntries(ids.map((id) => [id, 'taking'])), night: {} },
    allocations: {
      morning: { shareUnits: Object.fromEntries(ids.map((id) => [id, 6])), cost: {
        members: Object.fromEntries(ids.map((id) => [id, { shareUnits: 6, amountPaise: morningAmounts[id] ?? 0 }])),
        physicalPlates: ids.length, roomAmountPaise: roomAmount,
      } },
      night: { shareUnits: {}, cost: { members: {}, physicalPlates: 0, roomAmountPaise: 0 } },
    },
    dailyCostSummary: { members, room: { morningAmountPaise: roomAmount, nightAmountPaise: 0, totalAmountPaise: roomAmount } },
  };
}

test('billing includes a fourth historical participant and uses authoritative paise', () => {
  const summary = calculateBillingSummary([day('2026-09-01', ['gaurav', fourth], { gaurav: 101, [fourth]: 99 })]);
  assert.equal(summary.members[fourth].amountPaise, 99);
  assert.equal(summary.room.amountPaise, 200);
  assert.equal(Object.values(summary.members).reduce((sum, member) => sum + member.amountPaise, 0), 200);
});

test('billing handles zero, one, three, four, and many students across a mid-month join', () => {
  assert.deepEqual(Object.keys(calculateBillingSummary([]).members), []);
  const ids = ['gaurav', 'nikhil', 'devansh', fourth, 'student_11111111111111111111111111111111', 'student_22222222222222222222222222222222'];
  for (const count of [1, 3, 4, 6]) {
    const roster = ids.slice(0, count);
    const summary = calculateBillingSummary([day('2026-09-01', roster, {}, { version: 'v3' })],
      { morningPricePaise: 101, nightPricePaise: 100 });
    assert.equal(Object.keys(summary.members).length, count);
    assert.equal(summary.room.morningPhysicalPlates, count);
    assert.equal(Object.values(summary.members).reduce((sum, member) => sum + member.amountPaise, 0), summary.room.amountPaise);
  }
  const joined = calculateBillingSummary([
    day('2026-09-01', ids.slice(0, 3), {}, { version: 'v3' }),
    day('2026-09-02', ids.slice(0, 4), {}, { version: 'v3' }),
  ], { morningPricePaise: 101, nightPricePaise: 100 });
  assert.equal(joined.members[fourth].morningParticipationCount, 1);
  assert.equal(joined.room.amountPaise, 707);
});

test('billing fails closed on a one-paisa daily mismatch with the affected date', () => {
  const corrupt = day('2026-09-02', [fourth], { [fourth]: 100 });
  corrupt.dailyCostSummary.room.totalAmountPaise = 101;
  assert.throws(() => calculateBillingSummary([corrupt]), /2026-09-02/);
});

test('billing rejects an unsafe student key in saved report data', () => {
  const corrupt = day('2026-09-03', [fourth], { [fourth]: 100 });
  corrupt.participantOrder = ['__proto__'];
  assert.throws(() => calculateBillingSummary([corrupt]), /2026-09-03/);
});

test('payment summary includes fourth and archived students and rejects unknown payments', async () => {
  const report = { periodType: 'past', today: '2026-10-01', rates: { configured: true },
    toDate: { members: { [fourth]: { amountPaise: 200 } }, room: { amountPaise: 200 } },
    projection: { members: { [fourth]: { amountPaise: 200, displayName: 'Fourth Student' } }, room: { amountPaise: 200 } } };
  let records = [{ memberId: fourth, status: 'recorded', amountPaise: 50 }];
  const service = createPaymentSummaryService({ reports: { getMonthlyReport: async () => report }, repository: { findSummaryByMonth: async () => records } });
  const summary = await service.getSummary('2026-09');
  assert.equal(summary.members[fourth].remainingAmountPaise, 150);
  assert.equal(summary.members[fourth].displayName, 'Fourth Student');
  records = [{ memberId: 'unknown_student', status: 'recorded', amountPaise: 1 }];
  await assert.rejects(service.getSummary('2026-09'), /unknown_student/);
  records = [{ memberId: 'unknown_student', status: 'voided', amountPaise: 1 }];
  await assert.rejects(service.getSummary('2026-09'), /unknown_student/);
});

test('settlement closure checks fourth student and writes a dynamic versioned snapshot', async () => {
  const report = { periodType: 'past', rates: { configured: true, morningPricePaise: 100, nightPricePaise: 100 },
    toDate: { members: { [fourth]: { amountPaise: 200, morningParticipationCount: 1, morningShareUnits: 6 } }, room: { amountPaise: 200, morningPhysicalPlates: 1 } },
    pricingAdjustments: [] };
  let paid = 0;
  let stored;
  const service = createSettlementService({
    reports: { getMonthlyReport: async () => report },
    summaries: { getSummary: async () => ({ members: { [fourth]: { paidAmountPaise: paid, remainingAmountPaise: 200 - paid, overpaidAmountPaise: 0 } }, room: { paidAmountPaise: paid } }) },
    students: { listAll: async () => [{ studentId: fourth, displayName: 'Fourth Student', status: 'ARCHIVED' }] },
    repository: { findActiveByMonth: async () => null, findLatestByMonth: async () => null, createSettlement: async (value) => (stored = value) },
  });
  const status = await service.getSettlementStatus('2026-09');
  assert.equal(status.canClose, false);
  assert.equal(status.blockers[0].memberId, fourth);
  paid = 200;
  await service.closeMonth({ month: '2026-09' });
  assert.equal(stored.snapshotVersion, 3);
  assert.deepEqual(stored.snapshot.studentIds, [fourth]);
  assert.equal(stored.snapshot.members[fourth].billAmountPaise, 200);
  assert.equal(stored.snapshot.members[fourth].displayName, 'Fourth Student');
});

test('version 3 settlement validates and serializes dynamic member maps', async () => {
  const doc = new MonthlySettlement({
    settlementId: 'test-dynamic-settlement', month: '2026-09', sequence: 1,
    snapshotVersion: 3, closedAt: new Date('2026-10-01'), closedByRole: 'superadmin',
    snapshot: { studentIds: [fourth], rates: { morningPricePaise: 100, nightPricePaise: 100 },
      members: { [fourth]: { billAmountPaise: 100, paidAmountPaise: 100 } },
      room: { billAmountPaise: 100, paidAmountPaise: 100 }, pricingAdjustments: [] },
  });
  await doc.validate();
  assert.equal(serializeSettlement(doc).snapshot.members[fourth].billAmountPaise, 100);
  doc.snapshot.studentIds = ['gaurav'];
  await assert.rejects(doc.validate(), /studentIds/);
});

test('household financial overview includes a fourth student with Mess dues', async () => {
  const laterStudent = 'student_33333333333333333333333333333333';
  const service = createFinancialOverviewService({
    paymentSummaries: { getSummary: async () => ({ members: { [fourth]: {
      billAmountPaise: 200, paidAmountPaise: 50, remainingAmountPaise: 150, overpaidAmountPaise: 0, status: 'partial',
    } }, room: { billAmountPaise: 200, paidAmountPaise: 50, remainingAmountPaise: 150 } }) },
    settlements: { isMonthClosed: async () => false, getActiveSettlement: async () => null },
    roomFees: { getMemberOverview: async () => ({}), getMonthlySummary: async () => ({ totalBilledPaise: 0, totalCollectedPaise: 0, totalOutstandingPaise: 0, members: [] }) },
    expenses: { getMemberExpenseSummary: async () => ({}), listExpensesByMonth: async () => [], getHouseholdExpenseSummary: async () => ({}) },
    students: { listAll: async () => [{ studentId: fourth, displayName: 'Fourth Student' }, { studentId: laterStudent, displayName: 'Later Student' }],
      assertKnown: async (studentId) => ({ studentId, displayName: studentId === fourth ? 'Fourth Student' : 'Later Student' }) },
    now: () => new Date('2026-10-01'),
  });
  const result = await service.getHouseholdFinancialOverview({ month: '2026-09', actorRole: 'admin' });
  assert.equal(result.memberSummaries[fourth].mess.remainingPaise, 150);
  assert.equal(result.memberSummaries[fourth].member.displayName, 'Fourth Student');
  assert.equal(result.memberSummaries[laterStudent], undefined);
});

test('private monthly financial report accepts a known fourth student', async () => {
  const service = createMonthlyFinancialReportService({
    overviewService: { getMemberFinancialOverview: async ({ memberId }) => ({ member: { memberId } }) },
    expenseService: { listExpensesByMonth: async () => [] },
    roomFees: { getMemberOverview: async () => ({}) },
  });
  const result = await service.getMemberReportData(fourth, '2026-09');
  assert.equal(result.memberId, fourth);
});

test('monthly export includes archived fourth student and exact historical cost', async () => {
  const roster = ['gaurav', 'nikhil', 'devansh', fourth];
  const amounts = { gaurav: 100, nikhil: 100, devansh: 100, [fourth]: 101 };
  const historicalDay = day('2026-09-01', roster, amounts);
  const total = calculateBillingSummary([historicalDay]);
  const report = { month: '2026-09', periodType: 'past', today: '2026-10-01',
    rates: { configured: true, morningPricePaise: 100, nightPricePaise: 100 },
    toDate: total, projection: total, pricingAdjustments: [] };
  const service = createMonthlyReportExportService({
    meals: { getMonth: async () => ({ days: [historicalDay] }) },
    reports: { getMonthlyReport: async () => report },
    summaries: { getSummary: async () => ({ members: Object.fromEntries(roster.map((id) => [id, {
      billAmountPaise: amounts[id], paidAmountPaise: 0, remainingAmountPaise: amounts[id], status: 'pending',
    }])), room: { billAmountPaise: 401, paidAmountPaise: 0, remainingAmountPaise: 401, status: 'pending' } }) },
    payments: { findHistoryByMonth: async () => [] },
    settlements: { getActiveSettlement: async () => null },
    rates: { getRate: async () => ({ morningPricePaise: 100, nightPricePaise: 100 }) },
    students: { listAll: async () => [{ studentId: fourth, displayName: 'Fourth Student', status: 'ARCHIVED' }] },
    now: () => new Date('2026-10-01T12:00:00Z'),
  });
  const result = await service.buildMonthlyReportExport('2026-09');
  assert.equal(result.members[fourth].memberName, 'Fourth Student');
  assert.equal(result.days[0].members[fourth].dailyTotalPaise, 101);
  assert.equal(result.summary.roomAmountPaise, 401);
  assert.equal(Object.keys(result.members).length, 4);
  const pdf = await createMonthlyReportPdfService({ exportService: { buildMonthlyReportExport: async () => result } })
    .generateMonthlyReportPdf('2026-09');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const large = structuredClone(result);
  for (let index = 0; index < 30; index += 1) {
    large.members[`student_${String(index).padStart(32, '0')}`] = {
      ...result.members[fourth], memberName: `Student ${index}`,
    };
  }
  const largePdf = await createMonthlyReportPdfService({ exportService: { buildMonthlyReportExport: async () => large } })
    .generateMonthlyReportPdf('2026-09');
  const pageCount = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(pageCount(largePdf) > pageCount(pdf));
});

test('settlement CSV includes fourth student and preserved display name', () => {
  const csv = generateSettlementCsv({ month: '2026-09', settlementId: 's', sequence: 1, status: 'closed',
    snapshot: { rates: { morningPricePaise: 100, nightPricePaise: 100 },
      members: { [fourth]: { displayName: 'Fourth Student', billAmountPaise: 101, paidAmountPaise: 101, remainingAmountPaise: 0 } },
      room: { billAmountPaise: 101, paidAmountPaise: 101 } } });
  assert.match(csv, /Fourth Student/);
  assert.match(csv, new RegExp(fourth));
});

test('monthly API report labels a fourth archived historical student', async () => {
  const historicalDay = day('2026-09-01', [fourth], { [fourth]: 101 });
  const service = createReportService({
    meals: { getMonth: async () => ({ days: [historicalDay] }) },
    rates: { getRate: async () => ({ configured: true, morningPricePaise: 100, nightPricePaise: 100 }) },
    students: { listAll: async () => [{ studentId: fourth, displayName: 'Fourth Student', status: 'ARCHIVED' }] },
    now: () => new Date('2026-10-01T12:00:00Z'),
  });
  const result = await service.getMonthlyReport('2026-09');
  assert.equal(result.toDate.members[fourth].displayName, 'Fourth Student');
});

test('monthly report fails closed when a saved historical day lacks its snapshot', async () => {
  const legacy = { date: '2026-09-09', revision: 1, meals: { morning: { gaurav: 'taking' }, night: {} } };
  const service = createReportService({
    meals: createMonthMealService({
      repository: { findInDateRange: async () => [legacy] },
      snapshots: { findByDateAndVersion: async () => null },
      corrections: { listByDate: async () => [] },
      students: { listEligibleOn: async () => [] },
      runtimeProfile: 'v3',
    }),
    rates: { getRate: async () => ({ configured: true, morningPricePaise: 100, nightPricePaise: 100 }) },
    now: () => new Date('2026-10-01T12:00:00Z'),
  });
  await assert.rejects(service.getMonthlyReport('2026-09'), /2026-09-09/);
});

test('dashboard household today includes a fourth active student', async () => {
  const today = day('2026-10-01', [fourth], { [fourth]: 100 }, { version: 'v3' });
  const service = createDashboardService({
    mealService: { getDay: async () => today },
    reportService: { getMonthlyReport: async () => ({ toDate: { members: {}, room: {} }, projection: { members: {}, room: {} } }) },
    paymentSummaryService: { getSummary: async () => ({ members: {}, room: {} }) },
    settlementService: { getSettlementStatus: async () => ({ state: 'not_ready', blockers: [] }) },
    reminderSettingsService: { getSettings: async () => ({ reminders: {} }) },
    students: { listCurrent: async () => [{ studentId: fourth, displayName: 'Fourth Student' }] },
    now: () => new Date('2026-10-01T05:00:00Z'),
  });
  const result = await service.getDashboardSummary({ auth: { role: 'admin' } });
  assert.equal(result.householdToday.members[0].memberId, fourth);
  assert.equal(result.householdToday.members[0].name, 'Fourth Student');
});

test('dashboard today uses verified historical cost instead of current price', async () => {
  const today = day('2026-10-01', [fourth], { [fourth]: 101 });
  const service = createDashboardService({
    mealService: { getDay: async () => today },
    reportService: { getMonthlyReport: async () => ({ toDate: { members: {}, room: {} }, projection: { members: {}, room: {} } }) },
    paymentSummaryService: { getSummary: async () => ({ members: {}, room: {} }) },
    settlementService: { getSettlementStatus: async () => ({ state: 'not_ready', blockers: [] }) },
    reminderSettingsService: { getSettings: async () => ({ reminders: {} }) },
    students: { listCurrent: async () => [{ studentId: fourth, displayName: 'Fourth Student' }] },
    now: () => new Date('2026-10-01T05:00:00Z'),
  });
  const result = await service.getDashboardSummary({ auth: { role: 'member', memberId: fourth, displayName: 'Fourth Student' } });
  assert.equal(result.personalHero.totalCostPaise, 101);
});

test('dashboard retains meal data when student labels are temporarily unavailable', async () => {
  const today = day('2026-10-01', [fourth], { [fourth]: 100 }, { version: 'v3' });
  const service = createDashboardService({
    mealService: { getDay: async () => today },
    reportService: { getMonthlyReport: async () => ({ toDate: { members: {}, room: {} }, projection: { members: {}, room: {} } }) },
    paymentSummaryService: { getSummary: async () => ({ members: {}, room: {} }) },
    settlementService: { getSettlementStatus: async () => ({ state: 'not_ready', blockers: [] }) },
    reminderSettingsService: { getSettings: async () => ({ reminders: {} }) },
    students: { listCurrent: async () => { throw new Error('Students unavailable'); } },
    now: () => new Date('2026-10-01T05:00:00Z'),
  });
  const result = await service.getDashboardSummary({ auth: { role: 'admin' } });
  assert.equal(result.householdToday.members[0].memberId, fourth);
  assert.equal(result.errors.students, 'Failed to fetch students');
});

test('financial PDF row data includes a fourth student with its display name', () => {
  const rows = financialPdfMemberRows({ memberSummaries: { [fourth]: {
    member: { memberId: fourth, displayName: 'Fourth Student' }, mess: { billPaise: 101 },
  } } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Fourth Student');
  assert.equal(rows[0].summary.mess.billPaise, 101);
});
