import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { indiaToday } from './logicalDates.js';

// The isolated harness runs the same one-time setup the owner runs: one Super Admin,
// system settings, and no students or financial records.
const SUPER_EMAIL = 'superadmin@example.test';
const SUPER_PASSWORD = 'E2E-Strong-Pass-2026!';
const ADMIN_EMAIL = 'mess.admin@example.test';
const ADMIN_PASSWORD = 'Admin-Strong-Pass-2026!';
const MEMBER_EMAIL = 'asha.login@example.test';
const MEMBER_PASSWORD = 'Member-Strong-Pass-2026!';
const today = indiaToday();
const month = today.slice(0, 7);

async function signIn(page, email, password) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function api(page, method, route, data, expectedStatus) {
  const response = await page.request[method](route, { data, headers: { Origin: new URL(page.url()).origin } });
  const body = await response.json();
  assert.equal(response.status(), expectedStatus, `${method.toUpperCase()} ${route}: ${body.message ?? ''}`);
  return body.data;
}

async function addStudentThroughUi(page, name, buttonName = 'Add student') {
  await page.getByRole('button', { name: buttonName }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Display name' }).fill(name);
  // New students default to meals starting today.
  await expect(dialog.getByLabel('Meals start on')).toHaveValue(today);
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('New admission');
  await dialog.getByRole('button', { name: 'Add student' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('fresh install: owner sets up students, staff, meals, rooms, money and reports', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const ready = await page.request.get('/api/ready');
  assert.equal(ready.status(), 200, 'readiness must pass after one-time setup');

  // 1. Super Admin signs in to an empty system and is guided to add the first student.
  await signIn(page, SUPER_EMAIL, SUPER_PASSWORD);
  await page.goto('/');
  await expect(page.getByText('No students added yet')).toBeVisible();
  await page.getByRole('link', { name: 'Add first student' }).click();
  await expect(page).toHaveURL(/\/admin\/members$/);
  await addStudentThroughUi(page, 'Asha Verma', 'Add first student');
  await addStudentThroughUi(page, 'Ravi Kumar');
  await addStudentThroughUi(page, 'Meera Iyer');
  const roster = await (await page.request.get('/api/students/roster')).json();
  assert.equal(roster.data.length, 3);
  const id = Object.fromEntries(roster.data.map((student) => [student.displayName.split(' ')[0], student.studentId]));

  // 2. Login for one student, provisioned through the UI.
  const ashaCard = page.getByTestId(`student-card-${id.Asha}`);
  await ashaCard.getByRole('button', { name: 'Provision login' }).click();
  const accountDialog = page.getByRole('dialog');
  await accountDialog.getByRole('textbox', { name: 'Email' }).fill(MEMBER_EMAIL);
  await accountDialog.getByLabel('New password').fill(MEMBER_PASSWORD);
  await accountDialog.getByLabel('Your current Super Admin password').fill(SUPER_PASSWORD);
  await accountDialog.getByRole('button', { name: 'Provision login account' }).click();
  await expect(accountDialog).toBeHidden();

  // 3. An administrator is created from Settings & access.
  await page.goto('/admin/settings');
  await expect(page.getByTestId('financial-start-date')).toHaveText(`${month}-01`);
  await page.getByRole('button', { name: 'Add admin' }).click();
  const adminDialog = page.getByRole('dialog');
  await adminDialog.getByLabel('Name').fill('Mess Admin');
  await adminDialog.getByLabel('Email').fill(ADMIN_EMAIL);
  await adminDialog.getByLabel('Initial password').fill(ADMIN_PASSWORD);
  await adminDialog.getByLabel('Your current password').fill(SUPER_PASSWORD);
  await adminDialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(adminDialog).toBeHidden();
  await expect(page.getByTestId(`staff-account-${ADMIN_EMAIL}`)).toBeVisible();

  // 4. Meals: everyone takes morning today through the admin meal screen, with a live
  //    second tab receiving the update without reloading.
  const watcher = await page.context().newPage();
  await watcher.goto(`/admin?date=${today}`);
  await page.goto(`/admin?date=${today}`);
  for (const name of ['Asha Verma', 'Ravi Kumar', 'Meera Iyer']) {
    const button = page.getByRole('group', { name: `${name} Morning status` }).getByRole('button', { name: 'Taking' });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(watcher.getByRole('group', { name: 'Meera Iyer Morning status' })
    .getByRole('button', { name: 'Taking' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await watcher.close();
  const day = (await (await page.request.get(`/api/meals/${today}`)).json()).data;
  assert.equal(day.dailyCostSummary.room.morningAmountPaise, 3 * 5000);
  const memberMorning = Object.values(day.dailyCostSummary.members).map((member) => member.morningAmountPaise);
  assert.ok(memberMorning.every(Number.isInteger));
  assert.equal(memberMorning.reduce((sum, value) => sum + value, 0), 15000);

  // 5. Room, Stay with a deposit, fee plan, monthly charge and room payment.
  const room = await api(page, 'post', '/api/room-fees/rooms', { roomNumber: '101', roomLabel: 'Ground floor', capacity: 2 }, 201);
  const stay = await api(page, 'post', '/api/stays', {
    memberId: id.Asha, joinedOn: today, initialRoomId: room.roomId, expectedDepositPaise: 500000,
  }, 201);
  assert.ok(stay.stayId);
  await api(page, 'post', '/api/room-fees/plans', { memberId: id.Asha, effectiveFromMonth: month, amountPaise: 300000 }, 201);
  const issued = await api(page, 'post', '/api/room-fees/charges/issue', { month }, 200);
  const charge = issued.charges.find((item) => item.memberId === id.Asha);
  assert.equal(charge.baseAmountPaise, 300000);
  await api(page, 'post', '/api/room-fees/payments', {
    chargeId: charge.chargeId, memberId: id.Asha, month, amountPaise: 300000,
    method: 'upi', reference: 'E2E-ROOM-1', idempotencyKey: randomUUID(),
  }, 201);

  // 6. Mess payment (with duplicate-reference protection) and a shared expense.
  await api(page, 'put', '/api/payment-settings', { receiverName: 'Hostel Mess', upiId: 'hostelmess@upi', receiverMobile: null }, 200);
  const prepared = await api(page, 'post', '/api/payments/prepare', { memberId: id.Asha, month }, 200);
  assert.equal(prepared.amountPaise, 5000);
  await api(page, 'post', '/api/payments', {
    memberId: id.Asha, month, amountPaise: 5000, upiReference: 'E2E-MESS-1', idempotencyKey: randomUUID(),
  }, 201);
  const duplicate = await page.request.post('/api/payments', { data: {
    memberId: id.Asha, month, amountPaise: 5000, upiReference: 'E2E-MESS-1', idempotencyKey: randomUUID(),
  }, headers: { Origin: new URL(page.url()).origin } });
  assert.equal(duplicate.status(), 409);
  const expense = await api(page, 'post', '/api/expenses', {
    date: today, title: 'Groceries', category: 'groceries', amountPaise: 1000,
    paidByMemberId: id.Ravi, splitType: 'equal', participants: [id.Asha, id.Ravi, id.Meera],
    idempotencyKey: randomUUID(),
  }, 201);
  assert.equal(expense.allocations.reduce((sum, row) => sum + row.amountPaise, 0), 1000);

  // 7. Reports and pages show the new students; data survives a reload.
  const overview = await page.request.get(`/api/finance/overview/${month}`);
  assert.equal(overview.status(), 200);
  await page.goto(`/reports?month=${month}`);
  await expect(page.getByText('Asha Verma').first()).toBeVisible();
  await page.goto('/admin/stays');
  await expect(page.getByText('Asha Verma').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Asha Verma').first()).toBeVisible();

  // 8. The Admin can operate but cannot manage accounts.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal((await adminPage.request.get('/api/admin/accounts')).status(), 403);
  await adminPage.goto('/admin/settings');
  await expect(adminPage).not.toHaveURL(/\/admin\/settings/);
  await adminContext.close();

  // 9. The student signs in, sees their own meals, and cannot reach admin screens or APIs.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD);
  await memberPage.goto('/admin');
  await expect(memberPage).not.toHaveURL(/\/admin/);
  assert.equal((await memberPage.request.get('/api/students')).status(), 403);
  const own = await memberPage.request.get(`/api/finance/me/${month}`);
  assert.equal(own.status(), 200);
  await memberContext.close();
});
