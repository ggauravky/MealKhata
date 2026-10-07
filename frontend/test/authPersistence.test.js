import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isNetworkOrServerError, normalizeSession, viewerSession } from '../src/lib/session.js';

describe('Frontend Session Normalization & Persistence Policy', () => {
  test('Requirement 117: Admin session preserves displayName and safe defaults', () => {
    // With explicit displayName from server
    const adminSession = normalizeSession({
      authenticated: true,
      role: 'admin',
      displayName: 'Household Admin',
      expiresAt: '2026-10-14T20:00:00.000Z',
      capabilities: { canEditToday: true, canEditPast: false, canEditFuture: false },
    });

    assert.equal(adminSession.authenticated, true);
    assert.equal(adminSession.role, 'admin');
    assert.equal(adminSession.displayName, 'Household Admin');
    assert.equal(adminSession.expiresAt, '2026-10-14T20:00:00.000Z');
    assert.equal(adminSession.capabilities.canEditToday, true);

    // Fallback when displayName is null/omitted
    const fallbackAdmin = normalizeSession({
      authenticated: true,
      role: 'admin',
      displayName: null,
      capabilities: { canEditToday: true },
    });
    assert.equal(fallbackAdmin.displayName, 'Household Admin');
  });

  test('Requirement 117: Super Admin session preserves displayName and safe defaults', () => {
    const superAdminSession = normalizeSession({
      authenticated: true,
      role: 'superadmin',
      displayName: 'Super Admin',
      expiresAt: '2026-10-14T20:00:00.000Z',
      capabilities: { canEditToday: true, canEditPast: true, canEditFuture: true },
    });

    assert.equal(superAdminSession.authenticated, true);
    assert.equal(superAdminSession.role, 'superadmin');
    assert.equal(superAdminSession.displayName, 'Super Admin');
    assert.equal(superAdminSession.expiresAt, '2026-10-14T20:00:00.000Z');
    assert.equal(superAdminSession.capabilities.canEditPast, true);

    const fallbackSuper = normalizeSession({
      authenticated: true,
      role: 'superadmin',
      displayName: '',
    });
    assert.equal(fallbackSuper.displayName, 'Super Admin');
  });

  test('Member session preserves memberId and custom displayName', () => {
    const memberSession = normalizeSession({
      authenticated: true,
      role: 'member',
      memberId: 'gaurav',
      displayName: 'Gaurav Kumar',
      expiresAt: '2026-10-08T08:00:00.000Z',
      capabilities: { canEditToday: true, canEditPast: false, canEditFuture: false },
    });

    assert.equal(memberSession.authenticated, true);
    assert.equal(memberSession.role, 'member');
    assert.equal(memberSession.memberId, 'gaurav');
    assert.equal(memberSession.displayName, 'Gaurav Kumar');
    assert.equal(memberSession.expiresAt, '2026-10-08T08:00:00.000Z');
  });

  test('Requirement 116: Invalid or unauthenticated session normalizes to viewerSession', () => {
    for (const invalid of [
      null,
      undefined,
      {},
      { authenticated: false },
      { authenticated: true, role: 'invalid_role' },
      { authenticated: true, role: 'viewer' },
    ]) {
      const normalized = normalizeSession(invalid);
      assert.deepEqual(normalized, viewerSession);
      assert.equal(normalized.authenticated, false);
      assert.equal(normalized.role, 'viewer');
      assert.equal(normalized.displayName, null);
      assert.equal(normalized.expiresAt, null);
    }
  });

  test('Requirement 27 & 28: Network and server failures are not treated as valid viewer sessions', () => {
    // Network failures produce status 0 or 5xx, which should be distinguishable from confirmed 200 Viewer
    const networkError = { status: 0, message: 'Failed to fetch' };
    assert.equal(isNetworkOrServerError(networkError), true);

    const serverColdStart = { status: 503, message: 'Service Unavailable' };
    assert.equal(isNetworkOrServerError(serverColdStart), true);

    const authRejection = { status: 401, message: 'Invalid credentials' };
    assert.equal(isNetworkOrServerError(authRejection), false);
  });
});
