import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getPreviousLogicalMonth, isValidLogicalMonth } from '../src/lib/logicalMonth.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardPagePath = path.resolve(currentDir, '../src/pages/DashboardPage.jsx');
const reportsPagePath = path.resolve(currentDir, '../src/pages/ReportsPage.jsx');
const paymentsPagePath = path.resolve(currentDir, '../src/pages/PaymentsPage.jsx');
const calendarPagePath = path.resolve(currentDir, '../src/pages/CalendarPage.jsx');
const adminPagePath = path.resolve(currentDir, '../src/pages/AdminPage.jsx');
const loginPagePath = path.resolve(currentDir, '../src/pages/LoginPage.jsx');
const notFoundPagePath = path.resolve(currentDir, '../src/pages/NotFoundPage.jsx');
const authActionsPath = path.resolve(currentDir, '../src/components/auth/AuthActions.jsx');
const personalHeroPath = path.resolve(currentDir, '../src/components/dashboard/PersonalMealHero.jsx');
const householdTodayPath = path.resolve(currentDir, '../src/components/dashboard/HouseholdTodayCard.jsx');
const personalMonthlyPath = path.resolve(currentDir, '../src/components/dashboard/PersonalMonthlyCard.jsx');
const householdMonthlyPath = path.resolve(currentDir, '../src/components/dashboard/HouseholdMonthlyCard.jsx');
const attentionSectionPath = path.resolve(currentDir, '../src/components/dashboard/AttentionSection.jsx');
const nextReminderPath = path.resolve(currentDir, '../src/components/dashboard/NextReminderCard.jsx');
const quickActionsPath = path.resolve(currentDir, '../src/components/dashboard/QuickActionsCard.jsx');

