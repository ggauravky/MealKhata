import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { io as createClient } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createSocketServer } from '../src/socket.js';
import { createSocketTicket, verifyActiveSocketIdentity,
  verifySocketTicket } from '../src/auth/socketTicket.service.js';

test('v3 socket ticket is short-lived, audience-bound and checks canonical revocation', async () => {
  const secret = 'isolated-socket-ticket-secret-with-forty-eight-characters';
  const ticket = await createSocketTicket({ authenticated: true, role: 'member',
    memberId: 'student_four', userId: 'account-4', sessionVersion: 3 }, { secret });
  const accounts = { findByUserId: async () => ({ userId: 'account-4', role: 'member',
    memberId: 'student_four', active: true, sessionVersion: 3 }) };
  const resolver = { assertKnown: async () => ({ studentId: 'student_four' }) };
  assert.equal((await verifySocketTicket(ticket, { secret, accounts, resolver })).userId, 'account-4');
  const identity = await verifySocketTicket(ticket, { secret, accounts, resolver });
  assert.equal(await verifyActiveSocketIdentity(identity, { accounts }), true);
  assert.equal(await verifyActiveSocketIdentity(identity, { accounts: {
    findByUserId: async () => ({ ...(await accounts.findByUserId()), sessionVersion: 4 }),
  } }), false);
  await assert.rejects(verifySocketTicket(ticket, { secret,
    accounts: { findByUserId: async () => ({ ...(await accounts.findByUserId()), active: false }) },
    resolver }), /invalid/i);
  await assert.rejects(verifySocketTicket(ticket, { secret,
    accounts: { findByUserId: async () => ({ ...(await accounts.findByUserId()), sessionVersion: 4 }) },
    resolver }), /invalid/i);
  await assert.rejects(createSocketTicket({ authenticated: true, role: 'admin', userId: null }, { secret }),
    /canonical/i);
});

test('socket ticket API requires an authenticated canonical account and returns no account secrets', async () => {
  const viewer = await request(createApp()).get('/api/auth/socket-ticket');
  assert.equal(viewer.status, 401);
  const app = createApp({ authenticate: (req, res, next) => {
    req.auth = { authenticated: true, role: 'member', memberId: 'student_four',
      userId: 'account-4', sessionVersion: 0 };
    next();
  } });
  const response = await request(app).get('/api/auth/socket-ticket');
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.ticket, 'string');
  assert.equal(response.body.expiresInSeconds, 60);
  assert.ok(!JSON.stringify(response.body).includes('passwordHash'));
});

test('v3 socket rejects anonymous and foreign-origin connections', async () => {
  const http = createServer();
  const io = createSocketServer(http, { config: {
    appOrigin: 'http://localhost:5173' }, production: true,
    verifyTicket: async ticket => {
      if (ticket !== 'good') throw new Error('Invalid ticket');
      return { userId: 'account-4' };
    } });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${http.address().port}`;
  const connect = (ticket, origin) => new Promise(resolve => {
    const client = createClient(url, { forceNew: true, reconnection: false,
      transports: ['websocket'],
      extraHeaders: origin ? { Origin: origin } : {}, auth: { ticket } });
    client.once('connect', () => { client.disconnect(); resolve('connected'); });
    client.once('connect_error', () => { client.disconnect(); resolve('rejected'); });
  });
  try {
    assert.equal(await connect(null, 'http://localhost:5173'), 'rejected');
    assert.equal(await connect('good', 'https://foreign.example.test'), 'rejected');
    assert.equal(await connect('good', 'http://localhost:5173'), 'connected');
  } finally {
    await new Promise(resolve => io.close(resolve));
    await new Promise(resolve => http.close(resolve));
  }
});

test('a revoked v3 account loses its already connected socket', async () => {
  const http = createServer();
  let active = true;
  const io = createSocketServer(http, { config: {
    appOrigin: 'http://localhost:5173' }, production: true,
  verifyTicket: async () => ({ userId: 'account-4', role: 'member',
    memberId: 'student_four', sessionVersion: 0 }),
  verifyActive: async () => active, revalidateIntervalMs: 20 });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const client = createClient(`http://127.0.0.1:${http.address().port}`, {
    forceNew: true, reconnection: false, transports: ['websocket'],
    extraHeaders: { Origin: 'http://localhost:5173' }, auth: { ticket: 'test' },
  });
  try {
    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    active = false;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Revoked socket stayed connected')), 2_000);
      client.once('disconnect', () => { clearTimeout(timeout); resolve(); });
    });
    assert.equal(client.connected, false);
  } finally {
    client.disconnect();
    await new Promise(resolve => io.close(resolve));
    await new Promise(resolve => http.close(resolve));
  }
});
