import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

describe('MealKhata 2.0 Phase 2: Other Expenses & Shared Spending (Frontend)', () => {
  describe('Navigation & Routing Structure', () => {
    test('NAV_ITEMS contains 6 top-level items including Expenses', async () => {
      const constantsContent = await fs.readFile(path.join(srcDir, 'lib/constants.js'), 'utf8');
      assert.match(constantsContent, /\{\s*label:\s*'Home',\s*path:\s*'\/'\s*\}/);
      assert.match(constantsContent, /\{\s*label:\s*'Mess',\s*path:\s*'\/calendar'\s*\}/);
      assert.match(constantsContent, /\{\s*label:\s*'Room Fees',\s*path:\s*'\/room-fees'\s*\}/);
      assert.match(constantsContent, /\{\s*label:\s*'Expenses',\s*path:\s*'\/expenses'\s*\}/);
      assert.match(constantsContent, /\{\s*label:\s*'Payments',\s*path:\s*'\/payments'\s*\}/);
      assert.match(constantsContent, /\{\s*label:\s*'Reports',\s*path:\s*'\/reports'\s*\}/);
    });

    test('EXPENSE_CATEGORIES defines 6 stable categories with semantic configs', async () => {
      const constantsContent = await fs.readFile(path.join(srcDir, 'lib/constants.js'), 'utf8');
      assert.match(constantsContent, /'groceries'/);
      assert.match(constantsContent, /'snacks'/);
      assert.match(constantsContent, /'outside_food'/);
      assert.match(constantsContent, /'household_supplies'/);
      assert.match(constantsContent, /'utilities'/);
      assert.match(constantsContent, /'other'/);
      assert.match(constantsContent, /EXPENSE_CATEGORY_CONFIG/);
      assert.match(constantsContent, /SPLIT_TYPES/);
    });

    test('MobileNav renders clean 5-item bottom bar with Expenses and More menu containing Payments and Expense Admin', async () => {
      const mobileNav = await fs.readFile(path.join(srcDir, 'components/layout/MobileNav.jsx'), 'utf8');
      assert.match(mobileNav, /grid-cols-5/);
      assert.match(mobileNav, /label:\s*'Expenses',\s*path:\s*'\/expenses'/);
      assert.match(mobileNav, /Receipt/);
      assert.match(mobileNav, /MoreHorizontal/);
      // More exposes Payments, Reports, Expense Admin, Room Fee Admin, Mess Admin Panel
      assert.match(mobileNav, /\/payments/);
      assert.match(mobileNav, /\/reports/);
      assert.match(mobileNav, /\/admin\/expenses/);
      assert.match(mobileNav, /\/admin\/room-fees/);
      assert.match(mobileNav, /\/admin/);
    });

    test('AccountMenu renders Expense Admin link for authorized administrators', async () => {
      const accountMenu = await fs.readFile(path.join(srcDir, 'components/layout/AccountMenu.jsx'), 'utf8');
      assert.match(accountMenu, /to="\/admin\/expenses"/);
      assert.match(accountMenu, /Expense admin/);
    });

    test('App.jsx configures lazy routes for /expenses and protected /admin/expenses', async () => {
      const appContent = await fs.readFile(path.join(srcDir, 'App.jsx'), 'utf8');
      assert.match(appContent, /lazy\(\(\)\s*=>\s*import\('\.\/pages\/ExpensesPage\.jsx'\)/);
      assert.match(appContent, /lazy\(\(\)\s*=>\s*import\('\.\/pages\/AdminExpensesPage\.jsx'\)/);
      assert.match(appContent, /<Route path="expenses" element={<ExpensesPage \/>} \/>/);
      assert.match(appContent, /<Route path="admin\/expenses" element={<AdminExpensesPage \/>} \/>/);
    });
  });

  describe('Payments Page Integration (Section 33)', () => {
    test('PaymentsPage contains 3 tabs: Mess, Room Fees, and Expenses', async () => {
      const paymentsPage = await fs.readFile(path.join(srcDir, 'pages/PaymentsPage.jsx'), 'utf8');
      assert.match(paymentsPage, /grid-cols-3/);
      assert.match(paymentsPage, /<TabsTrigger value="mess"/);
      assert.match(paymentsPage, /<TabsTrigger value="room"/);
      assert.match(paymentsPage, /<TabsTrigger value="expenses"/);
      assert.match(paymentsPage, /<TabsContent value="expenses"/);
      assert.match(paymentsPage, /<ExpensesPaymentTab month=\{month\} \/>/);
    });

    test('ExpensesPaymentTab renders pending reimbursements and confirmed history independently of Mess/Room', async () => {
      const tabContent = await fs.readFile(path.join(srcDir, 'components/expenses/ExpensesPaymentTab.jsx'), 'utf8');
      assert.match(tabContent, /Pending Reimbursements/);
      assert.match(tabContent, /Confirmed Reimbursements/);
      assert.match(tabContent, /useExpenseSummary/);
      assert.match(tabContent, /useExpenses/);
      assert.match(tabContent, /useExpenseReimbursements/);
      assert.match(tabContent, /formatPaise/);
    });
  });

  describe('Dashboard Integration (Section 35)', () => {
    test('DashboardPage renders DashboardExpenseCard preview', async () => {
      const dashboard = await fs.readFile(path.join(srcDir, 'pages/DashboardPage.jsx'), 'utf8');
      assert.match(dashboard, /DashboardExpenseCard/);
      assert.match(dashboard, /<DashboardExpenseCard month=\{/);
    });

    test('DashboardExpenseCard renders role-aware metrics and link to /expenses', async () => {
      const card = await fs.readFile(path.join(srcDir, 'components/dashboard/DashboardExpenseCard.jsx'), 'utf8');
      assert.match(card, /My share/);
      assert.match(card, /I owe/);
      assert.match(card, /Owed to me/);
      assert.match(card, /to="\/expenses"/);
      assert.match(card, /to="\/admin\/expenses"/);
    });
  });

  describe('Expenses Page & Core Components', () => {
    test('ExpensesPage integrates category filtering, month navigation, and empty states', async () => {
      const page = await fs.readFile(path.join(srcDir, 'pages/ExpensesPage.jsx'), 'utf8');
      assert.match(page, /ExpenseOverviewCard/);
      assert.match(page, /ExpenseCategoryFilter/);
      assert.match(page, /ExpenseList/);
      assert.match(page, /AddExpenseDialog/);
      assert.match(page, /ExpenseDetailsDialog/);
      assert.match(page, /useExpenses/);
      assert.match(page, /useExpenseSummary/);
    });

    test('ExpenseCard renders category badge, payer label, and clear settlement status', async () => {
      const card = await fs.readFile(path.join(srcDir, 'components/expenses/ExpenseCard.jsx'), 'utf8');
      assert.match(card, /Fully reimbursed/);
      assert.match(card, /Partially reimbursed/);
      assert.match(card, /Not reimbursed/);
      assert.match(card, /Personal/);
      assert.match(card, /Voided/);
      assert.match(card, /Paid by/);
    });

    test('AddExpenseDialog supports Equal, Personal, and Custom splits with live preview', async () => {
      const dialog = await fs.readFile(path.join(srcDir, 'components/expenses/AddExpenseDialog.jsx'), 'utf8');
      assert.match(dialog, /Equal Split/);
      assert.match(dialog, /Personal/);
      assert.match(dialog, /Custom/);
      assert.match(dialog, /ExpenseSplitPreview/);
      assert.match(dialog, /paymentRupeesToPaise/);
      assert.match(dialog, /crypto\.randomUUID\(\)/); // Idempotency
      assert.match(dialog, /\/api\/expenses\/preview/);
    });

    test('RecordReimbursementDialog enforces max allowed debt and repayment directions', async () => {
      const dialog = await fs.readFile(path.join(srcDir, 'components/expenses/RecordReimbursementDialog.jsx'), 'utf8');
      assert.match(dialog, /maxAllowedPaise/);
      assert.match(dialog, /Amount cannot exceed outstanding debt/);
      assert.match(dialog, /paymentRupeesToPaise/);
      assert.match(dialog, /crypto\.randomUUID\(\)/);
    });

    test('ExpenseDetailsDialog protects voiding when active reimbursements exist', async () => {
      const dialog = await fs.readFile(path.join(srcDir, 'components/expenses/ExpenseDetailsDialog.jsx'), 'utf8');
      assert.match(dialog, /canVoidExpense = isSuperAdmin && !isVoided && activeReimbursements\.length === 0/);
      assert.match(dialog, /Void Expense/);
      assert.match(dialog, /Void Reimbursement/);
    });
  });
});
