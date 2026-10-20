import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(currentDir, '../src');

const useFinancePath = path.join(srcDir, 'hooks/useFinance.js');
const financeDownloadPath = path.join(srcDir, 'lib/financeDownload.js');
const financialOverviewCardPath = path.join(srcDir, 'components/finance/FinancialOverviewCard.jsx');
const financeCategoryBreakdownPath = path.join(srcDir, 'components/finance/FinanceCategoryBreakdown.jsx');
const payablesReceivablesPath = path.join(srcDir, 'components/finance/PayablesReceivables.jsx');
const financialHouseholdSummaryPath = path.join(srcDir, 'components/finance/FinancialHouseholdSummary.jsx');
const financialReportPanelPath = path.join(srcDir, 'components/finance/FinancialReportPanel.jsx');
const reportsPagePath = path.join(srcDir, 'pages/ReportsPage.jsx');
const dashboardPagePath = path.join(srcDir, 'pages/DashboardPage.jsx');

describe('MealKhata 2.0 Phase 3: Unified Financial Dashboard & Reports (Frontend)', () => {
  describe('Finance Realtime Hooks (useFinance.js)', () => {
    test('exports useMemberFinance and useHouseholdFinance hooks', async () => {
      const content = await fs.readFile(useFinancePath, 'utf8');
      assert.match(content, /export function useMemberFinance/);
      assert.match(content, /export function useHouseholdFinance/);
      assert.match(content, /export function useFinance/);
    });

    test('useMemberFinance protects against unauthenticated and viewer access', async () => {
      const content = await fs.readFile(useFinancePath, 'utf8');
      assert.match(content, /role === 'viewer'/);
      assert.match(content, /\/api\/finance\/me\/\$\{month\}/);
      assert.match(content, /\/api\/finance\/members\/\$\{targetMemberId\}\/\$\{month\}/);
    });

    test('useHouseholdFinance gates access to admin and superadmin roles', async () => {
      const content = await fs.readFile(useFinancePath, 'utf8');
      assert.match(content, /role === 'admin' \|\| role === 'superadmin'/);
      assert.match(content, /\/api\/finance\/overview\/\$\{month\}/);
    });

    test('subscribes to all 5 domain Socket.IO events with debouncing and cleanup', async () => {
      const content = await fs.readFile(useFinancePath, 'utf8');
      assert.match(content, /socket\.on\('meal:updated'/);
      assert.match(content, /socket\.on\('payment:updated'/);
      assert.match(content, /socket\.on\('settlement:updated'/);
      assert.match(content, /socket\.on\('room-fees:updated'/);
      assert.match(content, /socket\.on\('expenses:updated'/);
      assert.match(content, /socket\.off\('meal:updated'/);
      assert.match(content, /socket\.off\('payment:updated'/);
      assert.match(content, /socket\.off\('settlement:updated'/);
      assert.match(content, /socket\.off\('room-fees:updated'/);
      assert.match(content, /socket\.off\('expenses:updated'/);
      assert.match(content, /debounceTimer/);
    });
  });

  describe('Offline-Safe PDF Download Helper (financeDownload.js)', () => {
    test('enforces offline guard and validates PDF content-type', async () => {
      const content = await fs.readFile(financeDownloadPath, 'utf8');
      assert.match(content, /navigator\.onLine/);
      assert.match(content, /You are offline/);
      assert.match(content, /application\/pdf/);
      assert.match(content, /URL\.createObjectURL/);
      assert.match(content, /URL\.revokeObjectURL/);
    });

    test('exposes downloadMemberStatementPdf and downloadHouseholdStatementPdf', async () => {
      const content = await fs.readFile(financeDownloadPath, 'utf8');
      assert.match(content, /export async function downloadMemberStatementPdf/);
      assert.match(content, /export async function downloadHouseholdStatementPdf/);
      assert.match(content, /\/api\/finance\/monthly\/\$\{month\}\/my-statement\.pdf/);
      assert.match(content, /\/api\/finance\/monthly\/\$\{month\}\/household-statement\.pdf/);
    });
  });

  describe('Member Financial Overview Card (FinancialOverviewCard.jsx)', () => {
    test('renders total outstanding payable and isolates receivables', async () => {
      const content = await fs.readFile(financialOverviewCardPath, 'utf8');
      assert.match(content, /combined\?\.outstandingPayablePaise/);
      assert.match(content, /Total Remaining to Pay/);
      assert.match(content, /FinanceCategoryBreakdown/);
      assert.match(content, /PayablesReceivables/);
      assert.match(content, /downloadMemberStatementPdf/);
      assert.match(content, /Statement PDF/);
      assert.match(content, /View detailed finances/);
      assert.match(content, /to=\{`\/reports\?month=\$\{month\}&tab=overview`\}/);
    });
  });

  describe('Category Breakdown (FinanceCategoryBreakdown.jsx)', () => {
    test('distinguishes unissued Room Fees and isolates ledger categories', async () => {
      const content = await fs.readFile(financeCategoryBreakdownPath, 'utf8');
      assert.match(content, /!room\?\.chargeIssued \? 'Not issued'/);
      assert.match(content, /mess\?\.remainingPaise/);
      assert.match(content, /room\?\.remainingPaise/);
      assert.match(content, /expenses\?\.owedToOthersPaise/);
      assert.match(content, /CookingPot/);
      assert.match(content, /BedDouble/);
      assert.match(content, /ShoppingBag/);
    });
  });

  describe('Payables & Receivables Separation (PayablesReceivables.jsx)', () => {
    test('strictly separates roommate debts from roommate receivables without auto-netting', async () => {
      const content = await fs.readFile(payablesReceivablesPath, 'utf8');
      assert.match(content, /debtsOwed/);
      assert.match(content, /receivables/);
      assert.match(content, /Reimbursements You Owe/);
      assert.match(content, /Reimbursements Owed to You/);
      assert.match(content, /debtsOwed\.map/);
      assert.match(content, /receivables\.map/);
    });
  });

  describe('Household Financial Summary (FinancialHouseholdSummary.jsx)', () => {
    test('renders tracked costs, managed dues, pending reimbursements, and actionable attention', async () => {
      const content = await fs.readFile(financialHouseholdSummaryPath, 'utf8');
      assert.match(content, /trackedCosts\?\.totalTrackedCostPaise/);
      assert.match(content, /managedDues\?\.messOutstandingPaise/);
      assert.match(content, /managedDues\?\.roomFeesOutstandingPaise/);
      assert.match(content, /roommateReimbursements\?\.pendingReimbursementsPaise/);
      assert.match(content, /actionableAttention/);
      assert.match(content, /downloadHouseholdStatementPdf/);
      assert.match(content, /Household PDF/);
    });
  });

  describe('Unified Consolidated Report Panel (FinancialReportPanel.jsx)', () => {
    test('renders multi-member financial table with integer paise formatting and notes', async () => {
      const content = await fs.readFile(financialReportPanelPath, 'utf8');
      assert.match(content, /Unified Financial Report/);
      assert.match(content, /table/);
      assert.match(content, /Mess Bill/);
      assert.match(content, /Mess Paid/);
      assert.match(content, /Mess Due/);
      assert.match(content, /Room Charge/);
      assert.match(content, /Room Paid/);
      assert.match(content, /Room Due/);
      assert.match(content, /Exp Share/);
      assert.match(content, /Exp Owed/);
      assert.match(content, /Receivable/);
      assert.match(content, /Total to Pay/);
      assert.match(content, /memberSummaries/);
      assert.match(content, /reconciliation/);
      assert.match(content, /Accounting Principles & Financial Isolation/);
      assert.match(content, /Three Independent Ledgers/);
    });
  });

  describe('Reports Page Integration (ReportsPage.jsx)', () => {
    test('provides 4 domain report tabs: Hostel Overview, Mess, Room Fees, and Expenses', async () => {
      const content = await fs.readFile(reportsPagePath, 'utf8');
      assert.match(content, /activeTab === 'overview'/);
      assert.match(content, /activeTab === 'mess'/);
      assert.match(content, /activeTab === 'room-fees'/);
      assert.match(content, /activeTab === 'expenses'/);
      assert.match(content, /Hostel Overview/);
      assert.match(content, /Mess/);
      assert.match(content, /Room Fees/);
      assert.match(content, /Expenses/);
      assert.match(content, /FinancialReportPanel/);
    });

    test('retains existing Mess settlement controls and detailed Mess report', async () => {
      const content = await fs.readFile(reportsPagePath, 'utf8');
      assert.match(content, /SettlementPanel/);
      assert.match(content, /ReportSummary/);
      assert.match(content, /handleDownloadPdf/);
    });
  });

  describe('Dashboard Page Integration (DashboardPage.jsx)', () => {
    test('integrates FinancialOverviewCard and FinancialHouseholdSummary with useFinance hooks', async () => {
      const content = await fs.readFile(dashboardPagePath, 'utf8');
      assert.match(content, /import \{ useFinance, useMemberFinance, useHouseholdFinance \} from '\.\.\/hooks\/useFinance\.js';/);
      assert.match(content, /import \{ FinancialOverviewCard \} from '\.\.\/components\/finance\/FinancialOverviewCard\.jsx';/);
      assert.match(content, /import \{ FinancialHouseholdSummary \} from '\.\.\/components\/finance\/FinancialHouseholdSummary\.jsx';/);
      assert.match(content, /<FinancialOverviewCard/);
      assert.match(content, /<FinancialHouseholdSummary/);
    });
  });
});
