import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createFinancialOverviewService } from '../src/finance/financialOverview.service.js';
import { createMonthlyFinancialReportService } from '../src/finance/monthlyFinancialReport.service.js';
import { createMonthlyFinancialPdfService } from '../src/finance/monthlyFinancialPdf.service.js';
import { createFinanceRouter } from '../src/routes/finance.routes.js';

const CURRENT_MONTH = '2026-10';
const NOW = new Date('2026-10-20T12:00:00.000Z');

function createMockReportDataService() {
  return {
    async getHouseholdReportData(month, { actorRole } = {}) {
      return {
        month,
        isMessClosed: false,
        overview: {
          month,
          generatedAt: NOW.toISOString(),
          trackedCosts: {
            messCostPaise: 420000,
            roomFeesCostPaise: 910000,
            otherExpensesCostPaise: 128000,
            totalTrackedCostPaise: 1458000,
          },
          managedDues: {
            messOutstandingPaise: 130000,
            roomFeesOutstandingPaise: 80000,
            totalManagedDuesPaise: 210000,
            messCollectedPaise: 290000,
            roomFeesCollectedPaise: 830000,
          },
          roommateReimbursements: {
            pendingReimbursementsPaise: 35000,
            settledReimbursementsPaise: 25000,
          },
          memberSummaries: {
            gaurav: {
              mess: { billPaise: 130000, paidPaise: 50000, remainingPaise: 80000 },
              room: { issuedChargePaise: 280000, paidPaise: 200000, remainingPaise: 80000 },
              expenses: { spendingSharePaise: 36000, owedToOthersPaise: 15000, owedToMePaise: 20000 },
              combined: { outstandingPayablePaise: 175000 },
            },
            nikhil: {
              mess: { billPaise: 140000, paidPaise: 140000, remainingPaise: 0 },
              room: { issuedChargePaise: 280000, paidPaise: 280000, remainingPaise: 0 },
              expenses: { spendingSharePaise: 42000, owedToOthersPaise: 0, owedToMePaise: 15000 },
              combined: { outstandingPayablePaise: 0 },
            },
            devansh: {
              mess: { billPaise: 150000, paidPaise: 100000, remainingPaise: 50000 },
              room: { issuedChargePaise: 350000, paidPaise: 350000, remainingPaise: 0 },
              expenses: { spendingSharePaise: 50000, owedToOthersPaise: 20000, owedToMePaise: 0 },
              combined: { outstandingPayablePaise: 70000 },
            },
          },
        },
        roomCharges: [
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
          },
        ],
        expenses: [
          {
            expenseId: 'e1',
            date: '2026-10-15',
            title: 'Groceries',
            category: 'groceries',
            paidByMemberId: 'gaurav',
            splitType: 'equal',
            amountPaise: 128000,
            reimbursements: [],
            settlementStatus: 'unsettled',
          },
        ],
      };
    },

    async getMemberReportData(memberId, month, { actorRole } = {}) {
      return {
        memberId,
        month,
        overview: {
          memberId,
          month,
          generatedAt: NOW.toISOString(),
          mess: {
            billPaise: 130000,
            paidPaise: 50000,
            remainingPaise: 80000,
          },
          room: {
            chargeIssued: true,
            issuedChargePaise: 280000,
            paidPaise: 200000,
            remainingPaise: 80000,
            roomNumber: '204',
          },
          expenses: {
            spendingSharePaise: 36000,
            merchantSpendingPaise: 25000,
            owedToOthersPaise: 15000,
            owedToMePaise: 20000,
            debtsOwed: [
              {
                expenseId: 'e2',
                title: 'Snacks',
                date: '2026-10-18',
                toMemberId: 'nikhil',
                amountPaise: 15000,
              },
            ],
            receivables: [
              {
                expenseId: 'e1',
                title: 'Groceries',
                date: '2026-10-15',
                fromMemberId: 'devansh',
                amountPaise: 20000,
              },
            ],
          },
          combined: {
            outstandingPayablePaise: 175000,
            receivablePaise: 20000,
            personalTrackedCostPaise: 446000,
          },
        },
        expenses: [],
      };
    },
  };
}

async function cookieFor(role, memberId = null) {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, { memberId })}`;
}

describe('MealKhata 2.0: Professional Monthly Financial PDF Generation', () => {
  let pdfService;
  let financeRouter;
  let testApp;

  beforeEach(() => {
    const reportDataService = createMockReportDataService();
    pdfService = createMonthlyFinancialPdfService({ reportDataService });
    financeRouter = createFinanceRouter({ pdfService });
    testApp = createApp({ finance: financeRouter });
  });

  test('generateMemberStatementPdf produces a valid vector PDF starting with %PDF-', async () => {
    const doc = await pdfService.generateMemberStatementPdf({
      memberId: 'gaurav',
      month: CURRENT_MONTH,
      actorRole: ROLES.MEMBER,
    });

    const chunks = [];
    const buffer = await new Promise((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    assert.ok(buffer.length > 500, 'PDF buffer should be non-trivial size');
    const header = buffer.subarray(0, 5).toString('ascii');
    assert.equal(header, '%PDF-', 'PDF must begin with standard %PDF- header magic bytes');
  });

  test('generateHouseholdStatementPdf produces a valid vector PDF starting with %PDF-', async () => {
    const doc = await pdfService.generateHouseholdStatementPdf({
      month: CURRENT_MONTH,
      actorRole: ROLES.ADMIN,
    });

    const chunks = [];
    const buffer = await new Promise((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    assert.ok(buffer.length > 1000, 'Household PDF should be non-trivial size');
    const header = buffer.subarray(0, 5).toString('ascii');
    assert.equal(header, '%PDF-', 'PDF must begin with %PDF-');
  });

  test('GET /api/finance/monthly/:month/my-statement.pdf returns PDF to authenticated Member', async () => {
    const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const res = await request(testApp)
      .get(`/api/finance/monthly/${CURRENT_MONTH}/my-statement.pdf`)
      .set('Cookie', cookie);

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.match(res.headers['content-disposition'], /attachment; filename="MealKhata-Personal-Statement-gaurav-2026-10\.pdf"/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.ok(res.body.length > 500);
  });

  test('GET /api/finance/monthly/:month/household-statement.pdf is gated to Admin / Super Admin', async () => {
    const memberCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
    const resMember = await request(testApp)
      .get(`/api/finance/monthly/${CURRENT_MONTH}/household-statement.pdf`)
      .set('Cookie', memberCookie);

    assert.equal(resMember.status, 403, 'Members cannot download household financial statement');

    const adminCookie = await cookieFor(ROLES.ADMIN);
    const resAdmin = await request(testApp)
      .get(`/api/finance/monthly/${CURRENT_MONTH}/household-statement.pdf`)
      .set('Cookie', adminCookie);

    assert.equal(resAdmin.status, 200);
    assert.equal(resAdmin.headers['content-type'], 'application/pdf');
    assert.match(resAdmin.headers['content-disposition'], /attachment; filename="MealKhata-Household-Statement-2026-10\.pdf"/);
  });
});
