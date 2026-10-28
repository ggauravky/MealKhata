import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { createFinancialOverviewService } from '../src/finance/financialOverview.service.js';
import {
  reconcileMemberFinances,
  reconcileHouseholdFinances,
  FinancialReconciliationError,
} from '../src/finance/financialReconciliation.service.js';
import { createFinanceRouter } from '../src/routes/finance.routes.js';

const ORIGIN = 'http://localhost:5173';
const CURRENT_MONTH = '2026-10';
const NOW = new Date('2026-10-20T12:00:00.000Z');

// Mock domain services
function createMockPaymentSummaries(overrides = {}) {
  return {
    async getSummary(month) {
      return {
        month,
        periodType: 'current',
        ratesConfigured: true,
        members: {
          gaurav: {
            billAmountPaise: 130000, // ₹1,300
            paidAmountPaise: 50000,  // ₹500
            remainingAmountPaise: 80000, // ₹800
            overpaidAmountPaise: 0,
            status: 'partial',
            projectedBillAmountPaise: 210000,
          },
          nikhil: {
            billAmountPaise: 140000, // ₹1,400
            paidAmountPaise: 140000, // ₹1,400
            remainingAmountPaise: 0,
            overpaidAmountPaise: 0,
            status: 'paid',
            projectedBillAmountPaise: 210000,
          },
          devansh: {
            billAmountPaise: 150000, // ₹1,500
            paidAmountPaise: 100000, // ₹1,000
            remainingAmountPaise: 50000, // ₹500
            overpaidAmountPaise: 0,
            status: 'partial',
            projectedBillAmountPaise: 210000,
          },
          ...overrides.members,
        },
        room: {
          billAmountPaise: 420000, // ₹4,200
          paidAmountPaise: 290000, // ₹2,900
          remainingAmountPaise: 130000, // ₹1,300
          overpaidAmountPaise: 0,
          status: 'partial',
          ...overrides.room,
        },
      };
    },
  };
}

function createMockSettlements(isClosed = false) {
  return {
    async isMonthClosed() {
      return isClosed;
    },
    async getActiveSettlement(month) {
      if (!isClosed) return null;
      return {
        month,
        status: 'closed',
        snapshot: {
          members: {
            gaurav: {
              billAmountPaise: 130000,
              paidAmountPaise: 130000,
              remainingAmountPaise: 0,
              overpaidAmountPaise: 0,
              status: 'paid',
            },
            nikhil: {
              billAmountPaise: 140000,
              paidAmountPaise: 140000,
              remainingAmountPaise: 0,
              overpaidAmountPaise: 0,
              status: 'paid',
            },
            devansh: {
              billAmountPaise: 150000,
              paidAmountPaise: 150000,
              remainingAmountPaise: 0,
              overpaidAmountPaise: 0,
              status: 'paid',
            },
          },
          room: {
            billAmountPaise: 420000,
            paidAmountPaise: 420000,
            remainingAmountPaise: 0,
            overpaidAmountPaise: 0,
            status: 'paid',
          },
        },
      };
    },
  };
}

