import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';

async function connectWithTicket(ticket, origin) {
  const socket = io('http://127.0.0.1:5100', { autoConnect: false,
    transports: ['websocket'], reconnection: false, forceNew: true,
    extraHeaders: { Origin: origin }, auth: { ticket } });
  const outcome = await new Promise(resolve => {
    const timeout = setTimeout(() => resolve('timeout'), 5_000);
    socket.once('connect', () => { clearTimeout(timeout); resolve('connected'); });
    socket.once('connect_error', error => { clearTimeout(timeout); resolve(error.message); });
    socket.connect();
  });
  return { socket, outcome };
}

test('isolated signed v3 runtime blocks writes on invalid evidence and restores authorized operations', async ({ page }) => {
  const attestationPath = process.env.E2E_V3_ATTESTATION_PATH;
  assert.equal(path.dirname(attestationPath), tmpdir());
  assert.match(path.basename(attestationPath), /^mealkhata-v3-e2e-\d+\.json$/);
  const original = await readFile(attestationPath, 'utf8');

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('superadmin@example.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('E2E-Strong-Pass-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  expect((await page.request.get('/api/ready')).status()).toBe(200);

  const origin = new URL(page.url()).origin;
  const student = { displayName: 'Signed V3 Fixture', rosterOrder: 40,
    reason: 'Disposable signed browser acceptance' };
  try {
    const tampered = JSON.parse(original);
    tampered.signatures.owner = 'invalid';
    await writeFile(attestationPath, JSON.stringify(tampered));
    await expect.poll(async () => (await page.request.get('/api/ready')).status()).toBe(503);
    const denied = await page.request.post('/api/students', { data: student,
      headers: { Origin: origin } });
    expect(denied.status()).toBe(503);
    expect((await denied.json()).message).toMatch(/gate is closed/i);
  } finally {
    await writeFile(attestationPath, original);
  }

  await expect.poll(async () => (await page.request.get('/api/ready')).status()).toBe(200);
  const created = await page.request.post('/api/students', { data: student,
    headers: { Origin: origin } });
  expect(created.status()).toBe(201);
  const studentId = (await created.json()).data.studentId;
  await page.goto('/admin/members');
  await expect(page.getByTestId(`student-card-${studentId}`)).toContainText(student.displayName);
  await page.reload();
  await expect(page.getByTestId(`student-card-${studentId}`)).toContainText(student.displayName);
});

test('signed v3 socket accepts a canonical member ticket and rejects it after account revocation', async ({ page, browser }) => {
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  let socket;
  try {
    await memberPage.goto('/login');
    await memberPage.getByRole('textbox', { name: 'Email' }).fill('gaurav@example.test');
    await memberPage.getByRole('textbox', { name: 'Password' }).fill('E2E-Strong-Pass-2026!');
    await memberPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(memberPage).not.toHaveURL(/\/login$/);
    const ticketResponse = await memberPage.request.get('/api/auth/socket-ticket');
    expect(ticketResponse.status()).toBe(200);
    const { ticket } = await ticketResponse.json();
    const origin = new URL(memberPage.url()).origin;
    const connected = await connectWithTicket(ticket, origin);
    socket = connected.socket;
    expect(connected.outcome).toBe('connected');

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill('superadmin@example.test');
    await page.getByRole('textbox', { name: 'Password' }).fill('E2E-Strong-Pass-2026!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    const disabled = await page.request.post('/api/admin/members/gaurav/deactivate', {
      data: { currentPassword: 'E2E-Strong-Pass-2026!' }, headers: { Origin: origin },
    });
    expect(disabled.status()).toBe(200);
    socket.disconnect();
    const revoked = await connectWithTicket(ticket, origin);
    expect(revoked.outcome).toMatch(/Unauthorized socket session/);
    revoked.socket.disconnect();
  } finally {
    socket?.disconnect();
    await memberContext.close();
  }
});
