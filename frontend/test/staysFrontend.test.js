import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(currentDir, '../src');

const useStaysPath = path.join(srcDir, 'hooks/useStays.js');
const stayDownloadPath = path.join(srcDir, 'lib/stayDownload.js');
const stayStatusBadgePath = path.join(srcDir, 'components/stays/StayStatusBadge.jsx');
const stayOverviewCardPath = path.join(srcDir, 'components/stays/StayOverviewCard.jsx');
const roomHistoryTimelinePath = path.join(srcDir, 'components/stays/RoomHistoryTimeline.jsx');
const depositOverviewCardPath = path.join(srcDir, 'components/stays/DepositOverviewCard.jsx');
const depositTransactionHistoryPath = path.join(srcDir, 'components/stays/DepositTransactionHistory.jsx');
const depositTransactionDialogPath = path.join(srcDir, 'components/stays/DepositTransactionDialog.jsx');
const roomTransferDialogPath = path.join(srcDir, 'components/stays/RoomTransferDialog.jsx');
const checkoutRequestDialogPath = path.join(srcDir, 'components/stays/CheckoutRequestDialog.jsx');
const checkoutReviewWizardPath = path.join(srcDir, 'components/stays/CheckoutReviewWizard.jsx');
const clearanceStatusCardPath = path.join(srcDir, 'components/stays/ClearanceStatusCard.jsx');
const lifetimeFinancialOverviewPath = path.join(srcDir, 'components/stays/LifetimeFinancialOverview.jsx');
const stayEmptyStatePath = path.join(srcDir, 'components/stays/StayEmptyState.jsx');
const dashboardStayCardPath = path.join(srcDir, 'components/dashboard/DashboardStayCard.jsx');
const myStayPagePath = path.join(srcDir, 'pages/MyStayPage.jsx');
const adminStaysPagePath = path.join(srcDir, 'pages/AdminStaysPage.jsx');
const targetedReconciliationDialogsPath = path.join(srcDir, 'components/stays/TargetedReconciliationDialogs.jsx');
const restoreResidentDialogPath = path.join(srcDir, 'components/stays/RestoreResidentDialog.jsx');
const configureDepositDialogPath = path.join(srcDir, 'components/stays/ConfigureDepositDialog.jsx');
const appPath = path.join(srcDir, 'App.jsx');
const accountMenuPath = path.join(srcDir, 'components/layout/AccountMenu.jsx');
const mobileNavPath = path.join(srcDir, 'components/layout/MobileNav.jsx');
const dashboardPagePath = path.join(srcDir, 'pages/DashboardPage.jsx');

