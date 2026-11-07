import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addDays, indiaToday } from './logicalDates.js';

const superPassword = 'E2E-Strong-Pass-2026!';
const memberPassword = 'Fourth-Pass-2026!';
const fourthName = 'Task14 Fourth Edited';
const testDate = indiaToday();
const testMonth = testDate.slice(0, 7);

test.describe.configure({ mode: 'serial' });

async function login(page, email, password) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function setEligibility(page, index) {
  await page.getByRole('button', { name: 'Edit', exact: true }).nth(index).click();
  await page.getByRole('textbox', { name: 'Meal eligible from (optional)' }).fill(testDate);
  await page.getByRole('textbox', { name: 'Reason' }).fill('Isolated meal acceptance');
  await page.getByRole('button', { name: 'Edit student' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function takeMeal(page, name, mealType = 'Morning') {
  const button = page.getByRole('group', { name: `${name} ${mealType} status` })
    .getByRole('button', { name: 'Taking' });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toBeEnabled();
}

async function verifyPreset(page, date, names, plan, expectedAmounts, plates) {
  await page.goto(`/admin?date=${date}`);
  for (const name of names) await takeMeal(page, name);
  await page.getByRole('button', { name: 'Configure Morning plate sharing' }).click();
  await page.getByRole('button', { name: new RegExp(plan, 'i') }).click();
  await page.getByRole('button', { name: 'Save allocation' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(async () => {
    const day = (await (await page.request.get(`/api/meals/${date}`)).json()).data;
    return day.allocations.morning.cost.physicalPlateCount;
  }).toBe(plates);
  const day = (await (await page.request.get(`/api/meals/${date}`)).json()).data;
  expect(Object.values(day.allocations.morning.cost.memberAmountsPaise)
    .filter(amount => amount > 0).sort((a, b) => a - b)).toEqual(expectedAmounts);
  expect(day.dailyCostSummary.room.morningAmountPaise).toBe(plates * 5000);
}

async function pdfText(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    pages.push((await page.getTextContent()).items.map(item => item.str).join(' '));
  }
  return pages.join('\n');
}

test('dynamic student lifecycle, canonical access, exact meals and preserved history', async ({ page, browser }) => {
  await login(page, 'superadmin@example.test', superPassword);
  await page.goto('/admin/members');
  await expect(page.getByRole('heading', { name: 'Student Management' })).toBeVisible();
  for (const name of ['Gaurav', 'Nikhil', 'Devansh']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const historicalBefore = (await (await page.request.get('/api/meals/2026-09-30')).json()).data;
  const startingStudents = (await (await page.request.get('/api/students/roster')).json()).data.length;
  expect(historicalBefore.financialClassification).toBe('historical');
  expect(historicalBefore.meals.morning.gaurav).toBe('taking');
  expect(Object.keys(historicalBefore.meals.morning)).toEqual(['gaurav', 'nikhil', 'devansh']);
  await page.getByRole('button', { name: 'Add student' }).click();
  await page.getByRole('textbox', { name: 'Display name' }).fill('Task14 Fourth');
  await page.getByRole('textbox', { name: 'Meal eligible from (optional)' }).fill(testDate);
  await page.getByRole('textbox', { name: 'Reason' }).fill('Isolated acceptance fixture');
  await page.getByRole('dialog').getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByRole('heading', { name: 'Task14 Fourth' })).toBeVisible();
  const roster = (await (await page.request.get('/api/students/roster')).json()).data;
  expect(roster.slice(0, 3).map(student => student.studentId)).toEqual(['gaurav', 'nikhil', 'devansh']);
  const fourthId = roster.find(student => student.displayName === 'Task14 Fourth').studentId;
  assert.match(fourthId, /^student_[a-f0-9]{32}$/);
  const fourthCard = page.getByTestId(`student-card-${fourthId}`);

  await fourthCard.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Display name' }).fill(fourthName);
  await page.getByRole('textbox', { name: 'Profile email (optional)' }).fill('fourth.profile@example.test');
  await page.getByRole('textbox', { name: 'Reason' }).fill('Isolated profile edit');
  await page.getByRole('button', { name: 'Edit student' }).click();
  await expect(page.getByRole('heading', { name: fourthName })).toBeVisible();
  await fourthCard.getByRole('button', { name: 'Provision login' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Email' }).fill('fourth.login@example.test');
  await page.getByRole('textbox', { name: 'New password' }).fill(memberPassword);
  await page.getByRole('textbox', { name: 'Your current Super Admin password' }).fill(superPassword);
  await page.getByRole('button', { name: 'Provision login account' }).click();
  await expect(page.getByText('fourth.login@example.test')).toBeVisible();

  const memberContext = await browser.newContext();
  try {
    const memberPage = await memberContext.newPage();
    await login(memberPage, 'fourth.login@example.test', memberPassword);
    await expect(memberPage).toHaveURL(/\/$/);
    expect((await memberPage.request.patch(`/api/meals/${testDate}`, { data: {
      mealType: 'morning', memberId: 'gaurav', status: 'taking' } })).status()).toBe(403);
    expect((await memberPage.request.get(`/api/finance/members/gaurav/${testMonth}`)).status()).toBe(403);

    await page.getByRole('button', { name: 'Add student' }).click();
    await page.getByRole('textbox', { name: 'Display name' }).fill('Task14 Fifth');
    await page.getByRole('textbox', { name: 'Reason' }).fill('Isolated five-student acceptance');
    await page.getByRole('dialog').getByRole('button', { name: 'Add student' }).click();
    await expect(page.getByText(`Students: ${startingStudents + 2}`)).toBeVisible();
    await setEligibility(page, 1);
    await setEligibility(page, 2);

    await page.goto(`/admin?date=${testDate}`);
    for (const name of ['Gaurav', 'Nikhil', 'Devansh', fourthName]) await takeMeal(page, name);
    await takeMeal(page, fourthName, 'Night');
    await page.getByRole('button', { name: 'Configure Morning plate sharing' }).click();
    await page.getByRole('button', { name: 'Custom Manual plate allocations' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Gaurav one third plate' }).click();
    await dialog.getByRole('button', { name: 'Nikhil one third plate' }).click();
    await dialog.getByRole('button', { name: 'Devansh one sixth plate' }).click();
    await dialog.getByRole('button', { name: `${fourthName} one sixth plate` }).click();
    await dialog.getByRole('button', { name: 'Save allocation' }).click();
    await page.getByRole('button', { name: 'Adjust Morning meal price' }).click();
    await page.getByRole('textbox', { name: 'Price per physical plate (₹)' }).fill('50.01');
    await page.getByRole('textbox', { name: 'Reason (optional)' }).fill('Exact paise check');
    await page.getByRole('button', { name: 'Save price' }).click();
    await expect(page.getByText(/Morning price updated to ₹50\.01/)).toBeVisible();

    const day = (await (await page.request.get(`/api/meals/${testDate}`)).json()).data;
    expect(day.dailyCostSummary.room.totalAmountPaise).toBe(12001);
    expect(day.dailyCostSummary.members.gaurav.morningAmountPaise).toBe(1667);
    expect(day.dailyCostSummary.members.nikhil.morningAmountPaise).toBe(1667);
    // The extra paise rotates by logical date and saved participant order.
    const tiedAmounts = [day.dailyCostSummary.members.devansh.morningAmountPaise,
      day.dailyCostSummary.members[fourthId].morningAmountPaise];
    expect(tiedAmounts.sort((a, b) => a - b)).toEqual([833, 834]);
    const fourthMorning = day.dailyCostSummary.members[fourthId].morningAmountPaise;
    const fourthTotal = day.dailyCostSummary.members[fourthId].totalAmountPaise;
    const rupees = paise => (paise / 100).toFixed(2);
    expect(Object.values(day.dailyCostSummary.members).reduce((sum, row) =>
      sum + row.totalAmountPaise, 0)).toBe(12001);
    await expect(page.getByText(`₹${rupees(fourthMorning)}`).first()).toBeVisible();
    await page.goto('/');
    await expect(page.getByText(fourthName).first()).toBeVisible();
    await expect(page.getByText(`₹${rupees(fourthMorning)}`).first()).toBeVisible();
    await page.goto(`/calendar?month=${testMonth}`);
    await expect(page.getByLabel('Household daily total, ₹120.01')).toBeVisible();
    await expect(page.getByLabel(`${fourthName} daily total, ₹${rupees(fourthTotal)}`)).toBeVisible();
    const historicalAfter = (await (await page.request.get('/api/meals/2026-09-30')).json()).data;
    expect(historicalAfter).toEqual(historicalBefore);

    await page.goto('/reports');
    const pdfResponse = await page.request.get(`/api/reports/monthly/${testMonth}/report.pdf`);
    expect(pdfResponse.status()).toBe(200);
    const text = await pdfText(await pdfResponse.body());
    expect(text).toContain('Daily Room Total: Rs. 120.01');
    expect(text).toContain('Task14 Fourth Edited');

    await verifyPreset(page, addDays(testDate, 1), ['Gaurav', 'Nikhil'],
      '1 plate · 2 people', [2500, 2500], 1);
    await verifyPreset(page, addDays(testDate, 2), ['Gaurav', 'Nikhil', 'Devansh'],
      '1 plate · 3 people', [1666, 1667, 1667], 1);
    await verifyPreset(page, addDays(testDate, 3), ['Gaurav', 'Nikhil', 'Devansh'],
      '2 plates · equal', [3333, 3333, 3334], 2);

    await page.goto('/admin/members');
    await fourthCard.getByRole('button', { name: 'Archive', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Reason' }).fill('Isolated archival acceptance');
    await page.getByRole('checkbox', { name: /Disable login and revoke sessions/ }).check();
    await page.getByRole('button', { name: 'Archive student' }).click();
    await expect(page.getByRole('heading', { name: 'Historical students' })).toBeVisible();
    await expect(page.getByText(`Students: ${startingStudents + 2}`)).toBeVisible();
    expect((await (await memberPage.request.get('/api/auth/session')).json()).session.authenticated).toBe(false);
    await memberPage.goto('/login');
    await memberPage.getByRole('textbox', { name: 'Email' }).fill('fourth.login@example.test');
    await memberPage.getByRole('textbox', { name: 'Password' }).fill(memberPassword);
    await memberPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(memberPage.getByRole('alert')).toContainText('Invalid email or password');
    await page.goto(`/calendar?month=${testMonth}`);
    await expect(page.getByLabel(`${fourthName} daily total, ₹${rupees(fourthTotal)}`)).toBeVisible();
    await page.goto('/admin/members');
    await fourthCard.getByRole('button', { name: 'Reactivate' }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Reason' }).fill('Isolated reactivation acceptance');
    await page.getByRole('button', { name: 'Reactivate student' }).click();
    await expect(page.getByRole('heading', { name: fourthName })).toBeVisible();
    await expect(page.getByText('Login disabled')).toBeVisible();
  } finally { await memberContext.close(); }
});

test('desktop and mobile operational pages render without console errors', async ({ page }) => {
  await login(page, 'superadmin@example.test', superPassword);
  const errors = [];
  const serverFailures = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`); });
  for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const route of ['/', '/calendar', '/admin/members', '/admin/stays',
      '/room-fees', '/payments', '/expenses', '/reports']) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByText('MealKhata').first()).toBeVisible();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(serverFailures, []);
});
