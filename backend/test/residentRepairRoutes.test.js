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
  test('does not expose hard deletion of Room Assignments', () => {
    const router = createRoomFeeRouter({
      service: {},
      notifyChange: () => {},
    });
    const deleteAssignmentRoute = router.stack.find((layer) => (
      layer.route?.path === '/assignments/:assignmentId' && layer.route?.methods?.delete
    ));
    assert.equal(deleteAssignmentRoute, undefined);
  });
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

  test('targeted room, historical, and payment correction routes require Super Admin and forward preview tokens', async () => {
    const calls = [];
    const stay = { stayId: 'stay-1', memberId: 'gaurav', revision: 3 };
    const service = {
      getStayById: async () => stay,
      previewRoomAssignmentRepair: async (payload) => {
        calls.push(['room-preview', payload]);
        return { previewToken: 'c'.repeat(64), canApply: true };
      },
      repairRoomAssignment: async (payload) => {
        calls.push(['room-apply', payload]);
        return { stay };
      },
      previewHistoricalStayReconciliation: async (payload) => {
        calls.push(['history-preview', payload]);
        return { previewToken: 'd'.repeat(64), canApply: true };
      },
      reconcileHistoricalStay: async (payload) => {
        calls.push(['history-apply', payload]);
        return { stay: { ...stay, status: 'SUPERSEDED' } };
      },
    };
    const deposits = {
      previewPaymentReclassification: async (payload) => {
        calls.push(['payment-preview', payload]);
        return { previewToken: 'e'.repeat(64), canApply: true };
      },
      reclassifyPayment: async (payload) => {
        calls.push(['payment-apply', payload]);
        return { reclassificationId: 'reclass-1' };
      },
    };
    const app = createApp({
      stays: createStayRouter({
        service,
        deposits,
        broadcastStay: () => {},
        broadcastDeposit: () => {},
        broadcastClearance: () => {},
        broadcastRoomFees: () => {},
      }),
    });
    const headers = async (role) => ({ Origin: ORIGIN, Cookie: await cookieFor(role) });
    const roomPayload = {
      roomId: 'room-lower',
      assignmentAction: 'EXTEND_EXISTING_ASSIGNMENT',
      assignmentId: 'assignment-2',
      expectedRevision: 3,
      reason: 'Verified continuous occupancy',
    };
    await request(app).post('/api/stays/stay-1/room-repair-preview').set(await headers(ROLES.ADMIN)).send(roomPayload).expect(403);
    await request(app).post('/api/stays/stay-1/room-repair-preview').set(await headers(ROLES.SUPERADMIN)).send(roomPayload).expect(200);
    await request(app).post('/api/stays/stay-1/room-repair').set(await headers(ROLES.SUPERADMIN)).send({ ...roomPayload, previewToken: 'c'.repeat(64) }).expect(200);

    const historyPayload = {
      supersededByStayId: 'stay-active',
      expectedRevision: 3,
      reason: 'Incorrect checkout superseded by continuous active Stay',
    };
    await request(app).post('/api/stays/stay-1/historical-reconciliation-preview').set(await headers(ROLES.SUPERADMIN)).send(historyPayload).expect(200);
    await request(app).post('/api/stays/stay-1/historical-reconcile').set(await headers(ROLES.SUPERADMIN)).send({ ...historyPayload, previewToken: 'd'.repeat(64) }).expect(200);

    const paymentPayload = {
      sourceDepositTransactionId: 'receipt-1',
      expectedAccountRevision: 0,
      allocations: [{ category: 'UNALLOCATED_CREDIT', memberId: 'gaurav', targetAccount: 'PENDING_CLASSIFICATION', amountPaise: 4_800_000 }],
      reason: 'Real receipt pending verified classification',
      idempotencyKey: 'idempotency-1',
    };
    await request(app).post('/api/stays/stay-1/deposit/reclassification-preview').set(await headers(ROLES.SUPERADMIN)).send(paymentPayload).expect(200);
    await request(app).post('/api/stays/stay-1/deposit/reclassify').set(await headers(ROLES.SUPERADMIN)).send({ ...paymentPayload, previewToken: 'e'.repeat(64) }).expect(200);

    assert.deepEqual(calls.map(([name]) => name), [
      'room-preview',
      'room-apply',
      'history-preview',
      'history-apply',
      'payment-preview',
      'payment-apply',
    ]);
    assert.ok(calls.every(([, payload]) => payload.actorRole === ROLES.SUPERADMIN));
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
