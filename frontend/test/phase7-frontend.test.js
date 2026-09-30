import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getRoleLabel, ROLE_LABELS, ROOMMATES } from '../src/lib/constants.js';
import { canInitiatePayment } from '../src/lib/paymentFlow.js';
import { getSafeNextPath } from '../src/lib/navigation.js';

describe('Phase 7 Frontend: Role Labels & Display', () => {
  test('provides correct role labels for all four roles', () => {
    assert.equal(ROLE_LABELS.viewer, 'Viewer');
    assert.equal(ROLE_LABELS.member, 'Member');
    assert.equal(ROLE_LABELS.admin, 'Admin');
    assert.equal(ROLE_LABELS.superadmin, 'Super Admin');

    assert.equal(getRoleLabel('viewer'), 'Viewer');
    assert.equal(getRoleLabel('member'), 'Member');
    assert.equal(getRoleLabel('admin'), 'Admin');
    assert.equal(getRoleLabel('superadmin'), 'Super Admin');
    assert.equal(getRoleLabel('unknown'), 'Viewer');
  });

  test('roommates list contains exactly the canonical three members', () => {
    assert.equal(ROOMMATES.length, 3);
    const ids = ROOMMATES.map((r) => r.id);
    assert.deepEqual(ids, ['gaurav', 'nikhil', 'devansh']);
  });
});

describe('Phase 7 Frontend: Payment Initiation Policy', () => {
  const gauravPayable = { id: 'gaurav', status: 'partial', remainingAmountPaise: 45_000 };
  const nikhilPayable = { id: 'nikhil', status: 'partial', remainingAmountPaise: 50_000 };

  test('Member can initiate payment only for their own card', () => {
    assert.equal(
      canInitiatePayment({ role: 'member', member: gauravPayable, currentMemberId: 'gaurav' }),
      true,
    );

    assert.equal(
      canInitiatePayment({ role: 'member', member: nikhilPayable, currentMemberId: 'gaurav' }),
      false,
    );

    assert.equal(
      canInitiatePayment({ role: 'member', member: gauravPayable, currentMemberId: 'nikhil' }),
      false,
    );
  });

  test('Viewer cannot initiate payment for any member', () => {
    assert.equal(canInitiatePayment({ role: 'viewer', member: gauravPayable }), false);
    assert.equal(canInitiatePayment({ role: 'viewer', member: nikhilPayable }), false);
  });

  test('Admin and Super Admin can initiate payment for any member with remaining due', () => {
    assert.equal(canInitiatePayment({ role: 'admin', member: gauravPayable }), true);
    assert.equal(canInitiatePayment({ role: 'admin', member: nikhilPayable }), true);
    assert.equal(canInitiatePayment({ role: 'superadmin', member: gauravPayable }), true);
    assert.equal(canInitiatePayment({ role: 'superadmin', member: nikhilPayable }), true);
  });
});

describe('Phase 7 Frontend: Meal Row Editability Logic', () => {
  function isRowEditable({ onChange, editable, editableMemberIds, memberId }) {
    return Boolean(onChange && (editableMemberIds ? editableMemberIds.includes(memberId) : editable));
  }

  const mockOnChange = () => {};

  test('Member only has editable control on their own row', () => {
    const editableMemberIds = ['gaurav'];

    assert.equal(
      isRowEditable({ onChange: mockOnChange, editable: true, editableMemberIds, memberId: 'gaurav' }),
      true,
    );

    assert.equal(
      isRowEditable({ onChange: mockOnChange, editable: true, editableMemberIds, memberId: 'nikhil' }),
      false,
    );

    assert.equal(
      isRowEditable({ onChange: mockOnChange, editable: true, editableMemberIds, memberId: 'devansh' }),
      false,
    );
  });

  test('Admin today has editable controls on all three member rows', () => {
    const editableMemberIds = ['gaurav', 'nikhil', 'devansh'];

    for (const memberId of ['gaurav', 'nikhil', 'devansh']) {
      assert.equal(
        isRowEditable({ onChange: mockOnChange, editable: true, editableMemberIds, memberId }),
        true,
      );
    }
  });

  test('Viewer has editable controls on none of the member rows', () => {
    const editableMemberIds = [];

    for (const memberId of ['gaurav', 'nikhil', 'devansh']) {
      assert.equal(
        isRowEditable({ onChange: mockOnChange, editable: false, editableMemberIds, memberId }),
        false,
      );
    }
  });
});

describe('Phase 7 Frontend: Login Redirection Logic', () => {
  test('computes appropriate redirect destinations for members and admins', () => {
    const computeDestination = (sessionRole, rawNext) => {
      if (sessionRole === 'admin' || sessionRole === 'superadmin') {
        return getSafeNextPath(rawNext, '/admin');
      }
      const safeNext = getSafeNextPath(rawNext, '/');
      return safeNext.startsWith('/admin') ? '/' : safeNext;
    };

    assert.equal(computeDestination('member', null), '/');
    assert.equal(computeDestination('member', '/admin'), '/');
    assert.equal(computeDestination('member', '/payments'), '/payments');
    assert.equal(computeDestination('member', 'https://evil.com'), '/');

    assert.equal(computeDestination('admin', null), '/admin');
    assert.equal(computeDestination('admin', '/payments'), '/payments');
    assert.equal(computeDestination('superadmin', null), '/admin');
  });
});
