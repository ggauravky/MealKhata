import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(currentDir, '../src');

describe('Critical Frontend Semantics, Pricing & UI Polish', () => {
  test('Badge component includes a distinct not_set variant', () => {
    const badgeFile = fs.readFileSync(path.join(srcDir, 'components/ui/badge.jsx'), 'utf8');
    assert.match(badgeFile, /not_set:/, 'badgeVariants must declare a not_set style variant');
    assert.match(badgeFile, /slate|gray|neutral/, 'not_set variant should use neutral/muted styling');
  });

  test('Requirement 86 & 118: MealCard displays explicit Not set badge for not_set without falling back to Skip', () => {
    const mealCardFile = fs.readFileSync(path.join(srcDir, 'components/meals/MealCard.jsx'), 'utf8');
    // Ensure binary ternary is NOT used
    assert.doesNotMatch(mealCardFile, /currentStatus\s*===\s*['"]taking['"]\s*\?\s*['"]Taking['"]\s*:\s*['"]Skip['"]/, 'MealCard must not use binary Taking/Skip ternary');
    assert.match(mealCardFile, /variant="not_set"/, 'MealCard must render not_set badge variant for not_set status');
    assert.match(mealCardFile, />Not set</, 'MealCard must render text "Not set"');
  });

  test('Requirement 41, 42, 49: MealCard displays exact member cost from authoritative backend allocation', () => {
    const mealCardFile = fs.readFileSync(path.join(srcDir, 'components/meals/MealCard.jsx'), 'utf8');
    assert.match(mealCardFile, /formatPaise/, 'MealCard must use formatPaise helper for exact financial display');
    assert.match(mealCardFile, /memberCost|amountPaise/, 'MealCard must read member costs from backend allocation');
  });

  test('Requirement 52, 53, 54, 137: PlateSummary is rewritten with Tailwind/shadcn grid without legacy broken classes', () => {
    const plateSummaryFile = fs.readFileSync(path.join(srcDir, 'components/meals/PlateSummary.jsx'), 'utf8');
    assert.doesNotMatch(plateSummaryFile, /className=["'][^"']*plate-summary__total/, 'Legacy plate-summary__total class must be eliminated');
    assert.match(plateSummaryFile, /grid-cols-3/, 'PlateSummary must use a responsive 3-column metric layout');
    assert.match(plateSummaryFile, /SunMedium/, 'PlateSummary should use SunMedium icon for morning');
    assert.match(plateSummaryFile, /Moon/, 'PlateSummary should use Moon icon for night');
    assert.match(plateSummaryFile, /Utensils/, 'PlateSummary should use Utensils icon for total');
  });

  test('Requirement 56, 138: CalendarPage replaces legacy "Using default schedule" with "Nothing entered yet"', () => {
    const calendarPageFile = fs.readFileSync(path.join(srcDir, 'pages/CalendarPage.jsx'), 'utf8');
    assert.doesNotMatch(calendarPageFile, /Using default schedule/, 'CalendarPage must never display "Using default schedule"');
    assert.match(calendarPageFile, /Nothing entered yet/, 'CalendarPage must display "Nothing entered yet" for unentered dates');
  });

  test('Requirement 23, 62: ReportsPage displays clean empty state for past months with no recorded meals', () => {
    const reportsPageFile = fs.readFileSync(path.join(srcDir, 'pages/ReportsPage.jsx'), 'utf8');
    assert.match(reportsPageFile, /No meal activity recorded/, 'ReportsPage must display "No meal activity recorded" when month has no entries');
    assert.match(reportsPageFile, /No meals were recorded for/, 'ReportsPage empty state message');
  });

  test('Requirement 27, 63: PaymentsPage displays clean empty state for months with no charges or payments', () => {
    const paymentsPageFile = fs.readFileSync(path.join(srcDir, 'pages/PaymentsPage.jsx'), 'utf8');
    assert.match(paymentsPageFile, /No payment activity/, 'PaymentsPage must display "No payment activity" card');
    assert.match(paymentsPageFile, /There are no meal charges or recorded payments for/, 'PaymentsPage empty state message');
  });
});
