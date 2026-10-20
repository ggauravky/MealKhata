/**
 * MealKhata 2.0 - Monthly Financial PDF Service
 * Generates professional multi-page vector PDF statements using PDFKit.
 */

import PDFDocument from 'pdfkit';
import { monthlyFinancialReportService } from './monthlyFinancialReport.service.js';
import { formatPdfCurrency } from './financialConstants.js';
import { MEMBERS } from '../config/members.js';
import { formatLogicalMonth } from '../utils/month.js';

const COLORS = Object.freeze({
  primary: '#0f766e', // MealKhata Teal
  primaryLight: '#ccfbf1',
  primaryDark: '#115e59',
  textDark: '#0f172a', // Slate 900
  textMuted: '#475569', // Slate 600
  textSubtle: '#94a3b8', // Slate 400
  border: '#cbd5e1', // Slate 300
  borderLight: '#e2e8f0', // Slate 200
  rowAlt: '#f8fafc', // Slate 50
  white: '#ffffff',
  accentSuccess: '#059669', // Emerald 600
  accentWarning: '#d97706', // Amber 600
  accentDanger: '#dc2626', // Red 600
  accentBlue: '#2563eb', // Blue 600
});

function getMemberName(memberId) {
  const found = MEMBERS.find((m) => m.id === memberId);
  return found ? found.name : memberId;
}

