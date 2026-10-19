import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dailyCostSummaryPath = path.resolve(currentDir, '../src/components/calendar/DailyCostSummary.jsx');
const mealPriceDialogPath = path.resolve(currentDir, '../src/components/meals/MealPriceDialog.jsx');
const mealCardPath = path.resolve(currentDir, '../src/components/meals/MealCard.jsx');
const calendarPagePath = path.resolve(currentDir, '../src/pages/CalendarPage.jsx');
const adminPagePath = path.resolve(currentDir, '../src/pages/AdminPage.jsx');
const householdTodayPath = path.resolve(currentDir, '../src/components/dashboard/HouseholdTodayCard.jsx');

describe('Date-Specific Meal Price Override & Daily Cost Summary (Frontend)', () => {
  test('DailyCostSummary component exists and displays 3 members + household total', async () => {
    const content = await fs.readFile(dailyCostSummaryPath, 'utf8');
    assert.ok(content.includes('Daily Cost Summary'));
    assert.ok(content.includes('ROOMMATES'));
    assert.ok(content.includes('MemberAvatar'));
    assert.ok(content.includes('Household'));
    assert.ok(content.includes('grid-cols-2') || content.includes('grid-cols-1'));
    assert.ok(content.includes('md:grid-cols-4'));
    assert.ok(content.includes('morningAmountPaise'));
    assert.ok(content.includes('nightAmountPaise'));
    assert.ok(content.includes('totalAmountPaise'));
  });

  test('MealPriceDialog component handles integer paise, decimal inputMode, reason, and reset', async () => {
    const content = await fs.readFile(mealPriceDialogPath, 'utf8');
    assert.ok(content.includes('Dialog'));
    assert.ok(content.includes('inputMode="decimal"'));
    assert.ok(content.includes('This price applies only to this meal on this date'));
    assert.ok(content.includes('Reset to '));
    assert.ok(content.includes('isOnline'));
    assert.ok(content.includes('Connect to the internet to adjust meal price'));
  });

  test('CalendarPage embeds DailyCostSummary below Morning and Night MealCards', async () => {
    const content = await fs.readFile(calendarPagePath, 'utf8');
    assert.ok(content.includes('DailyCostSummary'));
    assert.ok(content.includes('<DailyCostSummary'));
    const morningIndex = content.indexOf('mealType="morning"');
    const nightIndex = content.indexOf('mealType="night"');
    const summaryIndex = content.indexOf('<DailyCostSummary');
    assert.ok(morningIndex > -1 && nightIndex > -1 && summaryIndex > -1);
    assert.ok(summaryIndex > morningIndex && summaryIndex > nightIndex, 'DailyCostSummary must appear after Morning and Night cards');
  });

  test('MealCard uses effective pricing, displays Adjusted badge, and provides price configuration trigger', async () => {
    const content = await fs.readFile(mealCardPath, 'utf8');
    assert.ok(content.includes('pricing'));
    assert.ok(content.includes('Adjusted'));
    assert.ok(content.includes('canConfigurePrice'));
    assert.ok(content.includes('onConfigurePrice'));
    // Ensures fallback constants are not overriding server-provided effective prices
    assert.ok(!content.includes('isMorning ? 5000 : 7000'));
  });

  test('AdminPage includes price editing dialog trigger and renders price change history', async () => {
    const content = await fs.readFile(adminPagePath, 'utf8');
    assert.ok(content.includes('MealPriceDialog'));
    assert.ok(content.includes('item.type === \'price\''));
    assert.ok(content.includes('adjusted') || content.includes('price reset'));
  });

  test('HouseholdTodayCard displays effective prices for today and highlights adjustments', async () => {
    const content = await fs.readFile(householdTodayPath, 'utf8');
    assert.ok(content.includes('morningPricePaise'));
    assert.ok(content.includes('nightPricePaise'));
    assert.ok(content.includes('(Adjusted)'));
  });
});
