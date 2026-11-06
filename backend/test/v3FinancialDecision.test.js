import assert from 'node:assert/strict';
import { test } from 'node:test';

const decisionModule = await import('../src/migrations/production/financialStartDecision.js').catch(() => ({}));
const complete = { approvedDate: '2026-12-01', timezone: 'Asia/Kolkata',
  importedMealOnBoundary: false, boundaryDayClassification: 'operational',
  partialMonthBillingPolicy: 'daily-operational-only',
  firstMessBillingPeriod: '2026-12', firstRoomFeePeriod: '2026-12',
  initialActiveStudentIds: ['gaurav', 'nikhil', 'devansh'],
  mealEligibility: [
    { studentId: 'gaurav', startDate: '2026-12-01' },
    { studentId: 'nikhil', startDate: '2026-12-01' },
    { studentId: 'devansh', startDate: '2026-12-01' },
  ], roomAssignments: [], roomFeePlans: [], deposits: [], accountProvisioning: [] };

test('owner financial decision requires a complete explicit boundary and student eligibility', () => {
  assert.equal(typeof decisionModule.validateFinancialStartDecision, 'function');
  assert.equal(decisionModule.validateFinancialStartDecision(complete).approvedDate, '2026-12-01');
  for (const removed of ['approvedDate', 'timezone', 'importedMealOnBoundary',
    'boundaryDayClassification', 'partialMonthBillingPolicy', 'firstMessBillingPeriod',
    'firstRoomFeePeriod', 'mealEligibility', 'accountProvisioning']) {
    const missing = { ...complete };
    delete missing[removed];
    assert.throws(() => decisionModule.validateFinancialStartDecision(missing),
      /decision|missing|boundary/i);
  }
  assert.throws(() => decisionModule.validateFinancialStartDecision({ ...complete,
    approvedDate: '2026-02-30' }), /date|decision/i);
  assert.throws(() => decisionModule.validateFinancialStartDecision({ ...complete,
    importedMealOnBoundary: true }), /historical|boundary/i);
  assert.throws(() => decisionModule.validateFinancialStartDecision({ ...complete,
    mealEligibility: complete.mealEligibility.slice(1) }), /eligibility|student/i);
  assert.throws(() => decisionModule.validateFinancialStartDecision({ ...complete,
    firstMessBillingPeriod: '2026-11' }), /decision|period|boundary/i);
});