describe('Phase 11 Frontend: Personalized Dashboard & Role-Aware Experience', () => {
  describe('Logical Month Utilities - Previous Month Rollover', () => {
    test('getPreviousLogicalMonth correctly rolls over months and year boundaries', () => {
      assert.equal(getPreviousLogicalMonth('2026-10'), '2026-09');
      assert.equal(getPreviousLogicalMonth('2026-05'), '2026-04');
      assert.equal(getPreviousLogicalMonth('2027-01'), '2026-12');
      assert.equal(getPreviousLogicalMonth('2026-01'), '2025-12');
      assert.throws(() => getPreviousLogicalMonth('2026-13'), TypeError);
      assert.throws(() => getPreviousLogicalMonth('invalid'), TypeError);
    });

    test('isValidLogicalMonth strictly validates calendar month strings', () => {
      assert.equal(isValidLogicalMonth('2026-10'), true);
      assert.equal(isValidLogicalMonth('2026-01'), true);
      assert.equal(isValidLogicalMonth('2026-12'), true);
      assert.equal(isValidLogicalMonth('2026-13'), false);
      assert.equal(isValidLogicalMonth('2026-00'), false);
      assert.equal(isValidLogicalMonth('2026'), false);
      assert.equal(isValidLogicalMonth(''), false);
      assert.equal(isValidLogicalMonth(null), false);
    });
  });

  describe('Route Title Integration', () => {
    test('all main pages integrate useDocumentTitle with descriptive names', async () => {
      const [dash, rep, pay, cal, adm, log, notFound] = await Promise.all([
        fs.readFile(dashboardPagePath, 'utf8'),
        fs.readFile(reportsPagePath, 'utf8'),
        fs.readFile(paymentsPagePath, 'utf8'),
        fs.readFile(calendarPagePath, 'utf8'),
        fs.readFile(adminPagePath, 'utf8'),
        fs.readFile(loginPagePath, 'utf8'),
        fs.readFile(notFoundPagePath, 'utf8'),
      ]);

      assert.match(dash, /useDocumentTitle\('Dashboard'\)/);
      assert.match(rep, /useDocumentTitle\('Reports'\)/);
      assert.match(pay, /useDocumentTitle\('Payments'\)/);
      assert.match(cal, /useDocumentTitle\('Calendar'\)/);
      assert.match(adm, /useDocumentTitle\('Admin'\)/);
      assert.match(log, /useDocumentTitle\('Sign In'\)/);
      assert.match(notFound, /useDocumentTitle\('Page Not Found'\)/);
    });
  });

  describe('URL Query Param Support for Month Navigation', () => {
    test('ReportsPage supports safe ?month query parameter with validation', async () => {
      const content = await fs.readFile(reportsPagePath, 'utf8');
      assert.match(content, /useSearchParams/);
      assert.match(content, /searchParams\.get\('month'\)/);
      assert.match(content, /isValidLogicalMonth/);
    });

    test('PaymentsPage supports safe ?month query parameter with validation', async () => {
      const content = await fs.readFile(paymentsPagePath, 'utf8');
      assert.match(content, /useSearchParams/);
      assert.match(content, /searchParams\.get\('month'\)/);
      assert.match(content, /isValidLogicalMonth/);
    });

    test('CalendarPage supports safe ?month query parameter with validation', async () => {
      const content = await fs.readFile(calendarPagePath, 'utf8');
      assert.match(content, /useSearchParams/);
      assert.match(content, /searchParams\.get\('month'\)/);
      assert.match(content, /isValidLogicalMonth/);
    });
  });

  describe('DashboardPage Role-Aware Composition', () => {
    test('DashboardPage integrates useDashboard and all specialized cards', async () => {
      const content = await fs.readFile(dashboardPagePath, 'utf8');
      assert.match(content, /import \{ useDashboard \} from '\.\.\/hooks\/useDashboard\.js';/);
      assert.match(content, /import \{ PersonalMealHero \}/);
      assert.match(content, /import \{ HouseholdTodayCard \}/);
      assert.match(content, /import \{ PersonalMonthlyCard \}/);
      assert.match(content, /import \{ HouseholdMonthlyCard \}/);
      assert.match(content, /import \{ AttentionSection \}/);
      assert.match(content, /import \{ NextReminderCard \}/);
      assert.match(content, /import \{ QuickActionsCard \}/);
      assert.match(content, /<AttentionSection/);
      assert.match(content, /<HouseholdTodayCard/);
      assert.match(content, /<NextReminderCard/);
      assert.match(content, /<QuickActionsCard/);
    });
  });

  describe('Component Contracts', () => {
    test('PersonalMealHero exposes accessible Taking/Skip controls', async () => {
      const content = await fs.readFile(personalHeroPath, 'utf8');
      assert.match(content, /aria-pressed=\{morning === 'taking'\}/);
      assert.match(content, /aria-pressed=\{morning === 'skip'\}/);
      assert.match(content, /aria-pressed=\{night === 'taking'\}/);
      assert.match(content, /aria-pressed=\{night === 'skip'\}/);
      assert.match(content, /disabled=\{!isOnline/);
    });

    test('HouseholdTodayCard displays plate metrics and member rows', async () => {
      const content = await fs.readFile(householdTodayPath, 'utf8');
      assert.match(content, /morningPlates/);
      assert.match(content, /nightPlates/);
      assert.match(content, /totalPlates/);
      assert.match(content, /members\.map/);
      assert.match(content, /Manage Today/);
    });

    test('PersonalMonthlyCard formats currency and provides direct payment CTA', async () => {
      const content = await fs.readFile(personalMonthlyPath, 'utf8');
      assert.match(content, /formatPaise\(billAmountPaise\)/);
      assert.match(content, /formatPaise\(paidAmountPaise\)/);
      assert.match(content, /formatPaise\(remainingAmountPaise\)/);
      assert.match(content, /Go to Payments/);
      assert.match(content, /Rates Pending/);
    });

    test('HouseholdMonthlyCard provides room totals and shortcuts', async () => {
      const content = await fs.readFile(householdMonthlyPath, 'utf8');
      assert.match(content, /formatPaise\(billAmountPaise\)/);
      assert.match(content, /formatPaise\(paidAmountPaise\)/);
      assert.match(content, /Full Report/);
      assert.match(content, /Payment Ledger/);
    });

    test('AttentionSection displays alert cards and empty status', async () => {
      const content = await fs.readFile(attentionSectionPath, 'utf8');
      assert.match(content, /attention-card--/);
      assert.match(content, /attention-empty-banner/);
      assert.match(content, /You(&apos;|')re all set/);
    });

    test('NextReminderCard displays scheduled time and in-app/push status', async () => {
      const content = await fs.readFile(nextReminderPath, 'utf8');
      assert.match(content, /BrowserReminderControl/);
      assert.match(content, /next\.timeFormatted/);
      assert.match(content, /Background push reminders enabled/);
      assert.match(content, /In-app reminders active/);
    });

    test('QuickActionsCard renders accessible shortcut buttons', async () => {
      const content = await fs.readFile(quickActionsPath, 'utf8');
      assert.match(content, /quick-action-button/);
      assert.match(content, /action\.to/);
      assert.match(content, /action\.label/);
    });

    test('AuthActions displays identity badge with avatar and role', async () => {
      const content = await fs.readFile(authActionsPath, 'utf8');
      assert.match(content, /account-identity-badge/);
      assert.match(content, /auth\.displayName/);
      assert.match(content, /Member/);
    });
  });
});