function createMockRoomFees(overrides = {}) {
  return {
    async getMemberOverview({ memberId, targetMonth }) {
      if (memberId === 'gaurav') {
        return {
          memberId: 'gaurav',
          currentRoom: { roomNumber: '204' },
          scheduledFeePaise: 280000,
          currentMonthCharge: {
            finalBillAmountPaise: 280000, // ₹2,800
            paidAmountPaise: 200000,      // ₹2,000
            remainingAmountPaise: 80000,  // ₹800
            overpaidAmountPaise: 0,
            paymentStatus: 'partial',
            dueDate: '2026-10-10',
            roomNumber: '204',
            status: 'issued',
          },
        };
      }
      if (memberId === 'nikhil') {
        return {
          memberId: 'nikhil',
          currentRoom: { roomNumber: '204' },
          scheduledFeePaise: 280000,
          currentMonthCharge: {
            finalBillAmountPaise: 280000,
            paidAmountPaise: 280000,
            remainingAmountPaise: 0,
            overpaidAmountPaise: 0,
            paymentStatus: 'paid',
            dueDate: '2026-10-10',
            roomNumber: '204',
            status: 'issued',
          },
        };
      }
      // Devansh
      return {
        memberId: 'devansh',
        currentRoom: { roomNumber: '101' },
        scheduledFeePaise: 350000,
        currentMonthCharge: {
          finalBillAmountPaise: 350000,
          paidAmountPaise: 350000,
          remainingAmountPaise: 0,
          overpaidAmountPaise: 0,
          paymentStatus: 'paid',
          dueDate: '2026-10-10',
          roomNumber: '101',
          status: 'issued',
        },
      };
    },
    async getMonthlySummary(month, actorRole) {
      return {
        month,
        totalBilledPaise: 910000, // ₹9,100 (2800 + 2800 + 3500)
        totalCollectedPaise: 830000, // ₹8,300 (2000 + 2800 + 3500)
        totalOutstandingPaise: 80000, // ₹800
      };
    },
    async getChargesForMonth(month, actorRole) {
      return [
        {
          chargeId: 'c1',
          memberId: 'gaurav',
          roomNumber: '204',
          baseAmountPaise: 280000,
          adjustments: [],
          finalBillAmountPaise: 280000,
          paidAmountPaise: 200000,
          remainingAmountPaise: 80000,
          paymentStatus: 'partial',
          dueDate: '2026-10-10',
        },
        {
          chargeId: 'c2',
          memberId: 'nikhil',
          roomNumber: '204',
          baseAmountPaise: 280000,
          adjustments: [],
          finalBillAmountPaise: 280000,
          paidAmountPaise: 280000,
          remainingAmountPaise: 0,
          paymentStatus: 'paid',
          dueDate: '2026-10-10',
        },
        {
          chargeId: 'c3',
          memberId: 'devansh',
          roomNumber: '101',
          baseAmountPaise: 350000,
          adjustments: [],
          finalBillAmountPaise: 350000,
          paidAmountPaise: 350000,
          remainingAmountPaise: 0,
          paymentStatus: 'paid',
          dueDate: '2026-10-10',
        },
      ];
    },
  };
}

function createMockExpenses() {
  return {
    async getMemberExpenseSummary(arg1, arg2) {
      const memberId = ['gaurav', 'nikhil', 'devansh'].includes(arg1) ? arg1 : arg2;
      const month = ['gaurav', 'nikhil', 'devansh'].includes(arg1) ? arg2 : arg1;
      if (memberId === 'gaurav') {
        return {
          spendingSharePaise: 36000, // ₹360
          merchantSpendingPaise: 25000, // ₹250
          owedToOthersPaise: 15000,  // ₹150 (owes Nikhil)
          owedToMePaise: 20000,      // ₹200 (Devansh owes Gaurav)
        };
      }
      if (memberId === 'nikhil') {
        return {
          spendingSharePaise: 42000, // ₹420
          merchantSpendingPaise: 60000, // ₹600
          owedToOthersPaise: 0,
          owedToMePaise: 15000, // ₹150 from Gaurav
        };
      }
      // Devansh
      return {
        spendingSharePaise: 50000, // ₹500
        merchantSpendingPaise: 43000, // ₹430
        owedToOthersPaise: 20000, // ₹200 to Gaurav
        owedToMePaise: 0,
      };
    },
    async listExpensesByMonth(month, { actorMemberId } = {}) {
      return [
        {
          expenseId: 'e1',
          date: '2026-10-15',
          title: 'Groceries',
          category: 'groceries',
          amountPaise: 128000, // ₹1,280 total (360 + 420 + 500)
          paidByMemberId: 'gaurav',
          splitType: 'custom',
          status: 'recorded',
          allocations: [
            { memberId: 'gaurav', amountPaise: 36000 },
            { memberId: 'nikhil', amountPaise: 42000 },
            { memberId: 'devansh', amountPaise: 50000 },
          ],
          memberShares: [
            { memberId: 'gaurav', sharePaise: 36000, remainingOwedPaise: 0 },
            { memberId: 'nikhil', sharePaise: 42000, remainingOwedPaise: 0 },
            { memberId: 'devansh', sharePaise: 50000, remainingOwedPaise: 20000 },
          ],
        },
        {
          expenseId: 'e2',
          date: '2026-10-18',
          title: 'Snacks & Tea',
          category: 'snacks',
          amountPaise: 15000,
          paidByMemberId: 'nikhil',
          splitType: 'personal',
          status: 'recorded',
          allocations: [{ memberId: 'gaurav', amountPaise: 15000 }],
          memberShares: [{ memberId: 'gaurav', sharePaise: 15000, remainingOwedPaise: 15000 }],
        },
      ];
    },
    async getHouseholdExpenseSummary(month) {
      return {
        month,
        totalExpensesPaise: 128000, // ₹1,280 (sum of spending shares: 360 + 420 + 500 = 1280)
        totalOutstandingReimbursementsPaise: 35000, // ₹350 (150 from gaurav + 200 from devansh)
        totalReimbursementsPaidPaise: 25000,
        categoryBreakdown: {
          groceries: { count: 1, totalPaise: 128000 },
        },
      };
    },
  };
}

