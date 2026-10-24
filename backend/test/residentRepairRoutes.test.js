import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createStayRouter } from '../src/routes/stay.routes.js';
import { createRoomFeeRouter } from '../src/routes/roomFee.routes.js';

const ORIGIN = 'http://localhost:5173';

async function cookieFor(role) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role)}`;
}

describe('resident repair administration routes', () => {
  test('Stay restoration preview and confirm are Super Admin only and forward the approved payload', async () => {
    const calls = [];
    const stay = { stayId: 'stay-1', memberId: 'gaurav', revision: 3 };
    const service = {
      getStayById: async () => stay,
      previewRestoreResident: async (payload) => {
        calls.push(['preview', payload]);
        return { previewToken: 'a'.repeat(64), canApply: true };
      },
      restoreResident: async (payload) => {
        calls.push(['restore', payload]);
        return { stay: { ...stay, status: 'ACTIVE' } };
      },
    };
    const app = createApp({
      stays: createStayRouter({
        service,
        broadcastStay: () => {},
        broadcastDeposit: () => {},
        broadcastClearance: () => {},
        broadcastRoomFees: () => {},
      }),
    });
    const payload = {
      expectedRevision: 3,
      occupancyFromDate: '2026-10-01',
      roomId: 'room-lower',
      assignmentAction: 'REOPEN_EXISTING',
      assignmentId: 'assignment-1',
      reason: 'Reverse an incorrect historical checkout',
    };

    await request(app)
      .post('/api/stays/stay-1/restoration-preview')
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send(payload)
      .expect(403);

    const preview = await request(app)
      .post('/api/stays/stay-1/restoration-preview')
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
      .send(payload)
      .expect(200);
    assert.equal(preview.body.data.previewToken, 'a'.repeat(64));

    await request(app)
      .post('/api/stays/stay-1/restore')
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
      .send({ ...payload, previewToken: 'a'.repeat(64) })
      .expect(200);

    assert.equal(calls.length, 2);
    assert.equal(calls[0][1].stayId, 'stay-1');
    assert.equal(calls[0][1].actorRole, ROLES.SUPERADMIN);
    assert.equal(calls[1][1].previewToken, 'a'.repeat(64));
  });

  test('Fee Plan reconciliation preview and confirm are Super Admin only', async () => {
    const calls = [];
    const service = {
      previewFeePlanReconciliation: async (payload) => {
        calls.push(['preview', payload]);
        return { previewToken: 'b'.repeat(64), canApply: true };
      },
      reconcileFeePlans: async (payload) => {
        calls.push(['reconcile', payload]);
        return { createdPlans: [], supersededPlanIds: [] };
      },
    };
    const app = createApp({
      roomFees: createRoomFeeRouter({ service, broadcast: () => {} }),
    });
    const payload = {
      schedule: [{ effectiveFromMonth: '2026-10', effectiveUntilMonth: null, amountPaise: 450000, dueDay: 5 }],
      reason: 'Verified rent schedule',
    };

    await request(app)
      .post('/api/room-fees/plans/gaurav/reconciliation-preview')
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.ADMIN))
      .send(payload)
      .expect(403);

    await request(app)
      .post('/api/room-fees/plans/gaurav/reconciliation-preview')
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
      .send(payload)
      .expect(200);

    await request(app)
      .post('/api/room-fees/plans/gaurav/reconcile')
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
      .send({ ...payload, previewToken: 'b'.repeat(64) })
      .expect(200);

    assert.equal(calls.length, 2);
    assert.equal(calls[0][1].memberId, 'gaurav');
    assert.equal(calls[1][1].actorRole, ROLES.SUPERADMIN);
  });
});
