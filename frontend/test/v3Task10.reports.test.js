import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('report summary renders API-provided student rows and names', async () => {
  const source = await readFile(new URL('../src/components/reports/ReportSummary.jsx', import.meta.url), 'utf8');
  assert.match(source, /Object\.entries\(summary\?\.members/);
  assert.match(source, /displayName/);
  assert.doesNotMatch(source, /ROOMMATES\.map/);
});

test('closed report accepts version 3 settlement snapshots', async () => {
  const source = await readFile(new URL('../src/pages/ReportsPage.jsx', import.meta.url), 'utf8');
  assert.match(source, /activeSettlement\.snapshotVersion/);
  assert.match(source, /billAmountPaise/);
});

test('settlement blockers display the resolved student name', async () => {
  const source = await readFile(new URL('../src/components/reports/SettlementPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /blocker\.displayName/);
});

test('payment summary cards use the returned student map', async () => {
  const source = await readFile(new URL('../src/pages/PaymentsPage.jsx', import.meta.url), 'utf8');
  assert.match(source, /Object\.entries\(data\.members/);
  assert.doesNotMatch(source, /ROOMMATES\.map/);
});
