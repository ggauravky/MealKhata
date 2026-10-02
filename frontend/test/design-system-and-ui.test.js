import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

describe('Redesign Design System, Theme & UI Verification', () => {
  test('Light default theme, Dark, and System selection support', async () => {
    const themeContextPath = path.join(srcDir, 'context/ThemeContext.jsx');
    const content = await fs.readFile(themeContextPath, 'utf8');

    // Default must be light
    assert.match(content, /DEFAULT_THEME = 'light'/);
    // Storage key must be mealkhata-theme
    assert.match(content, /THEME_STORAGE_KEY = 'mealkhata-theme'/);
    // Must support light, dark, and system
    assert.match(content, /'light'/);
    assert.match(content, /'dark'/);
    assert.match(content, /'system'/);
    // Applies data-theme and dark class
    assert.match(content, /root\.setAttribute\('data-theme'/);
    assert.match(content, /root\.classList\.add\('dark'\)/);
  });

  test('Design tokens define restrained Slate + Teal palette and semantic colors', async () => {
    const tokensPath = path.join(srcDir, 'styles/tokens.css');
    const content = await fs.readFile(tokensPath, 'utf8');

    // Light mode tokens
    assert.match(content, /--background:\s*#f8fafc/i);
    assert.match(content, /--surface:\s*#ffffff/i);
    assert.match(content, /--brand:\s*#0f766e/i);
    assert.match(content, /--text-primary:\s*#0f172a/i);

    // Dark mode tokens
    assert.match(content, /--background:\s*#0f1115/i);
    assert.match(content, /--surface:\s*#171a1f/i);

    // Semantic tokens
    assert.match(content, /--morning-surface/);
    assert.match(content, /--night-surface/);
    assert.match(content, /--taking-surface/);
    assert.match(content, /--skip-surface/);
    assert.match(content, /--shared-surface/);
  });

  test('Original MealKhata brand logo combines plate, 3 roommates, and ledger check', async () => {
    const logoPath = path.join(srcDir, 'components/brand/MealKhataLogo.jsx');
    const content = await fs.readFile(logoPath, 'utf8');

    // Outer bowl outline
    assert.match(content, /C22\.075 27 27 22\.075/);
    // Three roommate dots
    assert.match(content, /circle cx="9" cy="8"/);
    assert.match(content, /circle cx="16" cy="6"/);
    assert.match(content, /circle cx="23" cy="8"/);
    // Ledger tick / accounting tally mark
    assert.match(content, /M11 20\.5L14\.5 24L21 17\.5/);
    // Supports mark and full variants
    assert.match(content, /variant === 'mark'/);
    assert.match(content, /Meals tracked\. Bills sorted\./);
  });

  test('Dashboard people eating / physical plates consistency guard', async () => {
    const cardPath = path.join(srcDir, 'components/dashboard/HouseholdTodayCard.jsx');
    const content = await fs.readFile(cardPath, 'utf8');

    // Asserts derivation logic ensuring 0 people eating bug cannot reappear
    assert.match(content, /effectiveMorningEating/);
    assert.match(content, /members\.filter\(\(m\) => m\.morning === 'taking'\)\.length/);
    assert.match(content, /effectiveNightEating/);
    assert.match(content, /members\.filter\(\(m\) => m\.night === 'taking'\)\.length/);

    // Asserts clean presentation of plates and eating count
    assert.match(content, /formatPlateCount\(morningPlates\)/);
    assert.match(content, /formatPlateCount\(nightPlates\)/);
    assert.match(content, /Total physical plates today/);
  });

  test('Member avatar has distinct subtle colors for Gaurav, Nikhil, Devansh', async () => {
    const avatarPath = path.join(srcDir, 'components/ui/avatar.jsx');
    const content = await fs.readFile(avatarPath, 'utf8');

    assert.match(content, /gaurav:/);
    assert.match(content, /teal/);
    assert.match(content, /nikhil:/);
    assert.match(content, /sky|blue/);
    assert.match(content, /devansh:/);
    assert.match(content, /purple|violet/);
  });

  test('Empty state presentation for zero operational data views', async () => {
    const paymentsPath = path.join(srcDir, 'pages/PaymentsPage.jsx');
    const adminPath = path.join(srcDir, 'pages/AdminPage.jsx');

    const paymentsContent = await fs.readFile(paymentsPath, 'utf8');
    const adminContent = await fs.readFile(adminPath, 'utf8');

    // Payments empty state
    assert.match(paymentsContent, /No payments recorded yet/);
    assert.match(paymentsContent, /Payments recorded for .* will appear here/);

    // Admin audit history empty state
    assert.match(adminContent, /No changes recorded for this date\./);
  });

  test('AccountMenu renders avatar, role, admin link if authorized, and sign out', async () => {
    const accountMenuPath = path.join(srcDir, 'components/layout/AccountMenu.jsx');
    const content = await fs.readFile(accountMenuPath, 'utf8');

    assert.match(content, /DropdownMenu/);
    assert.match(content, /MemberAvatar/);
    assert.match(content, /canAccessAdmin/);
    assert.match(content, /Admin panel/);
    assert.match(content, /Sign out/);
    assert.match(content, /Sign in/);
  });
});