function formatDateIST(isoString) {
  const d = isoString ? new Date(isoString) : new Date();
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function createMonthlyFinancialPdfService({
  reportDataService = monthlyFinancialReportService,
} = {}) {
  /**
   * Helper to draw standard page header
   */
  function drawHeader(doc, { title, subtitle, monthLabel, isLandscape = false }) {
    const pageWidth = isLandscape ? 841.89 : 595.28;
    const contentWidth = pageWidth - 80;

    // Teal brand top bar
    doc.rect(40, 30, contentWidth, 4).fill(COLORS.primary);

    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor(COLORS.primaryDark)
      .text('MealKhata', 40, 42, { continued: true })
      .fontSize(13)
      .font('Helvetica')
      .fillColor(COLORS.textMuted)
      .text(`  |  ${title}`, { align: 'left' });

    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor(COLORS.textDark)
      .text(monthLabel.toUpperCase(), pageWidth - 40 - 200, 44, { width: 200, align: 'right' });

    if (subtitle) {
      doc
        .fontSize(8.5)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(subtitle, 40, 62);
    }

    // Divider
    doc.moveTo(40, 78).lineTo(pageWidth - 40, 78).strokeColor(COLORS.borderLight).lineWidth(1).stroke();
    doc.y = 90;
  }

  /**
   * Helper to draw Page X of Y footers across all buffered pages
   */
  function applyFooters(doc, { monthLabel, generatedAtFormatted, isLandscape = false }) {
    const pages = doc.bufferedPageRange();
    const pageWidth = isLandscape ? 841.89 : 595.28;
    const footerY = isLandscape ? 560 : 805;

    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);

      // Divider line above footer
      doc.moveTo(40, footerY - 8).lineTo(pageWidth - 40, footerY - 8).strokeColor(COLORS.borderLight).lineWidth(0.75).stroke();

      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textSubtle)
        .text(`MealKhata 2.0 · ${monthLabel}`, 40, footerY, { align: 'left', width: 220 });

      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textSubtle)
        .text(`Generated: ${generatedAtFormatted} IST · Timezone: Asia/Kolkata`, 240, footerY, {
          align: 'center',
          width: pageWidth - 480,
        });

      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textSubtle)
        .text(`Page ${i + 1} of ${pages.count}`, pageWidth - 40 - 150, footerY, {
          align: 'right',
          width: 150,
        });
    }
  }

  return Object.freeze({
    /**
     * Generate Household Monthly Financial Statement PDF (A4 Landscape)
     */
    async generateHouseholdStatementPdf({ month, actorRole }) {
      const report = await reportDataService.getHouseholdReportData(month, { actorRole });
      const { overview, roomCharges, expenses } = report;
      const monthLabel = formatLogicalMonth(month);
      const generatedAtFormatted = formatDateIST(overview.generatedAt);

      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 40,
        bufferPages: true,
        info: {
          Title: `MealKhata Household Financial Statement - ${month}`,
          Author: 'MealKhata System',
          Subject: 'Consolidated Monthly Financial Statement',
        },
      });

      // ==========================================
      // PAGE 1: EXECUTIVE SUMMARY & TOTALS
      // ==========================================
      drawHeader(doc, {
        title: 'Household Monthly Financial Statement',
        subtitle: 'Executive Summary across Mess, Room Fees, and Other Expenses',
        monthLabel,
        isLandscape: true,
      });

      // Overview Callout Boxes
      const boxWidth = 240;
      const boxHeight = 70;
      const startX = 40;
      const gap = 20;

      // Box 1: Tracked Household Costs
      doc.roundedRect(startX, doc.y, boxWidth, boxHeight, 4).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc
        .fontSize(8.5)
        .font('Helvetica-Bold')
        .fillColor(COLORS.primaryDark)
        .text('HOUSEHOLD TRACKED COSTS', startX + 14, doc.y + 12);
      doc
        .fontSize(18)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text(formatPdfCurrency(overview.trackedCosts.totalTrackedCostPaise), startX + 14, doc.y + 28);
      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text('Mess + Room Charges + Outside Purchases', startX + 14, doc.y + 50);

      // Box 2: Managed / External Dues
      const box2X = startX + boxWidth + gap;
      doc.roundedRect(box2X, doc.y - 70, boxWidth, boxHeight, 4).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc
        .fontSize(8.5)
        .font('Helvetica-Bold')
        .fillColor(COLORS.accentDanger)
        .text('MANAGED / EXTERNAL DUES', box2X + 14, doc.y - 70 + 12);
      doc
        .fontSize(18)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text(formatPdfCurrency(overview.managedDues.totalManagedDuesPaise), box2X + 14, doc.y - 70 + 28);
      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text('Unpaid Mess Dues + Unpaid Room Fees', box2X + 14, doc.y - 70 + 50);

      // Box 3: Internal Roommate Reimbursements
      const box3X = box2X + boxWidth + gap;
      doc.roundedRect(box3X, doc.y - 70, boxWidth, boxHeight, 4).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc
        .fontSize(8.5)
        .font('Helvetica-Bold')
        .fillColor(COLORS.accentWarning)
        .text('ROOMMATE REIMBURSEMENTS PENDING', box3X + 14, doc.y - 70 + 12);
      doc
        .fontSize(18)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text(formatPdfCurrency(overview.roommateReimbursements.pendingReimbursementsPaise), box3X + 14, doc.y - 70 + 28);
      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text('Internal transfers (settles debt, not new spend)', box3X + 14, doc.y - 70 + 50);

      doc.y += 20;

      // Domain Category Breakdown Table
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Financial Domain Breakdown', 40, doc.y);

      doc.y += 8;
      const catTableY = doc.y;

      // Table Header
      doc.rect(40, catTableY, 761.89, 20).fill(COLORS.primary);
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.white)
        .text('DOMAIN', 50, catTableY + 6, { width: 140 })
        .text('SCOPE & SOURCE', 190, catTableY + 6, { width: 220 })
        .text('BILLED / TRACKED', 410, catTableY + 6, { width: 110, align: 'right' })
        .text('COLLECTED / PAID', 530, catTableY + 6, { width: 110, align: 'right' })
        .text('OUTSTANDING DUE', 650, catTableY + 6, { width: 110, align: 'right' });

      // Rows
      const domainRows = [
        {
          domain: 'Mess',
          scope: report.isMessClosed ? 'Frozen Settlement (Closed Month)' : 'Live Plate Ledger to Date',
          tracked: overview.trackedCosts.messCostPaise,
          paid: overview.managedDues.messCollectedPaise,
          due: overview.managedDues.messOutstandingPaise,
        },
        {
          domain: 'Room Fees',
          scope: 'Issued Monthly Charges to Residents',
          tracked: overview.trackedCosts.roomFeesCostPaise,
          paid: overview.managedDues.roomFeesCollectedPaise,
          due: overview.managedDues.roomFeesOutstandingPaise,
        },
        {
          domain: 'Other Expenses',
          scope: 'Groceries, Snacks & Shared Household Purchases',
          tracked: overview.trackedCosts.otherExpensesCostPaise,
          paid: overview.roommateReimbursements.settledReimbursementsPaise,
          due: overview.roommateReimbursements.pendingReimbursementsPaise,
        },
      ];

      let currentY = catTableY + 20;
      for (const row of domainRows) {
        doc.rect(40, currentY, 761.89, 22).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
        doc
          .fontSize(8.5)
          .font('Helvetica-Bold')
          .fillColor(COLORS.textDark)
          .text(row.domain, 50, currentY + 6, { width: 140 })
          .font('Helvetica')
          .fillColor(COLORS.textMuted)
          .text(row.scope, 190, currentY + 6, { width: 220 })
          .font('Helvetica-Bold')
          .fillColor(COLORS.textDark)
          .text(formatPdfCurrency(row.tracked), 410, currentY + 6, { width: 110, align: 'right' })
          .font('Helvetica')
          .text(formatPdfCurrency(row.paid), 530, currentY + 6, { width: 110, align: 'right' })
          .fillColor(row.due > 0 ? COLORS.accentDanger : COLORS.accentSuccess)
          .text(formatPdfCurrency(row.due), 650, currentY + 6, { width: 110, align: 'right' });
        currentY += 22;
      }

      // Total Row
      doc.rect(40, currentY, 761.89, 22).fillAndStroke(COLORS.primaryLight, COLORS.border);
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor(COLORS.primaryDark)
        .text('HOUSEHOLD TOTALS', 50, currentY + 6, { width: 140 })
        .text('', 190, currentY + 6, { width: 220 })
        .text(formatPdfCurrency(overview.trackedCosts.totalTrackedCostPaise), 410, currentY + 6, {
          width: 110,
          align: 'right',
        })
        .text(
          formatPdfCurrency(
            overview.managedDues.messCollectedPaise +
              overview.managedDues.roomFeesCollectedPaise +
              overview.roommateReimbursements.settledReimbursementsPaise,
          ),
          530,
          currentY + 6,
          { width: 110, align: 'right' },
        )
        .text(
          formatPdfCurrency(
            overview.managedDues.totalManagedDuesPaise +
              overview.roommateReimbursements.pendingReimbursementsPaise,
          ),
          650,
          currentY + 6,
          { width: 110, align: 'right' },
        );

      doc.y = currentY + 35;

      // Status & Audit Note on Page 1
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Accounting Period & Ledger Status:', 40, doc.y);
      doc.y += 4;
      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(
          `• Mess Status: ${report.isMessClosed ? 'CLOSED (Frozen Statement Snapshot)' : 'OPEN (Active Daily Consumption)'}\n` +
            `• Room Fees: ${overview.managedDues.roomFeesOutstandingPaise === 0 ? 'Fully Collected' : 'Issued charges pending settlement'}\n` +
            `• Other Expenses: ${overview.roommateReimbursements.pendingReimbursementsPaise === 0 ? 'All roommate debts settled' : 'Unsettled roommate reimbursements pending'}\n` +
            '• Important Accounting Invariant: Reimbursements between roommates reduce personal debts and do NOT constitute new household spending.',
          40,
          doc.y,
          { width: 760, lineGap: 3 },
        );

      // ==========================================
      // PAGE 2: CONSOLIDATED MEMBER FINANCIAL TABLE
      // ==========================================
      doc.addPage();
      drawHeader(doc, {
        title: 'Member Financial Summary',
        subtitle: 'Per-member obligations across Mess, Room Fees, and Shared Expenses',
        monthLabel,
        isLandscape: true,
      });

      const memberTableY = doc.y;
      doc.rect(40, memberTableY, 761.89, 22).fill(COLORS.primary);

      // Multi-column Header
      doc
        .fontSize(7.5)
        .font('Helvetica-Bold')
        .fillColor(COLORS.white)
        .text('MEMBER', 48, memberTableY + 6, { width: 75 })
        .text('MESS BILL', 125, memberTableY + 6, { width: 60, align: 'right' })
        .text('MESS PAID', 190, memberTableY + 6, { width: 60, align: 'right' })
        .text('MESS DUE', 255, memberTableY + 6, { width: 60, align: 'right' })
        .text('ROOM CHG', 320, memberTableY + 6, { width: 65, align: 'right' })
        .text('ROOM PAID', 390, memberTableY + 6, { width: 65, align: 'right' })
        .text('ROOM DUE', 460, memberTableY + 6, { width: 65, align: 'right' })
        .text('EXP SHARE', 530, memberTableY + 6, { width: 65, align: 'right' })
        .text('EXP OWED', 600, memberTableY + 6, { width: 65, align: 'right' })
        .text('RECEIVABLE', 670, memberTableY + 6, { width: 65, align: 'right' })
        .text('TOTAL TO PAY', 735, memberTableY + 6, { width: 65, align: 'right' });

      let mY = memberTableY + 22;
      let totalMessBill = 0;
      let totalMessPaid = 0;
      let totalMessDue = 0;
      let totalRoomCharge = 0;
      let totalRoomPaid = 0;
      let totalRoomDue = 0;
      let totalExpShare = 0;
      let totalExpOwed = 0;
      let totalExpRecv = 0;
      let totalCombinedPayable = 0;

      for (const member of MEMBERS) {
        const ms = overview.memberSummaries[member.id];
        if (!ms) continue;

        totalMessBill += ms.mess.billPaise;
        totalMessPaid += ms.mess.paidPaise;
        totalMessDue += ms.mess.remainingPaise;
        totalRoomCharge += ms.room.issuedChargePaise;
        totalRoomPaid += ms.room.paidPaise;
        totalRoomDue += ms.room.remainingPaise;
        totalExpShare += ms.expenses.spendingSharePaise;
        totalExpOwed += ms.expenses.owedToOthersPaise;
        totalExpRecv += ms.expenses.owedToMePaise;
        totalCombinedPayable += ms.combined.outstandingPayablePaise;

        doc.rect(40, mY, 761.89, 24).fillAndStroke(mY % 2 === 0 ? COLORS.white : COLORS.rowAlt, COLORS.borderLight);

        doc
          .fontSize(8)
          .font('Helvetica-Bold')
          .fillColor(COLORS.textDark)
          .text(member.name, 48, mY + 7, { width: 75 })
          .font('Helvetica')
          .text(formatPdfCurrency(ms.mess.billPaise), 125, mY + 7, { width: 60, align: 'right' })
          .text(formatPdfCurrency(ms.mess.paidPaise), 190, mY + 7, { width: 60, align: 'right' })
          .fillColor(ms.mess.remainingPaise > 0 ? COLORS.accentDanger : COLORS.textMuted)
          .text(formatPdfCurrency(ms.mess.remainingPaise), 255, mY + 7, { width: 60, align: 'right' })
          .fillColor(COLORS.textDark)
          .text(formatPdfCurrency(ms.room.issuedChargePaise), 320, mY + 7, { width: 65, align: 'right' })
          .text(formatPdfCurrency(ms.room.paidPaise), 390, mY + 7, { width: 65, align: 'right' })
          .fillColor(ms.room.remainingPaise > 0 ? COLORS.accentDanger : COLORS.textMuted)
          .text(formatPdfCurrency(ms.room.remainingPaise), 460, mY + 7, { width: 65, align: 'right' })
          .fillColor(COLORS.textDark)
          .text(formatPdfCurrency(ms.expenses.spendingSharePaise), 530, mY + 7, { width: 65, align: 'right' })
          .fillColor(ms.expenses.owedToOthersPaise > 0 ? COLORS.accentWarning : COLORS.textMuted)
          .text(formatPdfCurrency(ms.expenses.owedToOthersPaise), 600, mY + 7, { width: 65, align: 'right' })
          .fillColor(ms.expenses.owedToMePaise > 0 ? COLORS.accentSuccess : COLORS.textMuted)
          .text(formatPdfCurrency(ms.expenses.owedToMePaise), 670, mY + 7, { width: 65, align: 'right' })
          .font('Helvetica-Bold')
          .fillColor(ms.combined.outstandingPayablePaise > 0 ? COLORS.primaryDark : COLORS.accentSuccess)
          .text(formatPdfCurrency(ms.combined.outstandingPayablePaise), 735, mY + 7, { width: 65, align: 'right' });

        mY += 24;
      }

      // Member Summary Totals Row
      doc.rect(40, mY, 761.89, 24).fillAndStroke(COLORS.primaryLight, COLORS.border);
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.primaryDark)
        .text('TOTALS', 48, mY + 7, { width: 75 })
        .text(formatPdfCurrency(totalMessBill), 125, mY + 7, { width: 60, align: 'right' })
        .text(formatPdfCurrency(totalMessPaid), 190, mY + 7, { width: 60, align: 'right' })
        .text(formatPdfCurrency(totalMessDue), 255, mY + 7, { width: 60, align: 'right' })
        .text(formatPdfCurrency(totalRoomCharge), 320, mY + 7, { width: 65, align: 'right' })
        .text(formatPdfCurrency(totalRoomPaid), 390, mY + 7, { width: 65, align: 'right' })
        .text(formatPdfCurrency(totalRoomDue), 460, mY + 7, { width: 65, align: 'right' })
        .text(formatPdfCurrency(totalExpShare), 530, mY + 7, { width: 65, align: 'right' })
        .text(formatPdfCurrency(totalExpOwed), 600, mY + 7, { width: 65, align: 'right' })
        .text(formatPdfCurrency(totalExpRecv), 670, mY + 7, { width: 65, align: 'right' })
        .text(formatPdfCurrency(totalCombinedPayable), 735, mY + 7, { width: 65, align: 'right' });

      doc.y = mY + 36;

      // Invariant note
      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(
          'Total to Pay = Mess Due + Room Due + Expenses Owed to Others.\n' +
            'Receivables are displayed separately and are not automatically deducted from external payments.',
          40,
          doc.y,
          { width: 760, lineGap: 3 },
        );

      // ==========================================
      // PAGE 3: ROOM FEES DOMAIN DETAILS
      // ==========================================
      doc.addPage();
      drawHeader(doc, {
        title: 'Room Fees Domain Ledger',
        subtitle: 'Individual fee plans, issued monthly charges, and verified room payments',
        monthLabel,
        isLandscape: true,
      });

      doc.rect(40, doc.y, 761.89, 20).fill(COLORS.primary);
      const rfY = doc.y;
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.white)
        .text('ROOM', 48, rfY + 6, { width: 80 })
        .text('RESIDENT', 135, rfY + 6, { width: 120 })
        .text('BASE PLAN', 260, rfY + 6, { width: 85, align: 'right' })
        .text('ADJUSTMENTS', 355, rfY + 6, { width: 85, align: 'right' })
        .text('FINAL BILL', 450, rfY + 6, { width: 85, align: 'right' })
        .text('AMOUNT PAID', 545, rfY + 6, { width: 85, align: 'right' })
        .text('REMAINING', 640, rfY + 6, { width: 80, align: 'right' })
        .text('STATUS', 730, rfY + 6, { width: 65, align: 'center' });

      let rRowY = rfY + 20;
      if (roomCharges.length === 0) {
        doc.rect(40, rRowY, 761.89, 30).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
        doc
          .fontSize(8.5)
          .font('Helvetica')
          .fillColor(COLORS.textMuted)
          .text('No room charges have been issued for this month.', 40, rRowY + 10, {
            width: 761.89,
            align: 'center',
          });
      } else {
        for (const rc of roomCharges) {
          doc.rect(40, rRowY, 761.89, 22).fillAndStroke(COLORS.white, COLORS.borderLight);
          const adjTotal = (rc.adjustments || []).reduce((sum, a) => sum + a.amountPaise, 0);

          doc
            .fontSize(8)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text(`Room ${rc.roomNumber || 'N/A'}`, 48, rRowY + 6, { width: 80 })
            .font('Helvetica')
            .text(getMemberName(rc.memberId), 135, rRowY + 6, { width: 120 })
            .text(formatPdfCurrency(rc.baseAmountPaise), 260, rRowY + 6, { width: 85, align: 'right' })
            .text(formatPdfCurrency(adjTotal), 355, rRowY + 6, { width: 85, align: 'right' })
            .font('Helvetica-Bold')
            .text(formatPdfCurrency(rc.finalBillAmountPaise), 450, rRowY + 6, { width: 85, align: 'right' })
            .font('Helvetica')
            .text(formatPdfCurrency(rc.paidAmountPaise), 545, rRowY + 6, { width: 85, align: 'right' })
            .fillColor(rc.remainingAmountPaise > 0 ? COLORS.accentDanger : COLORS.accentSuccess)
            .text(formatPdfCurrency(rc.remainingAmountPaise), 640, rRowY + 6, { width: 80, align: 'right' })
            .fillColor(COLORS.textDark)
            .text(rc.paymentStatus ? rc.paymentStatus.toUpperCase() : 'PENDING', 730, rRowY + 6, {
              width: 65,
              align: 'center',
            });

          rRowY += 22;
        }
      }

      // ==========================================
      // PAGE 4: OTHER EXPENSES DOMAIN LEDGER
      // ==========================================
      doc.addPage();
      drawHeader(doc, {
        title: 'Other Expenses & Shared Spending Ledger',
        subtitle: 'Itemized shared purchases, allocations, and confirmed roommate reimbursements',
        monthLabel,
        isLandscape: true,
      });

      doc.rect(40, doc.y, 761.89, 20).fill(COLORS.primary);
      const expY = doc.y;
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.white)
        .text('DATE', 48, expY + 6, { width: 70 })
        .text('CATEGORY', 125, expY + 6, { width: 85 })
        .text('TITLE / DESCRIPTION', 215, expY + 6, { width: 180 })
        .text('PAID BY', 400, expY + 6, { width: 80 })
        .text('SPLIT', 485, expY + 6, { width: 65 })
        .text('AMOUNT', 555, expY + 6, { width: 80, align: 'right' })
        .text('REIMBURSED', 640, expY + 6, { width: 80, align: 'right' })
        .text('SETTLEMENT', 725, expY + 6, { width: 70, align: 'center' });

      let eRowY = expY + 20;
      if (expenses.length === 0) {
        doc.rect(40, eRowY, 761.89, 30).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
        doc
          .fontSize(8.5)
          .font('Helvetica')
          .fillColor(COLORS.textMuted)
          .text('No other expenses have been recorded for this month.', 40, eRowY + 10, {
            width: 761.89,
            align: 'center',
          });
      } else {
        for (const e of expenses.slice(0, 16)) {
          // Limit to first 16 rows per page
          doc.rect(40, eRowY, 761.89, 22).fillAndStroke(COLORS.white, COLORS.borderLight);
          const reimbursedTotal = (e.reimbursements || []).reduce((sum, r) => sum + r.amountPaise, 0);

          doc
            .fontSize(8)
            .font('Helvetica')
            .fillColor(COLORS.textDark)
            .text(e.date, 48, eRowY + 6, { width: 70 })
            .text(e.category?.replace('_', ' ').toUpperCase() || 'OTHER', 125, eRowY + 6, { width: 85 })
            .text(e.title || 'Untitled', 215, eRowY + 6, { width: 180 })
            .text(getMemberName(e.paidByMemberId), 400, eRowY + 6, { width: 80 })
            .text(e.splitType ? e.splitType.toUpperCase() : 'EQUAL', 485, eRowY + 6, { width: 65 })
            .font('Helvetica-Bold')
            .text(formatPdfCurrency(e.amountPaise), 555, eRowY + 6, { width: 80, align: 'right' })
            .font('Helvetica')
            .text(formatPdfCurrency(reimbursedTotal), 640, eRowY + 6, { width: 80, align: 'right' })
            .fillColor(COLORS.textMuted)
            .text(e.settlementStatus ? e.settlementStatus.replace('_', ' ').toUpperCase() : 'OPEN', 725, eRowY + 6, {
              width: 70,
              align: 'center',
            });

          eRowY += 22;
        }
      }

      // Apply footers
      applyFooters(doc, {
        monthLabel,
        generatedAtFormatted,
        isLandscape: true,
      });

      doc.end();
      return doc;
    },

    /**
     * Generate Member Personal Monthly Financial Statement PDF (A4 Portrait)
     */
    async generateMemberStatementPdf({ memberId, month, actorRole }) {
      const report = await reportDataService.getMemberReportData(memberId, month, { actorRole });
      const { overview, expenses } = report;
      const monthLabel = formatLogicalMonth(month);
      const generatedAtFormatted = formatDateIST(overview.generatedAt);
      const memberName = getMemberName(memberId);

      const doc = new PDFDocument({
        size: 'A4',
        layout: 'portrait',
        margin: 40,
        bufferPages: true,
        info: {
          Title: `MealKhata Personal Statement - ${memberName} - ${month}`,
          Author: 'MealKhata System',
          Subject: 'Personal Monthly Financial Statement',
        },
      });

      // Page Header
      drawHeader(doc, {
        title: `Personal Statement · ${memberName}`,
        subtitle: `Monthly consolidated obligations for ${memberName} (${monthLabel})`,
        monthLabel,
        isLandscape: false,
      });

      // Summary KPI Cards (Portrait: 515.28 pt printable width)
      const cardWidth = 160;
      const cardHeight = 65;
      const startX = 40;
      const gap = 17;

      // Card 1: Total to Pay
      doc.roundedRect(startX, doc.y, cardWidth, cardHeight, 4).fillAndStroke(COLORS.primaryLight, COLORS.primary);
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.primaryDark)
        .text('TOTAL TO PAY', startX + 12, doc.y + 10);
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor(COLORS.primaryDark)
        .text(formatPdfCurrency(overview.combined.outstandingPayablePaise), startX + 12, doc.y + 24);
      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text('Mess + Room + Expense Debts', startX + 12, doc.y + 45);

      // Card 2: You Are Owed
      const card2X = startX + cardWidth + gap;
      doc.roundedRect(card2X, doc.y - 65, cardWidth, cardHeight, 4).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.accentSuccess)
        .text('YOU ARE OWED', card2X + 12, doc.y - 65 + 10);
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text(formatPdfCurrency(overview.combined.receivablePaise), card2X + 12, doc.y - 65 + 24);
      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text('From roommates for shared buys', card2X + 12, doc.y - 65 + 45);

      // Card 3: Personal Tracked Spend
      const card3X = card2X + cardWidth + gap;
      doc.roundedRect(card3X, doc.y - 65, cardWidth, cardHeight, 4).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textMuted)
        .text('PERSONAL CONSUMPTION', card3X + 12, doc.y - 65 + 10);
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text(formatPdfCurrency(overview.combined.personalTrackedCostPaise), card3X + 12, doc.y - 65 + 24);
      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text('Economic share this month', card3X + 12, doc.y - 65 + 45);

      doc.y += 24;

      // Section 1: Domain-Wise Dues Breakdown Table
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.textDark).text('Outstanding Dues Breakdown', 40, doc.y);
      doc.y += 6;

      const duesTableY = doc.y;
      doc.rect(40, duesTableY, 515.28, 18).fill(COLORS.primary);
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.white)
        .text('CATEGORY', 50, duesTableY + 5, { width: 140 })
        .text('BILLED / ISSUED', 190, duesTableY + 5, { width: 100, align: 'right' })
        .text('ALREADY PAID', 300, duesTableY + 5, { width: 100, align: 'right' })
        .text('OUTSTANDING DUE', 410, duesTableY + 5, { width: 135, align: 'right' });

      const duesRows = [
        {
          label: 'Hostel Mess Bill',
          billed: overview.mess.billPaise,
          paid: overview.mess.paidPaise,
          due: overview.mess.remainingPaise,
        },
        {
          label: `Room Fee (${overview.room.roomNumber ? 'Room ' + overview.room.roomNumber : 'Hostel Room'})`,
          billed: overview.room.issuedChargePaise,
          paid: overview.room.paidPaise,
          due: overview.room.remainingPaise,
        },
        {
          label: 'Reimbursements Owed to Roommates',
          billed: overview.expenses.spendingSharePaise,
          paid: overview.expenses.merchantSpendingPaise,
          due: overview.expenses.owedToOthersPaise,
        },
      ];

      let dY = duesTableY + 18;
      for (const r of duesRows) {
        doc.rect(40, dY, 515.28, 22).fillAndStroke(COLORS.white, COLORS.borderLight);
        doc
          .fontSize(8.5)
          .font('Helvetica-Bold')
          .fillColor(COLORS.textDark)
          .text(r.label, 50, dY + 6, { width: 140 })
          .font('Helvetica')
          .text(formatPdfCurrency(r.billed), 190, dY + 6, { width: 100, align: 'right' })
          .text(formatPdfCurrency(r.paid), 300, dY + 6, { width: 100, align: 'right' })
          .font('Helvetica-Bold')
          .fillColor(r.due > 0 ? COLORS.accentDanger : COLORS.accentSuccess)
          .text(formatPdfCurrency(r.due), 410, dY + 6, { width: 135, align: 'right' });
        dY += 22;
      }

      // Total Line
      doc.rect(40, dY, 515.28, 22).fillAndStroke(COLORS.primaryLight, COLORS.border);
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor(COLORS.primaryDark)
        .text('TOTAL REMAINING TO PAY', 50, dY + 6, { width: 200 })
        .text(formatPdfCurrency(overview.combined.outstandingPayablePaise), 410, dY + 6, {
          width: 135,
          align: 'right',
        });

      doc.y = dY + 30;

      // Section 2: Specific Roommate Debts Owed
      if (overview.expenses.debtsOwed && overview.expenses.debtsOwed.length > 0) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.textDark).text('Reimbursements You Owe to Roommates', 40, doc.y);
        doc.y += 6;

        for (const debt of overview.expenses.debtsOwed) {
          doc.rect(40, doc.y, 515.28, 20).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
          doc
            .fontSize(8)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text(`Pay to ${getMemberName(debt.toMemberId)}:`, 50, doc.y + 5, { width: 140 })
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(`${debt.title} (${debt.date})`, 190, doc.y + 5, { width: 220 })
            .font('Helvetica-Bold')
            .fillColor(COLORS.accentDanger)
            .text(formatPdfCurrency(debt.amountPaise), 410, doc.y + 5, { width: 135, align: 'right' });
          doc.y += 22;
        }
        doc.y += 10;
      }

      // Section 3: Receivables Owed by Roommates
      if (overview.expenses.receivables && overview.expenses.receivables.length > 0) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.textDark).text('Reimbursements Owed to You by Roommates', 40, doc.y);
        doc.y += 6;

        for (const recv of overview.expenses.receivables) {
          doc.rect(40, doc.y, 515.28, 20).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
          doc
            .fontSize(8)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text(`${getMemberName(recv.fromMemberId)} owes you:`, 50, doc.y + 5, { width: 140 })
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(`${recv.title} (${recv.date})`, 190, doc.y + 5, { width: 220 })
            .font('Helvetica-Bold')
            .fillColor(COLORS.accentSuccess)
            .text(formatPdfCurrency(recv.amountPaise), 410, doc.y + 5, { width: 135, align: 'right' });
          doc.y += 22;
        }
        doc.y += 10;
      }

      // Notes
      doc.y += 10;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.textDark).text('Notice & Settlement Instructions:', 40, doc.y);
      doc.y += 4;
      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(
          '1. Mess and Room Fee payments must be transferred using their verified recipient UPI details.\n' +
            '2. Expense reimbursements are settled directly between roommates and confirmed by an Admin.\n' +
            '3. Receivables owed to you cannot be automatically deducted from your Mess or Room Fee dues.\n' +
            '4. This personal statement is private and reflects confirmed financial records as of the generation time.',
          40,
          doc.y,
          { width: 515, lineGap: 3 },
        );

      // Apply footers
      applyFooters(doc, {
        monthLabel,
        generatedAtFormatted,
        isLandscape: false,
      });

      doc.end();
      return doc;
    },
  });
}

export const monthlyFinancialPdfService = createMonthlyFinancialPdfService();