describe('MealKhata 2.0 Phase 4: Complete Hostel Lifecycle, Security Deposits & Final Checkout (Frontend)', () => {
  describe('Navigation & Routing Structure', () => {
    test('App.jsx configures lazy routes for /my-stay and protected /admin/stays', async () => {
      const appContent = await fs.readFile(appPath, 'utf8');
      assert.match(appContent, /lazy\(\(\)\s*=>\s*import\('\.\/pages\/MyStayPage\.jsx'\)/);
      assert.match(appContent, /lazy\(\(\)\s*=>\s*import\('\.\/pages\/AdminStaysPage\.jsx'\)/);
      assert.match(appContent, /<Route path="my-stay" element={<ErrorBoundary><MyStayPage \/><\/ErrorBoundary>} \/>/);
      assert.match(appContent, /<Route path="admin\/stays" element={<AdminStaysPage \/>} \/>/);
    });

    test('AccountMenu renders My Hostel Stay and Manage Hostel Stays links', async () => {
      const content = await fs.readFile(accountMenuPath, 'utf8');
      assert.match(content, /to="\/my-stay"/);
      assert.match(content, /My Hostel Stay/);
      assert.match(content, /to="\/admin\/stays"/);
      assert.match(content, /Manage Hostel Stays/);
    });

    test('MobileNav renders My Hostel Stay and Hostel Stays Admin under More menu', async () => {
      const content = await fs.readFile(mobileNavPath, 'utf8');
      assert.match(content, /navigate\('\/my-stay'\)/);
      assert.match(content, /My Hostel Stay/);
      assert.match(content, /navigate\('\/admin\/stays'\)/);
      assert.match(content, /Hostel Stays Admin/);
    });

    test('DashboardPage includes compact DashboardStayCard widget', async () => {
      const content = await fs.readFile(dashboardPagePath, 'utf8');
      assert.match(content, /import\s*\{\s*DashboardStayCard\s*\}\s*from/);
      assert.match(content, /<DashboardStayCard \/>/);
    });
  });

  describe('Realtime Stay & Deposit Hooks (useStays.js)', () => {
    test('exports useMyStay, useMyStayHistory, useAdminStays, useStayDetails, useStayFinancialReview, useStayLifetimeSummary', async () => {
      const content = await fs.readFile(useStaysPath, 'utf8');
      assert.match(content, /export function useMyStay/);
      assert.match(content, /export function useMyStayHistory/);
      assert.match(content, /export function useAdminStays/);
      assert.match(content, /export function useStayDetails/);
      assert.match(content, /export function useStayFinancialReview/);
      assert.match(content, /export function useStayLifetimeSummary/);
    });

    test('subscribes to stay:updated, deposit:updated, and clearance:updated socket events with cleanup', async () => {
      const content = await fs.readFile(useStaysPath, 'utf8');
      assert.match(content, /socket\.on\('stay:updated'/);
      assert.match(content, /socket\.on\('deposit:updated'/);
      assert.match(content, /socket\.on\('clearance:updated'/);
      assert.match(content, /socket\.off\('stay:updated'/);
      assert.match(content, /socket\.off\('deposit:updated'/);
      assert.match(content, /socket\.off\('clearance:updated'/);
    });

    test('enforces offline guard on financial, transfer, and checkout mutations', async () => {
      const content = await fs.readFile(useStaysPath, 'utf8');
      assert.match(content, /!navigator\.onLine/);
      assert.match(content, /You are offline/);
    });
  });

  describe('PDF Download Utilities (stayDownload.js)', () => {
    test('exports downloadLifetimeStatementPdf and downloadClearancePdf with offline protection', async () => {
      const content = await fs.readFile(stayDownloadPath, 'utf8');
      assert.match(content, /export async function downloadLifetimeStatementPdf/);
      assert.match(content, /export async function downloadClearancePdf/);
      assert.match(content, /!navigator\.onLine/);
      assert.match(content, /contentType\.includes\('application\/pdf'\)/);
      assert.match(content, /MealKhata-Lifetime-Statement-/);
      assert.match(content, /MealKhata-Clearance-/);
    });
  });

  describe('Lifecycle UI Components', () => {
    test('StayStatusBadge supports lifecycle statuses including cancellation and clearance statuses', async () => {
      const content = await fs.readFile(stayStatusBadgePath, 'utf8');
      assert.match(content, /ACTIVE/);
      assert.match(content, /CHECKOUT_REQUESTED/);
      assert.match(content, /CHECKOUT_PENDING/);
      assert.match(content, /CHECKED_OUT/);
      assert.match(content, /CANCELLED/);
      assert.match(content, /NO_DUES/);
      assert.match(content, /OUTSTANDING_DUES/);
    });

    test('DepositOverviewCard displays expected, received, deducted, refunded, and held balance', async () => {
      const content = await fs.readFile(depositOverviewCardPath, 'utf8');
      assert.match(content, /expectedDepositPaise/);
      assert.match(content, /depositReceivedPaise/);
      assert.match(content, /depositDeductedPaise/);
      assert.match(content, /depositRefundedPaise/);
      assert.match(content, /depositHeldPaise/);
      assert.match(content, /Current Held Balance/);
    });

    test('DepositTransactionHistory renders transactions and Super Admin void capability with mandatory reason', async () => {
      const content = await fs.readFile(depositTransactionHistoryPath, 'utf8');
      assert.match(content, /Deposit Transaction History/);
      assert.match(content, /Void Deposit Transaction/);
      assert.match(content, /Mandatory Audit Reason/);
    });

    test('DepositTransactionDialog enforces available held balance constraint and generates idempotency key', async () => {
      const content = await fs.readFile(depositTransactionDialogPath, 'utf8');
      assert.match(content, /amountPaise > depositHeldPaise/);
      assert.match(content, /idempotencyKey/);
      assert.match(content, /crypto\.randomUUID/);
    });

    test('RoomTransferDialog validates destination room, effective date, and preserves occupancy history', async () => {
      const content = await fs.readFile(roomTransferDialogPath, 'utf8');
      assert.match(content, /Transfer Room/);
      assert.match(content, /destinationRoomId/);
      assert.match(content, /effectiveDate/);
      assert.match(content, /newMonthlyRentPaise/);
    });

    test('CheckoutRequestDialog collects preferred departure date and optional reason', async () => {
      const content = await fs.readFile(checkoutRequestDialogPath, 'utf8');
      assert.match(content, /Request Hostel Checkout/);
      assert.match(content, /checkoutRequestedFor/);
      assert.match(content, /checkoutRequestNote/);
    });

    test('CheckoutReviewWizard enforces 5-step guided clearance with truthful No-Dues gating', async () => {
      const content = await fs.readFile(checkoutReviewWizardPath, 'utf8');
      assert.match(content, /Step 1: Verify Stay Details/);
      assert.match(content, /Step 2: Room Assignment/);
      assert.match(content, /Step 3: Review Financial Obligations/);
      assert.match(content, /Step 4: Review Security Deposit Position/);
      assert.match(content, /Step 5: Finalize Clearance/);
      assert.match(content, /Eligible for No-Dues Clearance/);
      assert.match(content, /Super Admin Exception: Finalize physical departure with outstanding dues/);
      assert.match(content, /Mandatory Exception Reason/);
    });

    test('ClearanceStatusCard displays clearance version sequence and triggers PDF download', async () => {
      const content = await fs.readFile(clearanceStatusCardPath, 'utf8');
      assert.match(content, /Clearance #/);
      assert.match(content, /downloadClearancePdf/);
      assert.match(content, /NO_DUES/);
      assert.match(content, /OUTSTANDING_DUES/);
      assert.match(content, /REVOKED/);
      assert.match(content, /revocationReason/);
      assert.match(content, /SUPERSEDED/);
      assert.match(content, /supersessionReason/);
    });

    test('LifetimeFinancialOverview displays multi-month consolidated totals and expandable breakdown', async () => {
      const content = await fs.readFile(lifetimeFinancialOverviewPath, 'utf8');
      assert.match(content, /Lifetime Financial Journey/);
      assert.match(content, /Mess Consumption/);
      assert.match(content, /Room Rent Issued/);
      assert.match(content, /Other Expenses/);
      assert.match(content, /Security Deposit/);
      assert.match(content, /Room Fee Progress Tracker/);
      assert.match(content, /downloadLifetimeStatementPdf/);
    });

    test('StayEmptyState provides helpful guidance when no stay is configured', async () => {
      const content = await fs.readFile(stayEmptyStatePath, 'utf8');
      assert.match(content, /Hostel Stay: Not configured/);
    });
  });

  describe('Pages Architecture', () => {
    test('MyStayPage integrates overview, room history, deposit, lifetime summary, and clearance', async () => {
      const content = await fs.readFile(myStayPagePath, 'utf8');
      assert.match(content, /My Hostel Stay/);
      assert.match(content, /useMyStay/);
      assert.match(content, /useStayDetails/);
      assert.match(content, /StayOverviewCard/);
      assert.match(content, /RoomHistoryTimeline/);
      assert.match(content, /DepositOverviewCard/);
      assert.match(content, /LifetimeFinancialOverview/);
      assert.match(content, /ClearanceStatusCard/);
    });

    test('AdminStaysPage provides 6 lifecycle management tabs with inline review wizard', async () => {
      const content = await fs.readFile(adminStaysPagePath, 'utf8');
      assert.match(content, /Hostel Resident Lifecycle/);
      assert.match(content, /value="overview"/);
      assert.match(content, /value="residents"/);
      assert.match(content, /value="transfers"/);
      assert.match(content, /value="deposits"/);
      assert.match(content, /value="checkouts"/);
      assert.match(content, /value="history"/);
      assert.match(content, /CheckoutReviewWizard/);
      assert.match(content, /JoinStayDialog/);
      assert.match(content, /RoomTransferDialog/);
      assert.match(content, /DepositTransactionDialog/);
      assert.match(content, /RestoreResidentDialog/);
      assert.match(content, /ConfigureDepositDialog/);
    });

    test('Resident restoration requires an exact preview before Super Admin confirmation', async () => {
      const content = await fs.readFile(restoreResidentDialogPath, 'utf8');
      assert.match(content, /restoration-preview/);
      assert.match(content, /previewToken/);
      assert.match(content, /RESTORATION_ASSIGNMENT_CONFLICT|conflicts/);
      assert.match(content, /No records are changed by this preview/);
      assert.match(content, /Restore resident/);
      assert.match(content, /preview\.warnings/);
      assert.match(content, /DEPOSIT_EXPECTATION_MISMATCH/);
      assert.match(content, /eligibleAssignments/);
      assert.match(content, /assignment\.cancelledAt/);
      assert.match(content, /assignment\.effectiveUntilDate/);
      assert.match(content, /useServerToday/);
      assert.match(content, /max=\{serverToday/);
    });

    test('Deposit requirement configuration is explicit and audited without fake transactions', async () => {
      const content = await fs.readFile(configureDepositDialogPath, 'utf8');
      assert.match(content, /deposit\/configuration/);
      assert.match(content, /required/);
      assert.match(content, /expectedRevision/);
      assert.match(content, /No deposit transaction will be created/);
    });

    test('targeted reconciliation UI previews room repair, historical supersession, and real-money reclassification', async () => {
      const page = await fs.readFile(adminStaysPagePath, 'utf8');
      const dialogs = await fs.readFile(targetedReconciliationDialogsPath, 'utf8');
      const hooks = await fs.readFile(useStaysPath, 'utf8');
      assert.match(page, /Repair Room Assignment/);
      assert.match(page, /Reconcile incorrect history/);
      assert.match(page, /Correct Payment Category/);
      assert.match(page, /Review ledger/);
      assert.match(page, /setSelectedStayIdForDetails\(s\.stayId\)/);
      assert.match(dialogs, /EXTEND_EXISTING_ASSIGNMENT/);
      assert.match(dialogs, /UNALLOCATED_CREDIT/);
      assert.match(dialogs, /previewToken/);
      assert.match(dialogs, /Affected records/);
      assert.match(dialogs, /Open required clearance review/);
      assert.match(hooks, /room-repair-preview/);
      assert.match(hooks, /historical-reconciliation-preview/);
      assert.match(hooks, /deposit\/reclassification-preview/);
    });
  });
});
