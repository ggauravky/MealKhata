import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addDays, indiaToday } from './logicalDates.js';

const financeDate = addDays(indiaToday(), -1);
const financeMonth = financeDate.slice(0, 7);

async function mutate(page, method, route, data, expectedStatus) {
  const response = await page.request[method](route, { data,
    headers: { Origin: new URL(page.url()).origin } });
  const body = await response.json();
  assert.equal(response.status(), expectedStatus, `${route}: ${body.message ?? 'unexpected response'}`);
  return body.data;
}

test('isolated fourth-student finance, Stay readmission and fresh balances', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('superadmin@example.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('E2E-Strong-Pass-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login$/);

  const oldSummary = (await (await page.request.get('/api/payments/summary/2026-09')).json()).data;
  assert.equal(oldSummary.members.gaurav.operationalMessBillPaise, 0);
  assert.ok(oldSummary.members.gaurav.historicalMealCostPaise > 0);

  const student = await mutate(page, 'post', '/api/students', {
    displayName: 'Finance Fourth', mealEligibilityFrom: financeDate, rosterOrder: 30,
    reason: 'Isolated finance acceptance',
  }, 201);
  const memberId = student.studentId;
  const room = await mutate(page, 'post', '/api/room-fees/rooms', {
    roomNumber: 'finance-fourth', roomLabel: 'Finance Fourth Room', capacity: 1,
  }, 201);
  const firstStay = await mutate(page, 'post', '/api/stays', {
    memberId, joinedOn: '2026-10-01', initialRoomId: room.roomId,
    expectedDepositPaise: 0, historicalReason: 'Isolated prior admission',
  }, 201);
  const checkout = await mutate(page, 'post', `/api/stays/${firstStay.stayId}/finalize-checkout`, {
    actualLeftOn: '2026-10-02',
  }, 200);
  assert.equal(checkout.clearance.clearanceStatus, 'NO_DUES');
  const readmitted = await mutate(page, 'post', '/api/stays', {
    memberId, joinedOn: financeDate, initialRoomId: room.roomId,
    expectedDepositPaise: 0,
  }, 201);
  assert.notEqual(readmitted.stayId, firstStay.stayId);

  await mutate(page, 'post', '/api/room-fees/plans', {
    memberId, effectiveFromMonth: financeMonth, amountPaise: 150000,
  }, 201);
  const issued = await mutate(page, 'post', '/api/room-fees/charges/issue', {
    month: financeMonth,
  }, 200);
  const charge = issued.charges.find(item => item.memberId === memberId);
  assert.equal(charge.baseAmountPaise, 150000);
  const roomPayment = await mutate(page, 'post', '/api/room-fees/payments', {
    chargeId: charge.chargeId, memberId, month: financeMonth, amountPaise: 150000,
    method: 'upi', reference: 'FINANCE-FOURTH-ROOM', idempotencyKey: randomUUID(),
  }, 201);
  assert.equal(roomPayment.memberId, memberId);

  await mutate(page, 'patch', `/api/meals/${financeDate}`, {
    memberId, mealType: 'morning', status: 'taking',
  }, 200);
  await mutate(page, 'put', '/api/payment-settings', {
    receiverName: 'Isolated Receiver', upiId: 'isolated@upi', receiverMobile: null,
  }, 200);
  const prepared = await mutate(page, 'post', '/api/payments/prepare', {
    memberId, month: financeMonth,
  }, 200);
  assert.equal(prepared.amountPaise, 5000);
  await mutate(page, 'post', '/api/payments', {
    memberId, month: financeMonth, amountPaise: 1000, upiReference: 'FINANCE-FOURTH-MESS',
    idempotencyKey: randomUUID(),
  }, 201);
  const duplicate = await page.request.post('/api/payments', { data: {
    memberId, month: financeMonth, amountPaise: 1000, upiReference: 'FINANCE-FOURTH-MESS',
    idempotencyKey: randomUUID(),
  }, headers: { Origin: new URL(page.url()).origin } });
  assert.equal(duplicate.status(), 409);

  const expense = await mutate(page, 'post', '/api/expenses', {
    date: financeDate, title: 'Isolated four-person groceries', category: 'groceries',
    amountPaise: 1001, paidByMemberId: 'gaurav', splitType: 'equal',
    participants: ['gaurav', 'nikhil', 'devansh', memberId],
    idempotencyKey: randomUUID(),
  }, 201);
  assert.equal(expense.allocations.reduce((sum, row) => sum + row.amountPaise, 0), 1001);
  const fourthShare = expense.allocations.find(row => row.memberId === memberId).amountPaise;
  const reimbursed = await mutate(page, 'post', `/api/expenses/${expense.expenseId}/reimbursements`, {
    fromMemberId: memberId, amountPaise: fourthShare,
    method: 'upi', reference: 'FINANCE-FOURTH-EXPENSE', idempotencyKey: randomUUID(),
  }, 201);
  assert.equal(reimbursed.fromMemberId, memberId);

  const report = await page.request.get(`/api/finance/overview/${financeMonth}`);
  assert.equal(report.status(), 200);
  await page.goto(`/reports?month=${financeMonth}`);
  await expect(page.getByText('Finance Fourth').first()).toBeVisible();
  await page.goto('/admin/stays');
  await expect(page.getByText('Finance Fourth').first()).toBeVisible();
});