async function cookieFor(role, memberId = null) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, { memberId })}`;
}

describe('MealKhata 2.0: Unified Financial Overview & Reporting (Phase 3)', () => {
  let overviewService;
  let financeRouter;
  let testApp;

  beforeEach(() => {
    overviewService = createFinancialOverviewService({
      paymentSummaries: createMockPaymentSummaries(),
      settlements: createMockSettlements(false),
      roomFees: createMockRoomFees(),
      expenses: createMockExpenses(),
      now: () => NOW,
    });

    financeRouter = createFinanceRouter({ overviewService });
    testApp = createApp({ finance: financeRouter });
  });

  describe('Canonical Member Financial Model (Section 6, 7 & 8)', () => {
    test('Scenario 8: Gaurav October 2026 exact payable calculation without receivable netting', async () => {
      const overview = await overviewService.getMemberFinancialOverview({
        memberId: 'gaurav',
        month: CURRENT_MONTH,
        actorRole: ROLES.MEMBER,
      });

      // 1. Mess Dues
      assert.equal(overview.mess.billPaise, 130000, 'Mess bill should be ₹1,300');
      assert.equal(overview.mess.paidPaise, 50000, 'Mess paid should be ₹500');
      assert.equal(overview.mess.remainingPaise, 80000, 'Mess due should be ₹800');

      // 2. Room Fee Dues
      assert.equal(overview.room.chargeIssued, true);
      assert.equal(overview.room.issuedChargePaise, 280000, 'Room charge should be ₹2,800');
      assert.equal(overview.room.paidPaise, 200000, 'Room paid should be ₹2,000');
      assert.equal(overview.room.remainingPaise, 80000, 'Room due should be ₹800');

      // 3. Other Expenses
      assert.equal(overview.expenses.spendingSharePaise, 36000, 'Personal consumption share should be ₹360');
      assert.equal(overview.expenses.owedToOthersPaise, 15000, 'Unpaid reimbursement debt owed is ₹150');
      assert.equal(overview.expenses.owedToMePaise, 20000, 'Receivable owed by roommates is ₹200');

      // 4. Canonical Combined Total Payable Formula:
      // totalOutstandingPayable = messRemaining (₹800) + roomRemaining (₹800) + expenseOwedToOthers (₹150) = ₹1,750
      assert.equal(
        overview.combined.outstandingPayablePaise,
        175000,
        'Total payable must be exactly ₹1,750 (800 + 800 + 150)',
      );

      // 5. Receivables must NEVER be deducted from Total to Pay
      assert.equal(overview.combined.receivablePaise, 20000, 'Receivable is ₹200 and kept strictly separate');

      // 6. Total Tracked Consumption vs Remaining Payable distinction (Section 9)
      // personalTrackedCost = messBill (1300) + roomIssued (2800) + expenseShare (360) = ₹4,460
      assert.equal(
        overview.combined.personalTrackedCostPaise,
        446000,
        'Personal tracked cost must be ₹4,460',
      );
    });

    test('Unissued room charge does not count as ₹0 paid or overdue debt', async () => {
      const mockUnissuedRoomFees = {
        async getMemberOverview() {
          return {
            memberId: 'gaurav',
            currentRoom: { roomNumber: '204' },
            scheduledFeePaise: 280000,
            currentMonthCharge: null, // No charge issued!
          };
        },
      };

      const customService = createFinancialOverviewService({
        paymentSummaries: createMockPaymentSummaries(),
        settlements: createMockSettlements(false),
        roomFees: mockUnissuedRoomFees,
        expenses: createMockExpenses(),
        now: () => NOW,
      });

      const overview = await customService.getMemberFinancialOverview({
        memberId: 'gaurav',
        month: CURRENT_MONTH,
        actorRole: ROLES.MEMBER,
      });

      assert.equal(overview.room.chargeIssued, false);
      assert.equal(overview.room.issuedChargePaise, 0);
      assert.equal(overview.room.remainingPaise, 0);
      assert.equal(overview.room.status, 'not_issued');
      // Payable should only be Mess (800) + Expenses (150) = 950
      assert.equal(overview.combined.outstandingPayablePaise, 95000);
    });

    test('Closed Mess month uses frozen settlement snapshot', async () => {
      const customService = createFinancialOverviewService({
        paymentSummaries: createMockPaymentSummaries(), // Live summary has ₹800 remaining
        settlements: createMockSettlements(true), // Closed snapshot has ₹0 remaining (fully settled)
        roomFees: createMockRoomFees(),
        expenses: createMockExpenses(),
        now: () => NOW,
      });

      const overview = await customService.getMemberFinancialOverview({
        memberId: 'gaurav',
        month: CURRENT_MONTH,
        actorRole: ROLES.MEMBER,
      });

      assert.equal(overview.mess.isClosed, true);
      assert.equal(overview.mess.remainingPaise, 0, 'Closed month must use frozen snapshot balance');
      assert.equal(overview.mess.status, 'closed');
    });
  });

  describe('Combined Household Financial Totals (Section 10)', () => {
    test('Gross tracked cost equals sum of domain costs without double-counting reimbursements', async () => {
      const household = await overviewService.getHouseholdFinancialOverview({
        month: CURRENT_MONTH,
        actorRole: ROLES.ADMIN,
      });

      // Tracked Costs
      assert.equal(household.trackedCosts.messCostPaise, 420000, 'Mess cost is ₹4,200');
      assert.equal(household.trackedCosts.roomFeesCostPaise, 910000, 'Room fees issued is ₹9,100');
      assert.equal(household.trackedCosts.otherExpensesCostPaise, 128000, 'Other purchases recorded is ₹1,280');
      assert.equal(
        household.trackedCosts.totalTrackedCostPaise,
        1458000,
        'Household tracked cost must be exactly ₹14,580 (4200 + 9100 + 1280)',
      );

      // Managed Dues
      assert.equal(household.managedDues.messOutstandingPaise, 130000, 'Mess due is ₹1,300');
      assert.equal(household.managedDues.roomFeesOutstandingPaise, 80000, 'Room due is ₹800');
      assert.equal(household.managedDues.totalManagedDuesPaise, 210000, 'Managed dues is ₹2,100');

      // Internal Roommate Debts
      assert.equal(
        household.roommateReimbursements.pendingReimbursementsPaise,
        35000,
        'Pending reimbursements is ₹350',
      );

      // Actionable attention items
      assert.ok(household.actionableAttention.length > 0);
      assert.ok(household.actionableAttention.some((a) => a.type === 'room_fees_due'));
    });
  });

  describe('Reconciliation Invariant Guard (Section 17 & 48)', () => {
    test('reconcileMemberFinances rejects if payable does not equal component sum', () => {
      const corruptData = {
        memberId: 'gaurav',
        mess: { remainingPaise: 80000, billPaise: 130000 },
        room: { remainingPaise: 80000, issuedChargePaise: 280000 },
        expenses: { owedToOthersPaise: 15000, spendingSharePaise: 36000, owedToMePaise: 20000 },
        combined: {
          outstandingPayablePaise: 155000, // ILLEGALLY SUBTRACTED 20000 RECEIVABLE!
          receivablePaise: 20000,
          personalTrackedCostPaise: 446000,
        },
      };

      assert.throws(() => reconcileMemberFinances(corruptData), FinancialReconciliationError);
    });

    test('reconcileHouseholdFinances rejects if tracked costs sum mismatch', () => {
      const corruptHousehold = {
        trackedCosts: {
          messCostPaise: 420000,
          roomFeesCostPaise: 910000,
          otherExpensesCostPaise: 128000,
          totalTrackedCostPaise: 1500000, // TAMPERED TOTAL
        },
        managedDues: {
          messOutstandingPaise: 130000,
          roomFeesOutstandingPaise: 80000,
          totalManagedDuesPaise: 210000,
        },
        roommateReimbursements: { pendingReimbursementsPaise: 35000 },
        memberSummaries: {},
      };

      assert.throws(() => reconcileHouseholdFinances(corruptHousehold), FinancialReconciliationError);
    });
  });

  describe('Finance API Endpoints & Role Authorization (Section 18 & 19)', () => {
    test('Viewer (unauthenticated) is rejected from all finance endpoints', async () => {
      const resOverview = await request(testApp).get(`/api/finance/overview/${CURRENT_MONTH}`);
      assert.equal(resOverview.status, 401);

      const resMe = await request(testApp).get(`/api/finance/me/${CURRENT_MONTH}`);
      assert.equal(resMe.status, 401);
    });

    test('Member can access GET /api/finance/me/:month for own identity', async () => {
      const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      const res = await request(testApp)
        .get(`/api/finance/me/${CURRENT_MONTH}`)
        .set('Cookie', cookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.member.memberId, 'gaurav');
      assert.equal(res.body.data.combined.outstandingPayablePaise, 175000);
    });

    test('Member CANNOT access GET /api/finance/overview/:month (returns 403)', async () => {
      const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      const res = await request(testApp)
        .get(`/api/finance/overview/${CURRENT_MONTH}`)
        .set('Cookie', cookie);

      assert.equal(res.status, 403);
    });

    test('Member CANNOT access GET /api/finance/members/:otherId/:month (returns 403)', async () => {
      const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      const res = await request(testApp)
        .get(`/api/finance/members/nikhil/${CURRENT_MONTH}`)
        .set('Cookie', cookie);

      assert.equal(res.status, 403);
    });

    test('credit review and allocation routes are Super Admin only', async () => {
      const calls = [];
      const credits = {
        async listCredits(payload) {
          calls.push(['list', payload]);
          return [{ creditId: 'credit-1', memberId: 'nikhil', remainingAmountPaise: 10_000 }];
        },
        async previewAllocation(payload) {
          calls.push(['preview', payload]);
          return { canApply: true, previewToken: 'p'.repeat(64) };
        },
        async allocate(payload) {
          calls.push(['allocate', payload]);
          return { allocation: { creditAllocationId: 'allocation-1' } };
        },
      };
      const protectedApp = createApp({
        finance: createFinanceRouter({ overviewService, credits }),
      });
      const payload = {
        expectedRevision: 0,
        destinationType: 'ROOM_FEE',
        targetRecordId: 'charge-1',
        amountPaise: 10_000,
        reason: 'Verified target obligation',
        idempotencyKey: 'credit-route-regression',
      };
      const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      const adminCookie = await cookieFor(ROLES.ADMIN);

      await request(protectedApp)
        .get('/api/finance/unallocated-credits?memberId=nikhil')
        .set('Cookie', memberCookie)
        .expect(403);
      await request(protectedApp)
        .post('/api/finance/unallocated-credits/credit-1/allocation-preview')
        .set('Origin', ORIGIN)
        .set('Cookie', memberCookie)
        .send(payload)
        .expect(403);
      await request(protectedApp)
        .post('/api/finance/unallocated-credits/credit-1/allocate')
        .set('Origin', ORIGIN)
        .set('Cookie', adminCookie)
        .send({ ...payload, previewToken: 'p'.repeat(64) })
        .expect(403);
      assert.equal(calls.length, 0);

      const superAdminCookie = await cookieFor(ROLES.SUPERADMIN);
      await request(protectedApp)
        .get('/api/finance/unallocated-credits?memberId=nikhil')
        .set('Cookie', superAdminCookie)
        .expect(200);
      await request(protectedApp)
        .post('/api/finance/unallocated-credits/credit-1/allocation-preview')
        .set('Origin', ORIGIN)
        .set('Cookie', superAdminCookie)
        .send(payload)
        .expect(200);
      await request(protectedApp)
        .post('/api/finance/unallocated-credits/credit-1/allocate')
        .set('Origin', ORIGIN)
        .set('Cookie', superAdminCookie)
        .send({ ...payload, previewToken: 'p'.repeat(64) })
        .expect(200);
      assert.deepEqual(calls.map(([name]) => name), ['list', 'preview', 'allocate']);
      assert.ok(calls.every(([, call]) => call.actorRole === ROLES.SUPERADMIN));
    });

    test('Admin can access household overview and member financial details', async () => {
      const cookie = await cookieFor(ROLES.ADMIN);
      const resOverview = await request(testApp)
        .get(`/api/finance/overview/${CURRENT_MONTH}`)
        .set('Cookie', cookie);

      assert.equal(resOverview.status, 200);
      assert.equal(resOverview.body.success, true);
      assert.equal(resOverview.body.data.trackedCosts.totalTrackedCostPaise, 1458000);

      const resMember = await request(testApp)
        .get(`/api/finance/members/devansh/${CURRENT_MONTH}`)
        .set('Cookie', cookie);

      assert.equal(resMember.status, 200);
      assert.equal(resMember.body.data.member.memberId, 'devansh');
    });

    test('Rejects invalid month parameter with 400', async () => {
      const cookie = await cookieFor(ROLES.ADMIN);
      const res = await request(testApp)
        .get('/api/finance/overview/invalid-month')
        .set('Cookie', cookie);

      assert.equal(res.status, 400);
    });
  });
});
