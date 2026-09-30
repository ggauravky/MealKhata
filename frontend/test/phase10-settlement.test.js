import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const swPath = path.resolve(currentDir, '../public/sw.js');
const reportsPagePath = path.resolve(currentDir, '../src/pages/ReportsPage.jsx');
const paymentsPagePath = path.resolve(currentDir, '../src/pages/PaymentsPage.jsx');
const adminPagePath = path.resolve(currentDir, '../src/pages/AdminPage.jsx');
const calendarPagePath = path.resolve(currentDir, '../src/pages/CalendarPage.jsx');
const settlementPanelPath = path.resolve(currentDir, '../src/components/reports/SettlementPanel.jsx');

describe('Phase 10 Frontend: Monthly Settlement, Statements & Push Hardening', () => {
  describe('Service Worker Network-Only Policy for Statements & Financial APIs', () => {
    test('service worker strictly bypasses all /api/* requests direct to network without caching', async () => {
      const content = await fs.readFile(swPath, 'utf8');
      assert.match(content, /url\.pathname\.startsWith\('\/api'\)/);
      // Ensures /api requests return without cache interception
      assert.match(content, /if \(url\.pathname\.startsWith\('\/api'\)\) \{\s*return;\s*\}/);
    });
  });

  describe('ReportsPage Settlement UI Integration', () => {
    test('ReportsPage imports and wires useSettlement and SettlementPanel', async () => {
      const content = await fs.readFile(reportsPagePath, 'utf8');
      assert.match(content, /import \{ useSettlement \} from '\.\.\/hooks\/useSettlement\.js';/);
      assert.match(content, /import \{ SettlementPanel \} from '\.\.\/components\/reports\/SettlementPanel\.jsx';/);
      assert.match(content, /const settlement = useSettlement\(month\);/);
      assert.match(content, /<SettlementPanel/);
      assert.match(content, /settlement\.isClosed/);
    });

    test('ReportsPage renders frozen settlement snapshot values when month is closed', async () => {
      const content = await fs.readFile(reportsPagePath, 'utf8');
      assert.match(content, /activeSettlement\.snapshot/);
      assert.match(content, /isClosed=\{settlement\.isClosed\}/);
    });

    test('ReportsPage disables/locks meal rates when month is closed', async () => {
      const content = await fs.readFile(reportsPagePath, 'utf8');
      assert.match(content, /This month is closed\. Reopen the month before changing meal rates\./);
    });
  });

  describe('PaymentsPage Closed Month Protection', () => {
    test('PaymentsPage imports useSettlement and disables payments when closed', async () => {
      const content = await fs.readFile(paymentsPagePath, 'utf8');
      assert.match(content, /import \{ useSettlement \} from '\.\.\/hooks\/useSettlement\.js';/);
      assert.match(content, /const settlement = useSettlement\(month\);/);
      assert.match(content, /isClosed=\{isClosed\}/);
      assert.match(content, /settlement-banner/);
      assert.match(content, /Reopen this month before making financial changes\./);
    });

    test('PaymentsPage disables voiding payments when month is closed', async () => {
      const content = await fs.readFile(paymentsPagePath, 'utf8');
      assert.match(content, /disabled=\{!isOnline \|\| isClosed\}/);
      assert.match(content, /This month is closed\. Reopen the month before voiding payments\./);
    });
  });

  describe('CalendarPage & AdminPage Closed Month Protection', () => {
    test('CalendarPage suppresses edit link and displays Month closed badge', async () => {
      const content = await fs.readFile(calendarPagePath, 'utf8');
      assert.match(content, /import \{ useSettlement \} from '\.\.\/hooks\/useSettlement\.js';/);
      assert.match(content, /isMonthClosed/);
      assert.match(content, /Month closed/);
    });

    test('AdminPage displays closed month banner and disables MealCard editing', async () => {
      const content = await fs.readFile(adminPagePath, 'utf8');
      assert.match(content, /import \{ useSettlement \} from '\.\.\/hooks\/useSettlement\.js';/);
      assert.match(content, /isMonthClosed/);
      assert.match(content, /is closed\.<\/strong>[\s\S]*?Reopen the month before editing historical meals\./);
      assert.match(content, /editable=\{Boolean\(mealDay\.data\.permissions\.canEdit\) && isOnline && !isMonthClosed\}/);
    });
  });

  describe('SettlementPanel Component Contract', () => {
    test('SettlementPanel exposes PDF and CSV download links with correct URLs', async () => {
      const content = await fs.readFile(settlementPanelPath, 'utf8');
      assert.match(content, /\/api\/settlements\/\$\{encodeURIComponent\(month\)\}\/statement\.pdf/);
      assert.match(content, /\/api\/settlements\/\$\{encodeURIComponent\(month\)\}\/statement\.csv/);
      assert.match(content, /Download PDF/);
      assert.match(content, /Download CSV/);
    });

    test('SettlementPanel wires confirmation dialogs for close and reopen', async () => {
      const content = await fs.readFile(settlementPanelPath, 'utf8');
      assert.match(content, /<CloseMonthDialog/);
      assert.match(content, /<ReopenMonthDialog/);
      assert.match(content, /Reopen Month/);
    });
  });
});
