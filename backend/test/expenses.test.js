import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { ExpenseService } from '../src/expenses/expense.service.js';
import { calculateExpenseSplit } from '../src/expenses/expenseSplit.service.js';
import { createExpenseRouter } from '../src/routes/expense.routes.js';
import { InMemoryExpenseRepository } from './helpers/inMemoryExpenseRepository.js';

const ORIGIN = 'http://localhost:5173';
const CURRENT_MONTH = '2026-10';

const repository = new InMemoryExpenseRepository();
const service = new ExpenseService(repository);
const expenseRouter = createExpenseRouter({ service });

const testApp = createApp({
  expenses: expenseRouter,
});

async function cookieFor(role, memberId = null) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, { memberId })}`;
}

beforeEach(() => {
  repository.reset();
});

describe('MealKhata 2.0: Other Expenses & Shared Spending (Phase 2)', () => {
  describe('Canonical Split Engine (Unit Tests)', () => {
    test('Scenario A: ₹300 groceries split equally among 3 members', () => {
      const split = calculateExpenseSplit({
        amountPaise: 30000,
        paidByMemberId: 'gaurav',
        splitType: 'equal',
        participants: ['gaurav', 'nikhil', 'devansh'],
      });

      assert.equal(split.amountPaise, 30000);
      assert.equal(split.allocations.length, 3);
      assert.deepEqual(split.allocations, [
        { memberId: 'gaurav', amountPaise: 10000 },
        { memberId: 'nikhil', amountPaise: 10000 },
        { memberId: 'devansh', amountPaise: 10000 },
      ]);
      assert.deepEqual(split.reimbursementObligations, [
        { fromMemberId: 'nikhil', toMemberId: 'gaurav', amountPaise: 10000 },
        { fromMemberId: 'devansh', toMemberId: 'gaurav', amountPaise: 10000 },
      ]);
      assert.equal(split.totalInitialReceivablePaise, 20000);
    });

    test('Deterministic remainder: ₹100 split equally among 3 members', () => {
      const split = calculateExpenseSplit({
        amountPaise: 10000,
        paidByMemberId: 'gaurav',
        splitType: 'equal',
        participants: ['gaurav', 'nikhil', 'devansh'],
      });

      assert.equal(split.amountPaise, 10000);
      const sum = split.allocations.reduce((acc, a) => acc + a.amountPaise, 0);
      assert.equal(sum, 10000);

      assert.equal(split.allocations.find((a) => a.memberId === 'gaurav').amountPaise, 3334);
      assert.equal(split.allocations.find((a) => a.memberId === 'nikhil').amountPaise, 3333);
      assert.equal(split.allocations.find((a) => a.memberId === 'devansh').amountPaise, 3333);
    });

    test('Scenario B: ₹180 samosas split between 2 members (nikhil and devansh, paid by nikhil)', () => {
      const split = calculateExpenseSplit({
        amountPaise: 18000,
        paidByMemberId: 'nikhil',
        splitType: 'equal',
        participants: ['nikhil', 'devansh'],
      });

      assert.equal(split.amountPaise, 18000);
      assert.deepEqual(split.allocations, [
        { memberId: 'nikhil', amountPaise: 9000 },
        { memberId: 'devansh', amountPaise: 9000 },
      ]);
      assert.deepEqual(split.reimbursementObligations, [
        { fromMemberId: 'devansh', toMemberId: 'nikhil', amountPaise: 9000 },
      ]);
      assert.equal(split.totalInitialReceivablePaise, 9000);
    });

    test('Scenario C: Custom ₹450 pizza split (Gaurav ₹200, Nikhil ₹150, Devansh ₹100, paid by devansh)', () => {
      const split = calculateExpenseSplit({
        amountPaise: 45000,
        paidByMemberId: 'devansh',
        splitType: 'custom',
        customAllocations: [
          { memberId: 'gaurav', amountPaise: 20000 },
          { memberId: 'nikhil', amountPaise: 15000 },
          { memberId: 'devansh', amountPaise: 10000 },
        ],
      });

      assert.equal(split.amountPaise, 45000);
      assert.deepEqual(split.reimbursementObligations, [
        { fromMemberId: 'gaurav', toMemberId: 'devansh', amountPaise: 20000 },
        { fromMemberId: 'nikhil', toMemberId: 'devansh', amountPaise: 15000 },
      ]);
      assert.equal(split.totalInitialReceivablePaise, 35000);
    });

    test('Scenario E: Personal purchase (tea ₹20 paid by gaurav for gaurav)', () => {
      const split = calculateExpenseSplit({
        amountPaise: 2000,
        paidByMemberId: 'gaurav',
        splitType: 'personal',
        participants: ['gaurav'],
      });

      assert.equal(split.amountPaise, 2000);
      assert.deepEqual(split.allocations, [{ memberId: 'gaurav', amountPaise: 2000 }]);
      assert.deepEqual(split.reimbursementObligations, []);
      assert.equal(split.totalInitialReceivablePaise, 0);
    });

    test('Scenario F: Payer is NOT beneficiary (medicine ₹120 paid by gaurav for nikhil)', () => {
      const split = calculateExpenseSplit({
        amountPaise: 12000,
        paidByMemberId: 'gaurav',
        splitType: 'personal',
        participants: ['nikhil'],
      });

      assert.equal(split.amountPaise, 12000);
      assert.deepEqual(split.allocations, [{ memberId: 'nikhil', amountPaise: 12000 }]);
      assert.deepEqual(split.reimbursementObligations, [
        { fromMemberId: 'nikhil', toMemberId: 'gaurav', amountPaise: 12000 },
      ]);
      assert.equal(split.totalInitialReceivablePaise, 12000);
    });

    test('Custom split validation: sum mismatch is rejected with remaining amount error', () => {
      assert.throws(
        () =>
          calculateExpenseSplit({
            amountPaise: 45000,
            paidByMemberId: 'devansh',
            splitType: 'custom',
            customAllocations: [
              { memberId: 'gaurav', amountPaise: 20000 },
              { memberId: 'nikhil', amountPaise: 15000 },
              { memberId: 'devansh', amountPaise: 5000 }, // Total = 40000 != 45000
            ],
          }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.match(err.message, /Allocated amounts must total ₹450.00. ₹50.00 remains unallocated./);
          return true;
        },
      );
    });

    test('Rejects duplicate participants or invalid member IDs', () => {
      assert.throws(
        () =>
          calculateExpenseSplit({
            amountPaise: 30000,
            paidByMemberId: 'gaurav',
            splitType: 'equal',
            participants: ['gaurav', 'gaurav'],
          }),
        /Duplicate participants are not allowed/,
      );

      assert.throws(
        () =>
          calculateExpenseSplit({
            amountPaise: 30000,
            paidByMemberId: 'unknown_user',
            splitType: 'equal',
            participants: ['gaurav'],
          }),
        /Invalid merchant payer member ID/,
      );
    });
  });

  describe('API Endpoints & Workflows', () => {
    test('POST /api/expenses/preview returns calculated allocations without saving', async () => {
      const res = await request(testApp)
        .post('/api/expenses/preview')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          amountPaise: 30000,
          paidByMemberId: 'gaurav',
          splitType: 'equal',
          participants: ['gaurav', 'nikhil', 'devansh'],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.amountPaise, 30000);
      assert.equal(res.body.data.allocations.length, 3);
      assert.equal(repository.expenses.length, 0); // No mutation
    });

    test('Admin can create recorded expense; Members cannot create expense', async () => {
      // Member attempt should fail (403)
      const memberRes = await request(testApp)
        .post('/api/expenses')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'gaurav'))
        .send({
          date: '2026-10-20',
          title: 'Evening samosas',
          category: 'snacks',
          amountPaise: 18000,
          paidByMemberId: 'gaurav',
          splitType: 'equal',
          participants: ['gaurav', 'nikhil', 'devansh'],
        });
      assert.equal(memberRes.status, 403);

      // Admin attempt succeeds (201)
      const idempotencyKey = crypto.randomUUID();
      const adminRes = await request(testApp)
        .post('/api/expenses')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          date: '2026-10-20',
          title: 'Evening samosas',
          category: 'snacks',
          amountPaise: 18000,
          paidByMemberId: 'gaurav',
          splitType: 'equal',
          participants: ['gaurav', 'nikhil', 'devansh'],
          idempotencyKey,
        });

      assert.equal(adminRes.status, 201);
      assert.equal(adminRes.body.success, true);
      assert.equal(adminRes.body.data.title, 'Evening samosas');
      assert.equal(adminRes.body.data.amountPaise, 18000);
      assert.equal(adminRes.body.data.status, 'recorded');

      // Idempotent retry returns identical expense without duplicating
      const retryRes = await request(testApp)
        .post('/api/expenses')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          date: '2026-10-20',
          title: 'Evening samosas',
          category: 'snacks',
          amountPaise: 18000,
          paidByMemberId: 'gaurav',
          splitType: 'equal',
          participants: ['gaurav', 'nikhil', 'devansh'],
          idempotencyKey,
        });

      assert.equal(retryRes.status, 201);
      assert.equal(retryRes.body.data.expenseId, adminRes.body.data.expenseId);
      assert.equal(repository.expenses.length, 1);
    });

    test('Scenario D: Partial and full reimbursements update remaining debt accurately', async () => {
      // 1. Create ₹300 groceries paid by Gaurav split equally among Gaurav, Nikhil, Devansh
      const createRes = await request(testApp)
        .post('/api/expenses')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          date: '2026-10-20',
          title: 'Monthly groceries',
          category: 'groceries',
          amountPaise: 30000,
          paidByMemberId: 'gaurav',
          splitType: 'equal',
          participants: ['gaurav', 'nikhil', 'devansh'],
        });
      assert.equal(createRes.status, 201);
      const expenseId = createRes.body.data.expenseId;

      // Check initial state: Nikhil owes ₹100, Devansh owes ₹100
      let detailRes = await request(testApp)
        .get(`/api/expenses/${expenseId}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));
      assert.equal(detailRes.body.data.financials.totalOutstandingReceivablePaise, 20000);

      // 2. Nikhil pays ₹60 partial reimbursement
      const reimbRes1 = await request(testApp)
        .post(`/api/expenses/${expenseId}/reimbursements`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          fromMemberId: 'nikhil',
          amountPaise: 6000,
          method: 'upi',
          reference: 'UPI-NIKHIL-60',
        });
      assert.equal(reimbRes1.status, 201);
      assert.equal(reimbRes1.body.data.amountPaise, 6000);

      // 3. Inspect detail: Nikhil now owes ₹40, Devansh still owes ₹100, total receivable = ₹140
      detailRes = await request(testApp)
        .get(`/api/expenses/${expenseId}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));

      const nikhilShare = detailRes.body.data.financials.memberShares.find((m) => m.memberId === 'nikhil');
      const devanshShare = detailRes.body.data.financials.memberShares.find((m) => m.memberId === 'devansh');
      assert.equal(nikhilShare.reimbursedPaise, 6000);
      assert.equal(nikhilShare.remainingOwedPaise, 4000);
      assert.equal(devanshShare.reimbursedPaise, 0);
      assert.equal(devanshShare.remainingOwedPaise, 10000);
      assert.equal(detailRes.body.data.financials.totalOutstandingReceivablePaise, 14000);

      // 4. Nikhil attempts to overpay (pay ₹50 when only ₹40 remains) -> Rejected 409
      const overpayRes = await request(testApp)
        .post(`/api/expenses/${expenseId}/reimbursements`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          fromMemberId: 'nikhil',
          amountPaise: 5000,
          method: 'cash',
        });
      assert.equal(overpayRes.status, 409);
      assert.match(overpayRes.body.message, /exceeds remaining due/);

      // 5. Nikhil pays exact remaining ₹40 -> Fully reimbursed
      const reimbRes2 = await request(testApp)
        .post(`/api/expenses/${expenseId}/reimbursements`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          fromMemberId: 'nikhil',
          amountPaise: 4000,
          method: 'cash',
        });
      assert.equal(reimbRes2.status, 201);

      detailRes = await request(testApp)
        .get(`/api/expenses/${expenseId}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));
      const nikhilFinal = detailRes.body.data.financials.memberShares.find((m) => m.memberId === 'nikhil');
      assert.equal(nikhilFinal.remainingOwedPaise, 0);
      assert.equal(nikhilFinal.settlementStatus, 'fully_reimbursed');
    });

    test('Payer cannot reimburse themselves', async () => {
      const createRes = await request(testApp)
        .post('/api/expenses')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          date: '2026-10-20',
          title: 'Snacks',
          category: 'snacks',
          amountPaise: 10000,
          paidByMemberId: 'gaurav',
          splitType: 'equal',
          participants: ['gaurav', 'nikhil'],
        });

      const res = await request(testApp)
        .post(`/api/expenses/${createRes.body.data.expenseId}/reimbursements`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          fromMemberId: 'gaurav',
          amountPaise: 5000,
          method: 'cash',
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Payer cannot reimburse themselves/);
    });

    test('Voiding protection: Cannot void expense with active reimbursements', async () => {
      const createRes = await request(testApp)
        .post('/api/expenses')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          date: '2026-10-20',
          title: 'Household supplies',
          category: 'household_supplies',
          amountPaise: 20000,
          paidByMemberId: 'gaurav',
          splitType: 'equal',
          participants: ['gaurav', 'nikhil'],
        });
      const expenseId = createRes.body.data.expenseId;

      const reimbRes = await request(testApp)
        .post(`/api/expenses/${expenseId}/reimbursements`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          fromMemberId: 'nikhil',
          amountPaise: 10000,
          method: 'upi',
        });
      const reimbursementId = reimbRes.body.data.reimbursementId;

      // Super Admin attempts to void expense while reimbursement is active -> 409
      const voidExpRes = await request(testApp)
        .post(`/api/expenses/${expenseId}/void`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ reason: 'Mistake in purchase' });
      assert.equal(voidExpRes.status, 409);
      assert.match(voidExpRes.body.message, /Cannot void expense with 1 active reimbursement/);

      // Super Admin voids reimbursement first
      const voidReimbRes = await request(testApp)
        .post(`/api/expenses/reimbursements/${reimbursementId}/void`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ reason: 'Payment reversed by bank' });
      assert.equal(voidReimbRes.status, 200);
      assert.equal(voidReimbRes.body.data.status, 'voided');

      // Now voiding the expense succeeds
      const voidExpRes2 = await request(testApp)
        .post(`/api/expenses/${expenseId}/void`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.SUPERADMIN))
        .send({ reason: 'Mistake in purchase' });
      assert.equal(voidExpRes2.status, 200);
      assert.equal(voidExpRes2.body.data.status, 'voided');
    });

    test('Privacy: Member can only access expenses they are involved in', async () => {
      // Create expense involving only Gaurav and Nikhil (paid by Gaurav for Nikhil)
      const createRes = await request(testApp)
        .post('/api/expenses')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          date: '2026-10-20',
          title: 'Private personal book',
          category: 'other',
          amountPaise: 50000,
          paidByMemberId: 'gaurav',
          splitType: 'personal',
          participants: ['nikhil'],
        });
      const expenseId = createRes.body.data.expenseId;

      // Devansh (unrelated member) attempts to access expense detail -> 403
      const devanshRes = await request(testApp)
        .get(`/api/expenses/${expenseId}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'devansh'));
      assert.equal(devanshRes.status, 403);

      // Nikhil (beneficiary) can access
      const nikhilRes = await request(testApp)
        .get(`/api/expenses/${expenseId}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'nikhil'));
      assert.equal(nikhilRes.status, 200);
      assert.equal(nikhilRes.body.data.expenseId, expenseId);

      // Devansh lists expenses: the private expense is filtered out
      const listRes = await request(testApp)
        .get(`/api/expenses?month=${CURRENT_MONTH}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'devansh'));
      assert.equal(listRes.status, 200);
      assert.equal(listRes.body.data.length, 0);

      // Unauthenticated / Viewer cannot access private expenses (401)
      const viewerRes = await request(testApp)
        .get(`/api/expenses?month=${CURRENT_MONTH}`)
        .set('Origin', ORIGIN);
      assert.equal(viewerRes.status, 401);
    });

    test('Summary API: Member receives only personal metrics; Admin receives household breakdown', async () => {
      // 1. Create groceries: ₹300 paid by Gaurav, 3 equal shares
      await request(testApp)
        .post('/api/expenses')
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN))
        .send({
          date: '2026-10-15',
          title: 'Groceries',
          category: 'groceries',
          amountPaise: 30000,
          paidByMemberId: 'gaurav',
          splitType: 'equal',
          participants: ['gaurav', 'nikhil', 'devansh'],
        });

      // Member Nikhil requests summary:
      const nikhilSummary = await request(testApp)
        .get(`/api/expenses/summary/${CURRENT_MONTH}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.MEMBER, 'nikhil'));

      assert.equal(nikhilSummary.status, 200);
      assert.equal(nikhilSummary.body.data.spendingSharePaise, 10000);
      assert.equal(nikhilSummary.body.data.paidMerchantsPaise, 0);
      assert.equal(nikhilSummary.body.data.iOweOthersPaise, 10000);
      assert.equal(nikhilSummary.body.data.owedToMePaise, 0);
      assert.equal(nikhilSummary.body.data.categoryBreakdown, undefined); // Private: no household leakage

      // Admin requests summary:
      const adminSummary = await request(testApp)
        .get(`/api/expenses/summary/${CURRENT_MONTH}`)
        .set('Origin', ORIGIN)
        .set('Cookie', await cookieFor(ROLES.ADMIN));

      assert.equal(adminSummary.status, 200);
      assert.equal(adminSummary.body.data.totalExpensesPaise, 30000);
      assert.equal(adminSummary.body.data.totalOutstandingReimbursementsPaise, 20000);
      assert.equal(adminSummary.body.data.categoryBreakdown.groceries.totalPaise, 30000);
      assert.equal(adminSummary.body.data.members.gaurav.paidMerchantsPaise, 30000);
      assert.equal(adminSummary.body.data.members.gaurav.owedToMePaise, 20000);
      assert.equal(adminSummary.body.data.members.nikhil.iOweOthersPaise, 10000);
    });
  });

  describe('Accounting Reconciliation & Invariants (Section 48)', () => {
    test('All active expenses satisfy exact accounting equality', async () => {
      // 1. Create a set of varied expenses
      const exp1 = await service.createExpense({
        date: '2026-10-05',
        title: 'Electricity bill',
        category: 'utilities',
        amountPaise: 120000,
        paidByMemberId: 'gaurav',
        splitType: 'equal',
        participants: ['gaurav', 'nikhil', 'devansh'],
        actorRole: ROLES.ADMIN,
      });

      const exp2 = await service.createExpense({
        date: '2026-10-10',
        title: 'Dinner pizza',
        category: 'outside_food',
        amountPaise: 45000,
        paidByMemberId: 'nikhil',
        splitType: 'custom',
        customAllocations: [
          { memberId: 'gaurav', amountPaise: 20000 },
          { memberId: 'nikhil', amountPaise: 15000 },
          { memberId: 'devansh', amountPaise: 10000 },
        ],
        actorRole: ROLES.ADMIN,
      });

      // 2. Add some reimbursements
      await service.recordReimbursement({
        expenseId: exp1.expenseId,
        fromMemberId: 'nikhil',
        amountPaise: 20000,
        actorRole: ROLES.ADMIN,
      });

      await service.recordReimbursement({
        expenseId: exp2.expenseId,
        fromMemberId: 'gaurav',
        amountPaise: 10000,
        actorRole: ROLES.ADMIN,
      });

      // 3. Test Invariants on each expense
      const allExpenses = await repository.findExpensesByMonth(CURRENT_MONTH, { includeVoided: false });
      const allReimbursements = await repository.findReimbursementsByMonth(CURRENT_MONTH, { includeVoided: false });

      for (const exp of allExpenses) {
        // Invariant 1: sum(all member shares) = expense amount
        const allocationSum = exp.allocations.reduce((sum, a) => sum + a.amountPaise, 0);
        assert.equal(allocationSum, exp.amountPaise);

        // Invariant 2: total initial receivable = expense amount - payer own share
        const payerAlloc = exp.allocations.find((a) => a.memberId === exp.paidByMemberId);
        const payerShare = payerAlloc ? payerAlloc.amountPaise : 0;
        const initialReceivable = exp.amountPaise - payerShare;

        const expReimbursements = allReimbursements.filter((r) => r.expenseId === exp.expenseId);
        const totalReimbursed = expReimbursements.reduce((sum, r) => sum + r.amountPaise, 0);

        // Invariant 3: for every nonpayer beneficiary: reimbursed + outstanding = member share
        let totalOutstanding = 0;
        for (const alloc of exp.allocations) {
          if (alloc.memberId !== exp.paidByMemberId) {
            const memberReimbursed = expReimbursements
              .filter((r) => r.fromMemberId === alloc.memberId)
              .reduce((sum, r) => sum + r.amountPaise, 0);
            const memberRemaining = Math.max(0, alloc.amountPaise - memberReimbursed);
            assert.equal(memberReimbursed + memberRemaining, alloc.amountPaise);
            totalOutstanding += memberRemaining;
          }
        }

        // Invariant 4: total recorded reimbursements + total outstanding = initial receivable
        assert.equal(totalReimbursed + totalOutstanding, initialReceivable);
      }

      // Invariant 5: sum(all active expense amounts) = monthly household total
      const householdSummary = await service.getHouseholdExpenseSummary(CURRENT_MONTH, { actorRole: ROLES.ADMIN });
      const sumOfAmounts = allExpenses.reduce((sum, e) => sum + e.amountPaise, 0);
      assert.equal(householdSummary.totalExpensesPaise, sumOfAmounts);
    });
  });
});
