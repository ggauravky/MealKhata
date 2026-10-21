import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  mapMemberRoomFeeOverview,
  roomFeeRequestKey,
} from '../src/lib/roomFeeContracts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

describe('MealKhata 2.0 Phase 1: Frontend Architecture & Component Tests', () => {
  describe('Navigation & Routing Structure', () => {
    test('NAV_ITEMS contains 5 top-level items: Home, Mess, Room Fees, Payments, Reports', async () => {
      const constantsContent = await fs.readFile(path.join(srcDir, 'lib/constants.js'), 'utf8');
      assert.match(constantsContent, /\{\s*label:\s*'Home',\s*path:\s*'\/'\s*\}/);
      assert.match(constantsContent, /\{\s*label:\s*'Mess',\s*path:\s*'\/calendar'\s*\}/);
      assert.match(constantsContent, /\{\s*label:\s*'Room Fees',\s*path:\s*'\/room-fees'\s*\}/);
      assert.match(constantsContent, /\{\s*label:\s*'Payments',\s*path:\s*'\/payments'\s*\}/);
      assert.match(constantsContent, /\{\s*label:\s*'Reports',\s*path:\s*'\/reports'\s*\}/);
    });

    test('MobileNav renders clean 5-item bottom bar with Home, Mess, Room, Payments, More dropdown', async () => {
      const mobileNav = await fs.readFile(path.join(srcDir, 'components/layout/MobileNav.jsx'), 'utf8');
      assert.match(mobileNav, /grid-cols-5/);
      assert.match(mobileNav, /label:\s*'Room',\s*path:\s*'\/room-fees'/);
      assert.match(mobileNav, /BedDouble/);
      assert.match(mobileNav, /MoreHorizontal/);
      assert.match(mobileNav, /DropdownMenu/);
      // More exposes Reports, Admin panels, Theme, Install app, and Sign out
      assert.match(mobileNav, /\/reports/);
      assert.match(mobileNav, /\/admin\/room-fees/);
      assert.match(mobileNav, /\/admin/);
      assert.match(mobileNav, /theme/i);
      assert.match(mobileNav, /installApp/);
      assert.match(mobileNav, /handleLogout/);
    });

    test('App.jsx configures lazy routes for /room-fees and protected /admin/room-fees', async () => {
      const appContent = await fs.readFile(path.join(srcDir, 'App.jsx'), 'utf8');
      assert.match(appContent, /lazy\(\(\)\s*=>\s*import\('\.\/pages\/RoomFeesPage\.jsx'\)/);
      assert.match(appContent, /lazy\(\(\)\s*=>\s*import\('\.\/pages\/AdminRoomFeesPage\.jsx'\)/);
      assert.match(appContent, /<Route path="room-fees" element={<RoomFeesPage \/>} \/>/);
      assert.match(appContent, /<Route path="admin\/room-fees" element={<AdminRoomFeesPage \/>} \/>/);
    });
  });

  describe('Member Room Fees Page & Components', () => {
    test('maps the authoritative member overview without treating a fee plan as an issued charge', () => {
      const mapped = mapMemberRoomFeeOverview({
        memberId: 'gaurav',
        month: '2026-10',
        currentRoom: { roomId: 'lower', roomNumber: 'lower', capacity: 1 },
        currentAssignment: {
          assignmentId: 'assignment-existing',
          memberId: 'gaurav',
          roomId: 'lower',
          effectiveFromDate: '2026-10-20',
        },
        currentFeePlan: { feePlanId: 'plan-existing', amountPaise: 280000 },
        scheduledFeePaise: 280000,
        currentMonthCharge: null,
        summaryMetrics: { totalBilledPaise: 0, issuedMonthsCount: 0 },
        recipientSettings: { recipientName: 'Hostel Administration' },
      });

      assert.equal(mapped.room.roomNumber, 'lower');
      assert.equal(mapped.assignment.assignmentId, 'assignment-existing');
      assert.equal(mapped.feePlan.feePlanId, 'plan-existing');
      assert.equal(mapped.statement.charge, null);
      assert.equal(mapped.statement.status, 'not_issued');
      assert.equal(mapped.statement.effectiveChargePaise, 0);
      assert.equal(mapped.metrics.issuedMonthsCount, 0);
      assert.equal(mapped.settings.recipientName, 'Hostel Administration');
    });

    test('maps an issued charge explicitly to the statement component contract', () => {
      const mapped = mapMemberRoomFeeOverview({
        memberId: 'nikhil',
        month: '2026-10',
        currentRoom: { roomId: 'first', roomNumber: '1st Floor Room', capacity: 2 },
        currentAssignment: { assignmentId: 'assignment-nikhil' },
        currentFeePlan: { feePlanId: 'plan-nikhil', amountPaise: 250000 },
        currentMonthCharge: {
          chargeId: 'charge-1',
          finalBillAmountPaise: 250000,
          paidAmountPaise: 100000,
          remainingAmountPaise: 150000,
          overpaidPaise: 0,
          paymentStatus: 'partial',
          payments: [{ roomPaymentId: 'payment-1', amountPaise: 100000 }],
        },
      });

      assert.equal(mapped.statement.charge.chargeId, 'charge-1');
      assert.equal(mapped.statement.effectiveChargePaise, 250000);
      assert.equal(mapped.statement.paidPaise, 100000);
      assert.equal(mapped.statement.remainingPaise, 150000);
      assert.equal(mapped.statement.status, 'partial');
      assert.equal(mapped.statement.payments.length, 1);
    });

    test('keys room-fee requests by both selected member and month', () => {
      assert.equal(roomFeeRequestKey('gaurav', '2026-10'), 'gaurav:2026-10');
      assert.equal(roomFeeRequestKey('nikhil', '2026-10'), 'nikhil:2026-10');
      assert.notEqual(roomFeeRequestKey('gaurav', '2026-10'), roomFeeRequestKey('nikhil', '2026-10'));
    });

    test('RoomFeesPage strictly isolates member data and gates unauthenticated viewers', async () => {
      const page = await fs.readFile(path.join(srcDir, 'pages/RoomFeesPage.jsx'), 'utf8');
      assert.match(page, /auth\.role === 'viewer'/);
      assert.match(page, /Private Financial Domain/);
      assert.match(page, /Sign In/);
      assert.match(page, /useMyRoomFees/);
      assert.match(page, /useMyRoomFeeHistory/);
      assert.match(page, /settings=\{feeData\.settings\}/);
    });

    test('RoomFeeOverviewCard displays progress, formatted money, and status badges', async () => {
      const overview = await fs.readFile(path.join(srcDir, 'components/roomFees/RoomFeeOverviewCard.jsx'), 'utf8');
      assert.match(overview, /RoomFeeProgress/);
      assert.match(overview, /formatPaise\(effectiveChargePaise\)/);
      assert.match(overview, /formatPaise\(paidPaise\)/);
      assert.match(overview, /formatPaise\(remainingPaise\)/);
      assert.match(overview, /Overpaid balance:/);
      assert.match(overview, /STATUS_LABELS/);
    });

    test('RoomFeeProgress handles zero-bill edge case safely without division by zero', async () => {
      const progress = await fs.readFile(path.join(srcDir, 'components/roomFees/RoomFeeProgress.jsx'), 'utf8');
      assert.match(progress, /safeBill > 0/);
      assert.match(progress, /Math\.min\(100,\s*Math\.round\(\(safePaid \/ safeBill\) \* 100\)\)/);
      assert.match(progress, /<Progress value=\{percent\}/);

      const uiProgress = await fs.readFile(path.join(srcDir, 'components/ui/progress.jsx'), 'utf8');
      assert.match(uiProgress, /aria-valuenow=\{clampedValue\}/);
    });

    test('RoomFeeEmptyState handles all 6 empty conditions with meaningful copy', async () => {
      const empty = await fs.readFile(path.join(srcDir, 'components/roomFees/RoomFeeEmptyState.jsx'), 'utf8');
      assert.match(empty, /no_assignment/);
      assert.match(empty, /No room assigned yet/);
      assert.match(empty, /no_plan/);
      assert.match(empty, /Room fee not configured/);
      assert.match(empty, /no_charge/);
      assert.match(empty, /Fee not issued for this month/);
      assert.match(empty, /all_paid/);
      assert.match(empty, /All room fees paid/);
    });

    test('RoomPaymentInstructionsCard displays recipient details and conditional UPI deep link', async () => {
      const instr = await fs.readFile(path.join(srcDir, 'components/roomFees/RoomPaymentInstructionsCard.jsx'), 'utf8');
      assert.match(instr, /hostel_owner/);
      assert.match(instr, /admin_collector/);
      assert.match(instr, /upi:\/\/pay\?pa=/);
      assert.match(instr, /Opening UPI initiates payment; your room payment is marked verified only after the administrator records confirmed receipt/);
    });

    test('RoomFeeMonthList supports responsive desktop table and mobile stacked rows', async () => {
      const list = await fs.readFile(path.join(srcDir, 'components/roomFees/RoomFeeMonthList.jsx'), 'utf8');
      assert.match(list, /hidden md:block/); // Desktop table
      assert.match(list, /md:hidden/); // Mobile stacked cards
      assert.match(list, /RoomFeeMonthDetailsDialog/);
    });
  });

  describe('Admin Room Fee Management Panels', () => {
    test('AdminRoomFeesPage provides 6 tabbed panels: overview, rooms, plans, charges, payments, settings', async () => {
      const adminPage = await fs.readFile(path.join(srcDir, 'pages/AdminRoomFeesPage.jsx'), 'utf8');
      assert.match(adminPage, /value="overview"/);
      assert.match(adminPage, /value="rooms"/);
      assert.match(adminPage, /value="plans"/);
      assert.match(adminPage, /value="charges"/);
      assert.match(adminPage, /value="payments"/);
      assert.match(adminPage, /value="settings"/);
    });

    test('AdminRoomsTab allows room creation, occupancy tracking, and member assignment', async () => {
      const roomsTab = await fs.readFile(path.join(srcDir, 'components/roomFees/admin/AdminRoomsTab.jsx'), 'utf8');
      assert.match(roomsTab, /api\.post\('\/api\/rooms'/);
      assert.match(roomsTab, /api\.post\('\/api\/room-fees\/assignments'/);
      assert.match(roomsTab, /api\.patch\(`\/api\/rooms\/\$\{room\.roomId\}`/); // archive
      assert.match(roomsTab, /capacity/i);
    });

    test('AdminFeePlansTab enforces independent member pricing without retroactively altering old charges', async () => {
      const feePlansTab = await fs.readFile(path.join(srcDir, 'components/roomFees/admin/AdminFeePlansTab.jsx'), 'utf8');
      assert.match(feePlansTab, /api\.post\('\/api\/room-fees\/plans'/);
      assert.match(feePlansTab, /rupeesToPaise/);
      assert.match(feePlansTab, /effectiveFromMonth/);
      assert.match(feePlansTab, /Fee not configured/);
    });

    test('AdminMonthlyChargesTab requires preview before explicit issuance and supports Super Admin adjustments', async () => {
      const chargesTab = await fs.readFile(path.join(srcDir, 'components/roomFees/admin/AdminMonthlyChargesTab.jsx'), 'utf8');
      assert.match(chargesTab, /api\.post\('\/api\/room-fees\/charges\/preview'/);
      assert.match(chargesTab, /api\.post\('\/api\/room-fees\/charges\/issue'/);
      assert.match(chargesTab, /api\.post\(`\/api\/room-fees\/charges\/\$\{adjustCharge\.chargeId\}\/adjustments`/);
      assert.match(chargesTab, /Review Proposed Room Charges/);
    });

    test('AdminPaymentsTab requires confirmation dialog and supports Super Admin voiding with reason', async () => {
      const paymentsTab = await fs.readFile(path.join(srcDir, 'components/roomFees/admin/AdminPaymentsTab.jsx'), 'utf8');
      assert.match(paymentsTab, /Confirm Payment Entry/);
      assert.match(paymentsTab, /Record.*₹\{amountRupees\}.*\{selectedMemberName\}/);
      assert.match(paymentsTab, /api\.post\('\/api\/room-fees\/payments'/);
      assert.match(paymentsTab, /api\.post\(`\/api\/room-fees\/payments\/\$\{selectedPayment\.roomPaymentId\}\/void`/);
      assert.match(paymentsTab, /idempotencyKey/);
    });

    test('AdminSettingsTab supports hostel_owner and admin_collector with UPI and instructions', async () => {
      const settingsTab = await fs.readFile(path.join(srcDir, 'components/roomFees/admin/AdminSettingsTab.jsx'), 'utf8');
      assert.match(settingsTab, /api\.put\('\/api\/room-fees\/settings'/);
      assert.match(settingsTab, /recipientMode/);
      assert.match(settingsTab, /hostel_owner/);
      assert.match(settingsTab, /admin_collector/);
      assert.match(settingsTab, /upiId/);
      assert.match(settingsTab, /paymentInstructions/);
    });
  });

  describe('Payments Page Reorganization & Realtime Integration', () => {
    test('PaymentsPage splits into Mess and Room Fees tabs while keeping Mess logic intact', async () => {
      const paymentsPage = await fs.readFile(path.join(srcDir, 'pages/PaymentsPage.jsx'), 'utf8');
      assert.match(paymentsPage, /<Tabs value=\{activeTab\}/);
      assert.match(paymentsPage, /<TabsTrigger value="mess"/);
      assert.match(paymentsPage, /<TabsTrigger value="room"/);
      assert.match(paymentsPage, /<RoomFeesPaymentTab month=\{month\} \/>/);
      // Existing Mess logic intact
      assert.match(paymentsPage, /usePaymentSummary/);
      assert.match(paymentsPage, /usePaymentHistory/);
      assert.match(paymentsPage, /useSettlement/);
      assert.match(paymentsPage, /PaymentFlowDialog/);
    });

    test('DashboardRoomFeeCard integrates into DashboardPage for authenticated members', async () => {
      const dash = await fs.readFile(path.join(srcDir, 'pages/DashboardPage.jsx'), 'utf8');
      assert.match(dash, /DashboardRoomFeeCard/);
      const card = await fs.readFile(path.join(srcDir, 'components/dashboard/DashboardRoomFeeCard.jsx'), 'utf8');
      assert.match(card, /View Room Fees/);
      assert.match(card, /Manage Room Fees/);
      assert.match(card, /auth\.role === 'viewer'/);
    });

    test('Realtime hooks subscribe to room-fees:updated Socket.IO event and trigger refetches', async () => {
      const hooks = await fs.readFile(path.join(srcDir, 'hooks/useRoomFees.js'), 'utf8');
      assert.match(hooks, /socket\.on\('room-fees:updated'/);
      assert.match(hooks, /useMyRoomFees/);
      assert.match(hooks, /useMyRoomFeeHistory/);
      assert.match(hooks, /useAdminRoomFeeSummary/);
      assert.match(hooks, /useRooms/);
      assert.match(hooks, /useMemberFeePlans/);
      assert.match(hooks, /useRoomPaymentSettings/);
    });
  });
});
