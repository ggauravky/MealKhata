/**
 * MealKhata 2.0 - Lifetime Financial Statement & Clearance PDF Generator
 * Uses PDFKit to produce professional, multi-page vector PDFs.
 */

import PDFDocument from 'pdfkit';
import { lifetimeReportService } from './lifetimeReport.service.js';
import { stayRepository } from './stay.repository.js';
import { formatPdfCurrency } from '../finance/financialConstants.js';
import { formatLogicalMonth } from '../utils/month.js';
import { CLEARANCE_STATUSES, STAY_STATUSES } from './stay.constants.js';

const COLORS = Object.freeze({
  primary: '#0f766e', // Teal 700
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
});

function formatDateIST(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
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

export function createLifetimePdfService({
  reportService = lifetimeReportService,
  repository = stayRepository,
} = {}) {
  /**
   * Draw standard landscape header
   */
  function drawLandscapeHeader(doc, { title, subtitle, memberName }) {
    const pageWidth = 841.89;
    const contentWidth = pageWidth - 80;

    doc.rect(40, 30, contentWidth, 4).fill(COLORS.primary);

    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor(COLORS.textDark)
      .text(title, 40, 42);

    if (subtitle) {
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(subtitle, 40, 62);
    }

    if (memberName) {
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor(COLORS.primary)
        .text(`Resident: ${memberName}`, pageWidth - 260, 44, { align: 'right', width: 220 });
    }

    doc.moveTo(40, 78).lineTo(pageWidth - 40, 78).strokeColor(COLORS.borderLight).lineWidth(1).stroke();
    doc.y = 90;
  }

  /**
   * Apply Page X of Y footers
   */
  function applyFooters(doc, { label, isLandscape = true }) {
    const pages = doc.bufferedPageRange();
    const pageWidth = isLandscape ? 841.89 : 595.28;
    const footerY = isLandscape ? 560 : 805;

    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);

      doc.moveTo(40, footerY - 8).lineTo(pageWidth - 40, footerY - 8).strokeColor(COLORS.borderLight).lineWidth(0.75).stroke();

      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textSubtle)
        .text(`MealKhata 2.0 · ${label}`, 40, footerY, { align: 'left', width: 280 });

      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textSubtle)
        .text(`Generated: ${formatDateIST(new Date())}`, 320, footerY, {
          align: 'center',
          width: isLandscape ? 200 : 120,
        });

      doc
        .fontSize(7.5)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textMuted)
        .text(`Page ${i + 1} of ${pages.count}`, pageWidth - 140, footerY, {
          align: 'right',
          width: 100,
        });
    }
  }

  return {
    async generateLifetimeStatementPdf(stayId, actorRole = 'member') {
      const data = await reportService.getLifetimeFinancialReport(stayId, { actorRole });
      return this.buildLifetimeStatementPdf(data);
    },

    buildLifetimeStatementPdf(data) {
      const { stay, member, duration, lifetimeTotals, depositOverview, clearances, monthlySummaries } = data;

      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 40,
        bufferPages: true,
        info: {
          Title: `MealKhata Lifetime Financial Statement - ${member.displayName}`,
          Author: 'MealKhata System',
          Subject: 'Hostel Lifetime Financial History',
        },
      });

      // ==========================================
      // PAGE 1: EXECUTIVE SUMMARY
      // ==========================================
      drawLandscapeHeader(doc, {
        title: 'MealKhata Hostel Lifetime Financial Statement',
        subtitle: `Complete hostel financial history from admission to ${duration.actualLeftOn || 'present'}`,
        memberName: member.displayName,
      });

      // Stay details block
      doc.rect(40, doc.y, 761.89, 44).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Stay Status:', 55, doc.y + 10)
        .font('Helvetica')
        .fillColor(duration.status === STAY_STATUSES.CHECKED_OUT ? COLORS.accentSuccess : COLORS.primary)
        .text(duration.status, 125, doc.y + 10)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Joined:', 240, doc.y + 10)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(duration.joinedOn, 290, doc.y + 10)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Departure:', 400, doc.y + 10)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(duration.actualLeftOn || 'Still Active', 465, doc.y + 10)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Duration:', 580, doc.y + 10)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(`${duration.totalMonths} billing months`, 640, doc.y + 10);

      doc.y += 56;

      // 4 Lifetime KPI Cards
      const cardWidth = 175;
      const cardHeight = 65;
      const startX = 40;
      const gap = 20;

      // Card 1: Total Tracked Spending
      doc.roundedRect(startX, doc.y, cardWidth, cardHeight, 4).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primaryDark).text('TOTAL TRACKED SPENDING', startX + 10, doc.y + 10);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(COLORS.textDark).text(formatPdfCurrency(lifetimeTotals.combined.totalTrackedSpendingPaise), startX + 10, doc.y + 24);
      doc.fontSize(7).font('Helvetica').fillColor(COLORS.textMuted).text('Mess + Room + Purchases', startX + 10, doc.y + 46);

      // Card 2: Total Outstanding Payable
      const x2 = startX + cardWidth + gap;
      doc.roundedRect(x2, doc.y, cardWidth, cardHeight, 4).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.accentDanger).text('TOTAL OUTSTANDING DUE', x2 + 10, doc.y + 10);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(lifetimeTotals.combined.totalOutstandingPayablePaise > 0 ? COLORS.accentDanger : COLORS.accentSuccess).text(formatPdfCurrency(lifetimeTotals.combined.totalOutstandingPayablePaise), x2 + 10, doc.y + 24);
      doc.fontSize(7).font('Helvetica').fillColor(COLORS.textMuted).text('Mess + Room + Expense Debts', x2 + 10, doc.y + 46);

      // Card 3: Receivables Owed by Roommates
      const x3 = x2 + cardWidth + gap;
      doc.roundedRect(x3, doc.y, cardWidth, cardHeight, 4).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.accentSuccess).text('ROOMMATE RECEIVABLES', x3 + 10, doc.y + 10);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(COLORS.textDark).text(formatPdfCurrency(lifetimeTotals.combined.totalReceivablePaise), x3 + 10, doc.y + 24);
      doc.fontSize(7).font('Helvetica').fillColor(COLORS.textMuted).text('Tracked separately (no netting)', x3 + 10, doc.y + 46);

      // Card 4: Security Deposit Held
      const x4 = x3 + cardWidth + gap;
      doc.roundedRect(x4, doc.y, cardWidth, cardHeight, 4).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primaryDark).text('SECURITY DEPOSIT HELD', x4 + 10, doc.y + 10);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(COLORS.textDark).text(formatPdfCurrency(depositOverview.summary.heldPaise), x4 + 10, doc.y + 24);
      doc.fontSize(7).font('Helvetica').fillColor(COLORS.textMuted).text(`Received: ${formatPdfCurrency(depositOverview.summary.receivedPaise)}`, x4 + 10, doc.y + 46);

      doc.y += 85;

      // Domain Lifetime Totals Summary Table
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.textDark).text('Lifetime Financial Domain Breakdown', 40, doc.y);
      doc.y += 6;

      const tblX = 40;
      const tblW = 761.89;
      doc.rect(tblX, doc.y, tblW, 20).fill(COLORS.primary);
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.white)
        .text('Financial Domain', tblX + 10, doc.y + 5, { width: 180 })
        .text('Total Billed / Share', tblX + 220, doc.y + 5, { width: 140, align: 'right' })
        .text('Total Paid / Settled', tblX + 390, doc.y + 5, { width: 140, align: 'right' })
        .text('Current Remaining Due', tblX + 580, doc.y + 5, { width: 140, align: 'right' });

      doc.y += 20;

      const domainRows = [
        {
          name: 'Hostel Mess (Meal Consumption)',
          billed: lifetimeTotals.mess.billedPaise,
          paid: lifetimeTotals.mess.paidPaise,
          due: lifetimeTotals.mess.remainingPaise,
        },
        {
          name: `Room Fees (${lifetimeTotals.room.issuedMonths} months issued: ${lifetimeTotals.room.fullyPaidMonths} paid)`,
          billed: lifetimeTotals.room.billedPaise,
          paid: lifetimeTotals.room.paidPaise,
          due: lifetimeTotals.room.remainingPaise,
        },
        {
          name: 'Other Shared Expenses (Outside purchases & snacks)',
          billed: lifetimeTotals.expenses.spendingSharePaise,
          paid: lifetimeTotals.expenses.spendingSharePaise - lifetimeTotals.expenses.owedToOthersPaise,
          due: lifetimeTotals.expenses.owedToOthersPaise,
        },
      ];

      for (let i = 0; i < domainRows.length; i++) {
        const row = domainRows[i];
        doc.rect(tblX, doc.y, tblW, 20).fillAndStroke(i % 2 === 0 ? COLORS.rowAlt : COLORS.white, COLORS.borderLight);
        doc
          .fontSize(8)
          .font('Helvetica-Bold')
          .fillColor(COLORS.textDark)
          .text(row.name, tblX + 10, doc.y + 5, { width: 200 })
          .font('Helvetica')
          .fillColor(COLORS.textMuted)
          .text(formatPdfCurrency(row.billed), tblX + 220, doc.y + 5, { width: 140, align: 'right' })
          .text(formatPdfCurrency(row.paid), tblX + 390, doc.y + 5, { width: 140, align: 'right' })
          .font('Helvetica-Bold')
          .fillColor(row.due > 0 ? COLORS.accentDanger : COLORS.accentSuccess)
          .text(formatPdfCurrency(row.due), tblX + 580, doc.y + 5, { width: 140, align: 'right' });
        doc.y += 20;
      }

      // ==========================================
      // PAGE 2: MONTH-BY-MONTH FINANCIAL TABLE
      // ==========================================
      doc.addPage();
      drawLandscapeHeader(doc, {
        title: 'Month-by-Month Financial History',
        subtitle: 'Comprehensive monthly records across Mess, Room Fees, and Other Expenses',
        memberName: member.displayName,
      });

      // Table Header
      const colX = [40, 110, 175, 240, 310, 375, 440, 510, 580, 650, 720];
      const colW = [65, 60, 60, 65, 60, 60, 65, 65, 65, 65, 75];

      function renderMonthlyTableHeader() {
        doc.rect(40, doc.y, 761.89, 22).fill(COLORS.primary);
        doc
          .fontSize(7.5)
          .font('Helvetica-Bold')
          .fillColor(COLORS.white)
          .text('Month', colX[0] + 4, doc.y + 6, { width: colW[0] })
          .text('Mess Bill', colX[1], doc.y + 6, { width: colW[1], align: 'right' })
          .text('Mess Paid', colX[2], doc.y + 6, { width: colW[2], align: 'right' })
          .text('Mess Due', colX[3], doc.y + 6, { width: colW[3], align: 'right' })
          .text('Room Charge', colX[4], doc.y + 6, { width: colW[4], align: 'right' })
          .text('Room Paid', colX[5], doc.y + 6, { width: colW[5], align: 'right' })
          .text('Room Due', colX[6], doc.y + 6, { width: colW[6], align: 'right' })
          .text('Exp Share', colX[7], doc.y + 6, { width: colW[7], align: 'right' })
          .text('Exp Owed', colX[8], doc.y + 6, { width: colW[8], align: 'right' })
          .text('Receivable', colX[9], doc.y + 6, { width: colW[9], align: 'right' })
          .text('Total to Pay', colX[10], doc.y + 6, { width: colW[10], align: 'right' });
        doc.y += 22;
      }

      renderMonthlyTableHeader();

      for (let i = 0; i < monthlySummaries.length; i++) {
        const ms = monthlySummaries[i];

        if (doc.y > 520) {
          doc.addPage();
          drawLandscapeHeader(doc, {
            title: 'Month-by-Month Financial History (Cont.)',
            subtitle: 'Comprehensive monthly records across Mess, Room Fees, and Other Expenses',
            memberName: member.displayName,
          });
          renderMonthlyTableHeader();
        }

        doc.rect(40, doc.y, 761.89, 18).fillAndStroke(i % 2 === 0 ? COLORS.rowAlt : COLORS.white, COLORS.borderLight);
        doc
          .fontSize(7.5)
          .font('Helvetica-Bold')
          .fillColor(COLORS.textDark)
          .text(formatLogicalMonth(ms.month), colX[0] + 4, doc.y + 4, { width: colW[0] })
          .font('Helvetica')
          .fillColor(COLORS.textMuted)
          .text(formatPdfCurrency(ms.mess.billPaise), colX[1], doc.y + 4, { width: colW[1], align: 'right' })
          .text(formatPdfCurrency(ms.mess.paidPaise), colX[2], doc.y + 4, { width: colW[2], align: 'right' })
          .font('Helvetica-Bold')
          .fillColor(ms.mess.remainingPaise > 0 ? COLORS.accentDanger : COLORS.textMuted)
          .text(formatPdfCurrency(ms.mess.remainingPaise), colX[3], doc.y + 4, { width: colW[3], align: 'right' })
          .font('Helvetica')
          .fillColor(COLORS.textMuted)
          .text(formatPdfCurrency(ms.room.issuedChargePaise), colX[4], doc.y + 4, { width: colW[4], align: 'right' })
          .text(formatPdfCurrency(ms.room.paidPaise), colX[5], doc.y + 4, { width: colW[5], align: 'right' })
          .font('Helvetica-Bold')
          .fillColor(ms.room.remainingPaise > 0 ? COLORS.accentDanger : COLORS.textMuted)
          .text(formatPdfCurrency(ms.room.remainingPaise), colX[6], doc.y + 4, { width: colW[6], align: 'right' })
          .font('Helvetica')
          .fillColor(COLORS.textMuted)
          .text(formatPdfCurrency(ms.expenses.spendingSharePaise), colX[7], doc.y + 4, { width: colW[7], align: 'right' })
          .font('Helvetica-Bold')
          .fillColor(ms.expenses.owedToOthersPaise > 0 ? COLORS.accentWarning : COLORS.textMuted)
          .text(formatPdfCurrency(ms.expenses.owedToOthersPaise), colX[8], doc.y + 4, { width: colW[8], align: 'right' })
          .font('Helvetica')
          .fillColor(COLORS.accentSuccess)
          .text(formatPdfCurrency(ms.expenses.owedToMePaise), colX[9], doc.y + 4, { width: colW[9], align: 'right' })
          .font('Helvetica-Bold')
          .fillColor(ms.combined.outstandingPayablePaise > 0 ? COLORS.accentDanger : COLORS.accentSuccess)
          .text(formatPdfCurrency(ms.combined.outstandingPayablePaise), colX[10], doc.y + 4, { width: colW[10], align: 'right' });

        doc.y += 18;
      }

      // ==========================================
      // PAGE 3: SECURITY DEPOSIT LEDGER
      // ==========================================
      doc.addPage();
      drawLandscapeHeader(doc, {
        title: 'Security Deposit Ledger & Audit',
        subtitle: 'Refundable funds held during stay — kept strictly independent of revenue ledgers',
        memberName: member.displayName,
      });

      // Deposit KPI summary
      doc.rect(40, doc.y, 761.89, 44).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Deposit Expected:', 50, doc.y + 14)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(formatPdfCurrency(depositOverview.summary.expectedPaise), 160, doc.y + 14)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Deposit Received:', 260, doc.y + 14)
        .font('Helvetica')
        .fillColor(COLORS.primary)
        .text(formatPdfCurrency(depositOverview.summary.receivedPaise), 370, doc.y + 14)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Deductions:', 480, doc.y + 14)
        .font('Helvetica')
        .fillColor(depositOverview.summary.deductedPaise > 0 ? COLORS.accentWarning : COLORS.textMuted)
        .text(formatPdfCurrency(depositOverview.summary.deductedPaise), 560, doc.y + 14)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Refunded:', 650, doc.y + 14)
        .font('Helvetica')
        .fillColor(COLORS.accentSuccess)
        .text(formatPdfCurrency(depositOverview.summary.refundedPaise), 715, doc.y + 14);

      doc.y += 56;

      // Deposit Transactions Table
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.textDark).text('Itemized Deposit Transactions', 40, doc.y);
      doc.y += 6;

      doc.rect(40, doc.y, 761.89, 20).fill(COLORS.primary);
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLORS.white)
        .text('Date', 50, doc.y + 5, { width: 90 })
        .text('Transaction Type', 150, doc.y + 5, { width: 110 })
        .text('Amount', 280, doc.y + 5, { width: 100, align: 'right' })
        .text('Method / Reference', 410, doc.y + 5, { width: 140 })
        .text('Documented Reason', 570, doc.y + 5, { width: 220 });
      doc.y += 20;

      const txs = depositOverview.transactions || [];
      if (txs.length === 0) {
        doc.rect(40, doc.y, 761.89, 24).fillAndStroke(COLORS.white, COLORS.borderLight);
        doc.fontSize(8).font('Helvetica-Oblique').fillColor(COLORS.textSubtle).text('No security deposit transactions recorded for this stay.', 50, doc.y + 7);
        doc.y += 24;
      } else {
        for (let i = 0; i < txs.length; i++) {
          const tx = txs[i];
          doc.rect(40, doc.y, 761.89, 20).fillAndStroke(i % 2 === 0 ? COLORS.rowAlt : COLORS.white, COLORS.borderLight);
          doc
            .fontSize(7.5)
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(formatDateIST(tx.recordedAt), 50, doc.y + 5, { width: 90 })
            .font('Helvetica-Bold')
            .fillColor(tx.type === 'RECEIVED' ? COLORS.primary : tx.type === 'REFUNDED' ? COLORS.accentSuccess : COLORS.accentWarning)
            .text(tx.type, 150, doc.y + 5, { width: 110 })
            .text(formatPdfCurrency(tx.amountPaise), 280, doc.y + 5, { width: 100, align: 'right' })
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(`${tx.method.toUpperCase()} ${tx.reference ? `(${tx.reference})` : ''}`, 410, doc.y + 5, { width: 140 })
            .text(tx.reason || '—', 570, doc.y + 5, { width: 220 });
          doc.y += 20;
        }
      }

      // Notes
      doc.y += 20;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.textDark).text('Notice & Governance Rules:', 40, doc.y);
      doc.y += 4;
      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(
          '1. Security deposits are held in trust and represent refundable liabilities, not operational income.\n' +
            '2. Deductions are documented deposit dispositions for damages or fees and are never automatically merged into Room/Mess ledgers.\n' +
            '3. Deposit balances cannot be used to automatically offset monthly dues without an explicit audited clearance action.\n' +
            '4. This statement is derived authoritatively from MealKhata domain services.',
          40,
          doc.y,
          { width: 760, lineGap: 3 },
        );

      applyFooters(doc, { label: `Lifetime Statement · ${member.displayName}`, isLandscape: true });
      doc.end();
      return doc;
    },

    buildClearancePdf({ stay, clearance }) {
      const isNoDues = clearance.clearanceStatus === CLEARANCE_STATUSES.NO_DUES;
      const isRevoked = clearance.validityStatus === 'REVOKED';

      const doc = new PDFDocument({
        size: 'A4',
        layout: 'portrait',
        margin: 40,
        bufferPages: true,
        info: {
          Title: `MealKhata Hostel Clearance - ${clearance.memberId}`,
          Author: 'MealKhata System',
          Subject: 'Official Hostel Clearance Statement',
        },
      });

      const pageWidth = 595.28;
      const contentWidth = pageWidth - 80;

      // Top Brand Bar
      doc.rect(40, 40, contentWidth, 6).fill(isRevoked ? '#d97706' : (isNoDues ? COLORS.primary : COLORS.accentDanger));

      // Header Banner
      doc.y = 56;
      doc
        .fontSize(18)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text(isRevoked ? 'REVOKED HOSTEL CLEARANCE — HISTORICAL SNAPSHOT' : (isNoDues ? 'MEALKHATA HOSTEL CLEARANCE CERTIFICATE' : 'MEALKHATA DEPARTURE RECORD — DUES REMAIN'), 40, doc.y, {
          align: 'center',
          width: contentWidth,
        });

      doc.y += 6;
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(
          isRevoked
            ? 'This preserved record is no longer a valid resident clearance'
            : isNoDues
            ? 'Official statement of complete financial and room clearance'
            : 'Departure completed with unresolved financial obligations (Super Admin Exception)',
          40,
          doc.y,
          { align: 'center', width: contentWidth },
        );

      doc.y += 18;
      doc.moveTo(40, doc.y).lineTo(pageWidth - 40, doc.y).strokeColor(COLORS.borderLight).lineWidth(1).stroke();
      doc.y += 16;

      // Status Box
      doc.roundedRect(40, doc.y, contentWidth, 48, 4).fillAndStroke(isRevoked ? '#fffbeb' : (isNoDues ? '#ecfdf5' : '#fef2f2'), isRevoked ? '#f59e0b' : (isNoDues ? '#6ee7b7' : '#fca5a5'));
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor(isRevoked ? '#b45309' : (isNoDues ? COLORS.accentSuccess : COLORS.accentDanger))
        .text(isRevoked ? 'REVOKED — NOT A CURRENT CLEARANCE' : (isNoDues ? '✓ NO DUES CERTIFIED' : '⚠ OUTSTANDING DUES REMAIN'), 55, doc.y + 12);
      doc
        .fontSize(8.5)
        .font('Helvetica')
        .fillColor(COLORS.textDark)
        .text(
          isRevoked
            ? `Revoked after resident restoration: "${clearance.revocationReason || 'Resident restoration'}"`
            : isNoDues
            ? 'All meal bills, room fees, shared purchases, and deposit refunds have been fully reconciled.'
            : `Super Admin exception authorized departure: "${clearance.exceptionReason || 'Documented at departure'}"`,
          55,
          doc.y + 28,
        );

      doc.y += 60;

      // Resident & Stay Details
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.textDark).text('Stay & Residency Details', 40, doc.y);
      doc.y += 6;

      const details = [
        ['Resident Member', clearance.memberId.toUpperCase()],
        ['Hostel Admission Date', clearance.joinedOn],
        ['Hostel Departure Date', clearance.actualLeftOn],
        ['Final Room Assigned', clearance.lastRoomId || '—'],
        ['Clearance Sequence', `#${clearance.sequence} (Version ${clearance.snapshotVersion})`],
        ['Validity', isRevoked ? `REVOKED on ${formatDateIST(clearance.revokedAt)}` : (clearance.validityStatus || 'ACTIVE')],
        ['Clearance Finalized On', formatDateIST(clearance.finalizedAt)],
        ['Authorized by Role', clearance.finalizedByRole.toUpperCase()],
      ];

      for (let i = 0; i < details.length; i++) {
        const [label, val] = details[i];
        doc.rect(40, doc.y, contentWidth, 20).fillAndStroke(i % 2 === 0 ? COLORS.rowAlt : COLORS.white, COLORS.borderLight);
        doc
          .fontSize(8)
          .font('Helvetica-Bold')
          .fillColor(COLORS.textDark)
          .text(label, 50, doc.y + 5, { width: 200 })
          .font('Helvetica')
          .fillColor(COLORS.textMuted)
          .text(val, 260, doc.y + 5, { width: 280, align: 'right' });
        doc.y += 20;
      }

      doc.y += 18;

      // Financial Snapshot at Clearance
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.textDark).text('Financial Position as of Finalization', 40, doc.y);
      doc.y += 6;

      const finRows = [
        ['Hostel Mess Dues', formatPdfCurrency(clearance.messSummary?.remainingPaise || 0)],
        ['Monthly Room Fee Dues', formatPdfCurrency(clearance.roomFeeSummary?.remainingPaise || 0)],
        ['Shared Expense Reimbursements Owed', formatPdfCurrency(clearance.expenseSummary?.owedToOthersPaise || 0)],
        ['Deposit Remaining Held', formatPdfCurrency(clearance.depositSummary?.heldPaise || 0)],
      ];

      for (let i = 0; i < finRows.length; i++) {
        const [label, val] = finRows[i];
        doc.rect(40, doc.y, contentWidth, 20).fillAndStroke(i % 2 === 0 ? COLORS.rowAlt : COLORS.white, COLORS.borderLight);
        doc
          .fontSize(8)
          .font('Helvetica-Bold')
          .fillColor(COLORS.textDark)
          .text(label, 50, doc.y + 5, { width: 280 })
          .font('Helvetica')
          .fillColor(COLORS.textMuted)
          .text(val, 340, doc.y + 5, { width: 200, align: 'right' });
        doc.y += 20;
      }

      // If outstanding obligations exist, list them
      if (clearance.outstandingObligations && clearance.outstandingObligations.length > 0) {
        doc.y += 14;
        doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.accentDanger).text('Itemized Unsettled Obligations:', 40, doc.y);
        doc.y += 4;

        for (const obl of clearance.outstandingObligations) {
          doc.rect(40, doc.y, contentWidth, 18).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
          doc
            .fontSize(7.5)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text(obl.title, 50, doc.y + 4, { width: 340 })
            .font('Helvetica')
            .fillColor(COLORS.accentDanger)
            .text(formatPdfCurrency(obl.amountPaise), 400, doc.y + 4, { width: 140, align: 'right' });
          doc.y += 18;
        }
      }

      // Footer notice
      doc.y += 24;
      doc.rect(40, doc.y, contentWidth, 50).fillAndStroke(COLORS.rowAlt, COLORS.borderLight);
      doc
        .fontSize(7.5)
        .font('Helvetica-Bold')
        .fillColor(COLORS.textDark)
        .text('Official Internal Statement Notice:', 50, doc.y + 8);
      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor(COLORS.textMuted)
        .text(
          'This document constitutes an internal electronic financial record generated by MealKhata 2.0. ' +
            'It serves to confirm the recorded clearance status as of the indicated finalization timestamp. ' +
            'MealKhata does not generate external legal certifications or institutional seals.',
          50,
          doc.y + 22,
          { width: contentWidth - 20, lineGap: 2 },
        );

      applyFooters(doc, { label: `Hostel Clearance · ${clearance.memberId}`, isLandscape: false });
      doc.end();
      return doc;
    },

    async generateClearancePdf(stayId, clearanceId) {
      const clearance = await repository.findClearanceById(clearanceId);
      if (!clearance || clearance.stayId !== stayId) {
        throw new Error('Hostel clearance record not found');
      }

      const stay = await repository.findStayById(stayId);
      return this.buildClearancePdf({ stay, clearance });
    },
  };
}

export const lifetimePdfService = createLifetimePdfService();
