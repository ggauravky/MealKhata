import PDFDocument from 'pdfkit';
import { monthlyReportExportService, formatPdfPlateFraction, formatPdfRupees } from './monthlyReportExport.service.js';

const PAGE_WIDTH = 841.89; // A4 Landscape width
const MARGIN = 40;
const BOTTOM_LIMIT = 540;

const COLORS = {
  primary: '#0f766e', // Teal
  primaryLight: '#ccfbf1',
  textDark: '#0f172a',
  textMuted: '#64748b',
  textSubtle: '#94a3b8',
  border: '#cbd5e1',
  borderLight: '#e2e8f0',
  rowAlt: '#f8fafc',
  white: '#ffffff',
  headerBg: '#0f766e',
  headerText: '#ffffff',
  morningAccent: '#d97706',
  morningBg: '#fef3c7',
  nightAccent: '#4f46e5',
  nightBg: '#e0e7ff',
  success: '#059669',
  successBg: '#ecfdf5',
  warning: '#ea580c',
  warningBg: '#fff7ed',
  slateBg: '#f1f5f9',
};

function drawStatusPill(doc, text, x, y, options = {}) {
  const width = options.width ?? 110;
  const height = options.height ?? 16;
  const bg = options.bg ?? COLORS.slateBg;
  const color = options.color ?? COLORS.textDark;

  doc.rect(x, y, width, height).fill(bg);
  doc
    .fontSize(7.5)
    .font('Helvetica-Bold')
    .fillColor(color)
    .text(text, x, y + 4, { width, align: 'center' });
}

function drawPageFooter(doc, data, pageNumber, totalPages) {
  doc
    .fontSize(7)
    .font('Helvetica')
    .fillColor(COLORS.textSubtle)
    .text(`MealKhata · ${data.monthLabel}`, MARGIN, 565, { align: 'left', width: 250 });

  doc
    .fontSize(7)
    .font('Helvetica')
    .fillColor(COLORS.textSubtle)
    .text(`Generated ${data.generatedAtFormatted} IST · Timezone: ${data.timezone}`, 250, 565, {
      align: 'center',
      width: 260,
    });

  doc
    .fontSize(7)
    .font('Helvetica')
    .fillColor(COLORS.textSubtle)
    .text(`Page ${pageNumber} of ${totalPages}`, 510, 565, { align: 'right', width: 250 });
}

function checkPageSpace(doc, requiredHeight, onNewPage) {
  if (doc.y + requiredHeight > BOTTOM_LIMIT) {
    doc.addPage();
    if (onNewPage) {
      onNewPage();
    }
    return true;
  }
  return false;
}

export function createMonthlyReportPdfService({ exportService = monthlyReportExportService } = {}) {
  return Object.freeze({
    async generateMonthlyReportPdf(month) {
      const data = await exportService.buildMonthlyReportExport(month);

      return new Promise((resolve, reject) => {
        try {
          const doc = new PDFDocument({
            size: 'A4',
            layout: 'landscape',
            margin: MARGIN,
            bufferPages: true,
            info: {
              Title: `MealKhata Monthly Report - ${data.monthLabel}`,
              Author: 'MealKhata',
              Subject: 'Monthly meal, plate allocation, billing and payment report',
              Creator: 'MealKhata',
            },
          });

          const buffers = [];
          doc.on('data', (chunk) => buffers.push(chunk));
          doc.on('end', () => resolve(Buffer.concat(buffers)));
          doc.on('error', (err) => reject(err));

          // -------------------------------------------------------------
          // PAGE 1: Brand Header, Executive Summary & Member Summary Table
          // -------------------------------------------------------------

          // Brand Wordmark & Header
          doc
            .fontSize(20)
            .font('Helvetica-Bold')
            .fillColor(COLORS.primary)
            .text('MealKhata', MARGIN, MARGIN);

          doc
            .fontSize(9)
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text('Meals tracked. Bills sorted.', MARGIN + 115, MARGIN + 9);

          // Report Title & Status Badge
          const titleY = MARGIN + 28;
          doc
            .fontSize(14)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text(`Monthly Meal & Billing Report — ${data.monthLabel}`, MARGIN, titleY);

          // Status Badge Pill
          let badgeBg = COLORS.slateBg;
          let badgeColor = COLORS.textDark;
          if (data.reportState === 'closed') {
            badgeBg = COLORS.successBg;
            badgeColor = COLORS.success;
          } else if (data.reportState === 'current') {
            badgeBg = '#e0f2fe';
            badgeColor = '#0369a1';
          } else if (data.reportState === 'future_schedule') {
            badgeBg = '#f3e8ff';
            badgeColor = '#7e22ce';
          }

          drawStatusPill(doc, data.statusBadgeText, PAGE_WIDTH - MARGIN - 170, titleY - 2, {
            width: 170,
            height: 18,
            bg: badgeBg,
            color: badgeColor,
          });

          // Metadata Grid (4 columns)
          const metaY = titleY + 22;
          doc.rect(MARGIN, metaY, 760, 42).fill('#f8fafc');
          doc.rect(MARGIN, metaY, 760, 42).stroke(COLORS.borderLight);

          // Col 1: Scope & Dates
          doc
            .fontSize(8)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text('Reporting Scope', MARGIN + 10, metaY + 7)
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(data.reportingPeriod, MARGIN + 10, metaY + 18)
            .text(`Today: ${data.today}`, MARGIN + 10, metaY + 29);

          // Col 2: Generation Info
          doc
            .fontSize(8)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text('Report Details', MARGIN + 220, metaY + 7)
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(`Generated: ${data.generatedAtFormatted}`, MARGIN + 220, metaY + 18)
            .text(`Timezone: ${data.timezone}`, MARGIN + 220, metaY + 29);

          // Col 3: Approved Meal Prices
          doc
            .fontSize(8)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text(data.prices.isFrozen ? 'Frozen Meal Rates' : 'Standard Meal Rates', MARGIN + 420, metaY + 7)
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(`Morning: ${formatPdfRupees(data.prices.morningPricePaise)} / plate`, MARGIN + 420, metaY + 18)
            .text(`Night: ${formatPdfRupees(data.prices.nightPricePaise)} / plate`, MARGIN + 420, metaY + 29);

          // Col 4: Settlement Record (if applicable)
          const isClosed = data.settlement.isClosed;
          doc
            .fontSize(8)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text('Accounting Settlement', MARGIN + 590, metaY + 7)
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(
              isClosed ? `Settlement: #${data.settlement.sequence} (${data.settlement.settlementId})` : 'Settlement: Open (Unfrozen)',
              MARGIN + 590,
              metaY + 18,
              { width: 160 },
            )
            .text(isClosed ? `Closed: ${data.settlement.closedAt}` : 'Balances subject to update', MARGIN + 590, metaY + 29, { width: 160 });

          // Executive Overview Metric Cards (5 Cards across 760 pt -> ~144 pt each, gap 10 pt)
          const cardsY = metaY + 50;
          const cardWidth = 144;
          const cardHeight = 44;
          const cardGap = 10;

          const metrics = [
            {
              label: 'RECORDED DAYS',
              value: `${data.summary.recordedDayCount} days`,
              sub: data.periodType === 'current' ? 'Through today' : 'In calendar month',
            },
            {
              label: 'MORNING PLATES',
              value: `${data.summary.morningPhysicalPlates} plates`,
              sub: formatPdfRupees(data.summary.morningAmountPaise),
            },
            {
              label: 'NIGHT PLATES',
              value: `${data.summary.nightPhysicalPlates} plates`,
              sub: formatPdfRupees(data.summary.nightAmountPaise),
            },
            {
              label: 'TOTAL PHYSICAL PLATES',
              value: `${data.summary.totalPhysicalPlates} plates`,
              sub: `${data.summary.morningPhysicalPlates} M + ${data.summary.nightPhysicalPlates} N`,
            },
            {
              label: 'ROOM MEAL COST',
              value: formatPdfRupees(data.summary.roomAmountPaise),
              sub: data.summary.paidAmountPaise > 0 ? `Paid: ${formatPdfRupees(data.summary.paidAmountPaise)}` : 'Exact integer paise',
            },
          ];

          metrics.forEach((metric, index) => {
            const cx = MARGIN + index * (cardWidth + cardGap);
            doc.rect(cx, cardsY, cardWidth, cardHeight).fill(COLORS.rowAlt);
            doc.rect(cx, cardsY, cardWidth, cardHeight).stroke(COLORS.borderLight);

            doc
              .fontSize(6.5)
              .font('Helvetica-Bold')
              .fillColor(COLORS.textMuted)
              .text(metric.label, cx + 8, cardsY + 6, { width: cardWidth - 16 });

            doc
              .fontSize(12)
              .font('Helvetica-Bold')
              .fillColor(COLORS.primary)
              .text(metric.value, cx + 8, cardsY + 16, { width: cardWidth - 16 });

            doc
              .fontSize(7)
              .font('Helvetica')
              .fillColor(COLORS.textMuted)
              .text(metric.sub, cx + 8, cardsY + 31, { width: cardWidth - 16 });
          });

          // Section Title: Member Summary Table
          const tableSectionY = cardsY + cardHeight + 14;
          doc
            .fontSize(10.5)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text('Member Meal & Billing Summary', MARGIN, tableSectionY);

          doc
            .fontSize(7.5)
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(
              'Individual participation, plate shares, allocated meal costs, recorded payments, and outstanding balances.',
              MARGIN,
              tableSectionY + 13,
            );

          // Empty Month Callout if no meals
          const isEmptyMonth = data.summary.recordedDayCount === 0 && !data.summary.hasRecordedMeals;
          if (isEmptyMonth) {
            const emptyY = tableSectionY + 28;
            doc.rect(MARGIN, emptyY, 760, 36).fill('#f8fafc');
            doc.rect(MARGIN, emptyY, 760, 36).stroke(COLORS.border);

            doc
              .fontSize(9)
              .font('Helvetica-Bold')
              .fillColor(COLORS.textDark)
              .text('No meal activity was recorded for this month.', MARGIN + 14, emptyY + 8);

            doc
              .fontSize(8)
              .font('Helvetica')
              .fillColor(COLORS.textMuted)
              .text(
                'Zero physical plates were ordered, zero meals were logged, and no household meal charges apply.',
                MARGIN + 14,
                emptyY + 20,
              );
          }

          // Table Header (Member Summary)
          // Widths: 85 + 50 + 55 + 65 + 50 + 55 + 65 + 60 + 85 + 80 + 75 + 35 = 760 pt
          const colWidths = [85, 50, 55, 65, 50, 55, 65, 60, 85, 80, 75, 35];
          const colX = [MARGIN];
          for (let i = 0; i < colWidths.length - 1; i++) {
            colX.push(colX[i] + colWidths[i]);
          }

          const thY = isEmptyMonth ? tableSectionY + 70 : tableSectionY + 28;
          doc.rect(MARGIN, thY, 760, 22).fill(COLORS.headerBg);

          doc
            .fontSize(7.5)
            .font('Helvetica-Bold')
            .fillColor(COLORS.headerText)
            .text('Member', colX[0] + 6, thY + 6, { width: colWidths[0] - 10, align: 'left' })
            .text('M. Joined', colX[1], thY + 6, { width: colWidths[1] - 6, align: 'right' })
            .text('M. Share', colX[2], thY + 6, { width: colWidths[2] - 6, align: 'right' })
            .text('M. Cost', colX[3], thY + 6, { width: colWidths[3] - 6, align: 'right' })
            .text('N. Joined', colX[4], thY + 6, { width: colWidths[4] - 6, align: 'right' })
            .text('N. Share', colX[5], thY + 6, { width: colWidths[5] - 6, align: 'right' })
            .text('N. Cost', colX[6], thY + 6, { width: colWidths[6] - 6, align: 'right' })
            .text('Total Plt', colX[7], thY + 6, { width: colWidths[7] - 6, align: 'right' })
            .text('Bill Amount', colX[8], thY + 6, { width: colWidths[8] - 6, align: 'right' })
            .text('Total Paid', colX[9], thY + 6, { width: colWidths[9] - 6, align: 'right' })
            .text('Remaining', colX[10], thY + 6, { width: colWidths[10] - 6, align: 'right' })
            .text('Status', colX[11], thY + 6, { width: colWidths[11] - 4, align: 'center' });

          let currentY = thY + 22;
          const memberIds = ['gaurav', 'nikhil', 'devansh'];

          memberIds.forEach((id, idx) => {
            const m = data.members[id];
            const isAlt = idx % 2 === 1;
            const rowHeight = 22;

            if (isAlt) {
              doc.rect(MARGIN, currentY, 760, rowHeight).fill(COLORS.rowAlt);
            }
            doc.strokeColor(COLORS.borderLight).lineWidth(0.5).moveTo(MARGIN, currentY + rowHeight).lineTo(PAGE_WIDTH - MARGIN, currentY + rowHeight).stroke();

            const statusText = m.status === 'no_due'
              ? 'No due'
              : m.status === 'paid'
              ? 'Paid'
              : m.status === 'partial'
              ? 'Partial'
              : m.status === 'overpaid'
              ? 'Overpaid'
              : m.status === 'not_due_yet'
              ? 'Schedule'
              : 'Due';

            doc
              .fontSize(8)
              .font('Helvetica-Bold')
              .fillColor(COLORS.textDark)
              .text(m.memberName, colX[0] + 6, currentY + 6, { width: colWidths[0] - 10, align: 'left' });

            doc
              .fontSize(8)
              .font('Helvetica')
              .fillColor(COLORS.textDark)
              .text(String(m.morningParticipationCount), colX[1], currentY + 6, { width: colWidths[1] - 6, align: 'right' })
              .text(formatPdfPlateFraction(m.morningShareUnits), colX[2], currentY + 6, { width: colWidths[2] - 6, align: 'right' })
              .text(formatPdfRupees(m.morningAmountPaise), colX[3], currentY + 6, { width: colWidths[3] - 6, align: 'right' })
              .text(String(m.nightParticipationCount), colX[4], currentY + 6, { width: colWidths[4] - 6, align: 'right' })
              .text(formatPdfPlateFraction(m.nightShareUnits), colX[5], currentY + 6, { width: colWidths[5] - 6, align: 'right' })
              .text(formatPdfRupees(m.nightAmountPaise), colX[6], currentY + 6, { width: colWidths[6] - 6, align: 'right' })
              .text(formatPdfPlateFraction(m.totalShareUnits), colX[7], currentY + 6, { width: colWidths[7] - 6, align: 'right' })
              .font('Helvetica-Bold')
              .text(formatPdfRupees(m.billAmountPaise), colX[8], currentY + 6, { width: colWidths[8] - 6, align: 'right' })
              .font('Helvetica')
              .text(formatPdfRupees(m.paidAmountPaise), colX[9], currentY + 6, { width: colWidths[9] - 6, align: 'right' })
              .font(m.remainingAmountPaise > 0 ? 'Helvetica-Bold' : 'Helvetica')
              .fillColor(m.remainingAmountPaise > 0 ? COLORS.warning : COLORS.textDark)
              .text(
                m.overpaidAmountPaise > 0
                  ? `+${formatPdfRupees(m.overpaidAmountPaise)}`
                  : formatPdfRupees(m.remainingAmountPaise),
                colX[10],
                currentY + 6,
                { width: colWidths[10] - 6, align: 'right' },
              );

            doc
              .fontSize(7)
              .font('Helvetica')
              .fillColor(m.status === 'paid' ? COLORS.success : (m.remainingAmountPaise > 0 ? COLORS.warning : COLORS.textMuted))
              .text(statusText, colX[11], currentY + 6, { width: colWidths[11] - 4, align: 'center' });

            currentY += rowHeight;
          });

          // Household Total Row
          const totalRowHeight = 24;
          doc.rect(MARGIN, currentY, 760, totalRowHeight).fill(COLORS.slateBg);
          doc.strokeColor(COLORS.border).lineWidth(0.8).moveTo(MARGIN, currentY + totalRowHeight).lineTo(PAGE_WIDTH - MARGIN, currentY + totalRowHeight).stroke();

          doc
            .fontSize(8)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text('HOUSEHOLD TOTAL', colX[0] + 6, currentY + 7, { width: colWidths[0] - 10, align: 'left' })
            .text('—', colX[1], currentY + 7, { width: colWidths[1] - 6, align: 'right' })
            .text(`${data.summary.morningPhysicalPlates}`, colX[2], currentY + 7, { width: colWidths[2] - 6, align: 'right' })
            .text(formatPdfRupees(data.summary.morningAmountPaise), colX[3], currentY + 7, { width: colWidths[3] - 6, align: 'right' })
            .text('—', colX[4], currentY + 7, { width: colWidths[4] - 6, align: 'right' })
            .text(`${data.summary.nightPhysicalPlates}`, colX[5], currentY + 7, { width: colWidths[5] - 6, align: 'right' })
            .text(formatPdfRupees(data.summary.nightAmountPaise), colX[6], currentY + 7, { width: colWidths[6] - 6, align: 'right' })
            .text(`${data.summary.totalPhysicalPlates}`, colX[7], currentY + 7, { width: colWidths[7] - 6, align: 'right' })
            .text(formatPdfRupees(data.summary.roomAmountPaise), colX[8], currentY + 7, { width: colWidths[8] - 6, align: 'right' })
            .text(formatPdfRupees(data.summary.paidAmountPaise), colX[9], currentY + 7, { width: colWidths[9] - 6, align: 'right' })
            .fillColor(data.summary.remainingAmountPaise > 0 ? COLORS.warning : COLORS.textDark)
            .text(
              data.summary.overpaidAmountPaise > 0
                ? `+${formatPdfRupees(data.summary.overpaidAmountPaise)}`
                : formatPdfRupees(data.summary.remainingAmountPaise),
              colX[10],
              currentY + 7,
              { width: colWidths[10] - 6, align: 'right' },
            )
            .fillColor(COLORS.textMuted)
            .text('—', colX[11], currentY + 7, { width: colWidths[11] - 4, align: 'center' });

          currentY += totalRowHeight + 16;

          // Notes & Legend at the bottom of Page 1 (for Empty month or summary reference)
          if (isEmptyMonth) {
            doc.y = currentY;
            doc
              .fontSize(8)
              .font('Helvetica-Bold')
              .fillColor(COLORS.primary)
              .text('Accounting Notes & Verification');

            doc
              .fontSize(7.5)
              .font('Helvetica')
              .fillColor(COLORS.textMuted)
              .text(
                '• Status values: Taking (member explicitly joined), Skip (explicitly skipped), Not set (no meal choice recorded).\n' +
                '• All calculations strictly use exact integer paise. Shared meals distribute physical plate costs deterministically.\n' +
                '• This report was authoritative at generation time and reflects exact recorded MealKhata state.',
                MARGIN,
                doc.y + 4,
                { width: 760, lineGap: 3 },
              );

            // Finish PDF early for empty month (Single page report)
            const bufferedPages = doc.bufferedPageRange();
            for (let i = bufferedPages.start; i < bufferedPages.start + bufferedPages.count; i++) {
              doc.switchToPage(i);
              drawPageFooter(doc, data, i + 1, bufferedPages.count);
            }
            doc.end();
            return;
          }

          // -------------------------------------------------------------
          // PAGE 2: Daily Household Summary
          // -------------------------------------------------------------
          doc.addPage();

          function drawDailyHouseholdHeader() {
            doc
              .fontSize(12)
              .font('Helvetica-Bold')
              .fillColor(COLORS.textDark)
              .text('Daily Household Meal & Plate Summary', MARGIN, MARGIN);

            doc
              .fontSize(8)
              .font('Helvetica')
              .fillColor(COLORS.textMuted)
              .text(
                `Calendar date-wise physical plate counts, eating participants, and room expenses for ${data.monthLabel}.`,
                MARGIN,
                MARGIN + 15,
              );

            // Table header
            // Widths: Date (75) | Day (45) | M. Eaters (65) | M. Plates (75) | M. Cost (85) | N. Eaters (65) | N. Plates (75) | N. Cost (85) | Daily Total (95) | Activity (95) = 760 pt
            const dhWidths = [75, 45, 65, 75, 85, 65, 75, 85, 95, 95];
            const dhX = [MARGIN];
            for (let i = 0; i < dhWidths.length - 1; i++) {
              dhX.push(dhX[i] + dhWidths[i]);
            }

            const y = MARGIN + 28;
            doc.rect(MARGIN, y, 760, 20).fill(COLORS.headerBg);

            doc
              .fontSize(7.5)
              .font('Helvetica-Bold')
              .fillColor(COLORS.headerText)
              .text('Date', dhX[0] + 6, y + 5, { width: dhWidths[0] - 10, align: 'left' })
              .text('Day', dhX[1], y + 5, { width: dhWidths[1] - 6, align: 'left' })
              .text('M. Eaters', dhX[2], y + 5, { width: dhWidths[2] - 6, align: 'right' })
              .text('M. Plates', dhX[3], y + 5, { width: dhWidths[3] - 6, align: 'right' })
              .text('M. Cost', dhX[4], y + 5, { width: dhWidths[4] - 6, align: 'right' })
              .text('N. Eaters', dhX[5], y + 5, { width: dhWidths[5] - 6, align: 'right' })
              .text('N. Plates', dhX[6], y + 5, { width: dhWidths[6] - 6, align: 'right' })
              .text('N. Cost', dhX[7], y + 5, { width: dhWidths[7] - 6, align: 'right' })
              .text('Daily Room Total', dhX[8], y + 5, { width: dhWidths[8] - 6, align: 'right' })
              .text('Activity Status', dhX[9], y + 5, { width: dhWidths[9] - 6, align: 'center' });

            doc.y = y + 20;
          }

          drawDailyHouseholdHeader();

          const dhWidths = [75, 45, 65, 75, 85, 65, 75, 85, 95, 95];
          const dhX = [MARGIN];
          for (let i = 0; i < dhWidths.length - 1; i++) {
            dhX.push(dhX[i] + dhWidths[i]);
          }

          data.days.forEach((day, index) => {
            const rowHeight = 14.5;
            checkPageSpace(doc, rowHeight + 2, drawDailyHouseholdHeader);

            const isAlt = index % 2 === 1;
            const y = doc.y;

            if (isAlt) {
              doc.rect(MARGIN, y, 760, rowHeight).fill(COLORS.rowAlt);
            }
            doc.strokeColor(COLORS.borderLight).lineWidth(0.4).moveTo(MARGIN, y + rowHeight).lineTo(PAGE_WIDTH - MARGIN, y + rowHeight).stroke();

            const activityLabel = !day.saved
              ? 'No entry'
              : day.morning.physicalPlates === 0 && day.night.physicalPlates === 0
              ? 'All skipped'
              : 'Recorded';

            doc
              .fontSize(7.5)
              .font(day.saved ? 'Helvetica-Bold' : 'Helvetica')
              .fillColor(day.saved ? COLORS.textDark : COLORS.textMuted)
              .text(day.compactDate, dhX[0] + 6, y + 3, { width: dhWidths[0] - 10, align: 'left' })
              .font('Helvetica')
              .fillColor(COLORS.textMuted)
              .text(day.weekday, dhX[1], y + 3, { width: dhWidths[1] - 6, align: 'left' })
              .fillColor(day.morning.eaters > 0 ? COLORS.textDark : COLORS.textMuted)
              .text(day.morning.eaters > 0 ? String(day.morning.eaters) : '—', dhX[2], y + 3, { width: dhWidths[2] - 6, align: 'right' })
              .text(day.morning.physicalPlates > 0 ? String(day.morning.physicalPlates) : '—', dhX[3], y + 3, { width: dhWidths[3] - 6, align: 'right' })
              .text(formatPdfRupees(day.morning.amountPaise), dhX[4], y + 3, { width: dhWidths[4] - 6, align: 'right' })
              .fillColor(day.night.eaters > 0 ? COLORS.textDark : COLORS.textMuted)
              .text(day.night.eaters > 0 ? String(day.night.eaters) : '—', dhX[5], y + 3, { width: dhWidths[5] - 6, align: 'right' })
              .text(day.night.physicalPlates > 0 ? String(day.night.physicalPlates) : '—', dhX[6], y + 3, { width: dhWidths[6] - 6, align: 'right' })
              .text(formatPdfRupees(day.night.amountPaise), dhX[7], y + 3, { width: dhWidths[7] - 6, align: 'right' })
              .font(day.dailyTotalPaise > 0 ? 'Helvetica-Bold' : 'Helvetica')
              .fillColor(day.dailyTotalPaise > 0 ? COLORS.primary : COLORS.textMuted)
              .text(formatPdfRupees(day.dailyTotalPaise), dhX[8], y + 3, { width: dhWidths[8] - 6, align: 'right' })
              .fontSize(6.5)
              .font('Helvetica')
              .fillColor(activityLabel === 'Recorded' ? COLORS.primary : COLORS.textMuted)
              .text(activityLabel, dhX[9], y + 4, { width: dhWidths[9] - 6, align: 'center' });

            doc.y = y + rowHeight;
          });

          // Daily summary table totals row
          const dhTotalY = doc.y;
          doc.rect(MARGIN, dhTotalY, 760, 18).fill(COLORS.slateBg);
          doc.strokeColor(COLORS.border).lineWidth(0.8).moveTo(MARGIN, dhTotalY + 18).lineTo(PAGE_WIDTH - MARGIN, dhTotalY + 18).stroke();

          doc
            .fontSize(7.5)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text('MONTH TO DATE TOTALS', dhX[0] + 6, dhTotalY + 4, { width: dhWidths[0] + dhWidths[1] - 10, align: 'left' })
            .text('—', dhX[2], dhTotalY + 4, { width: dhWidths[2] - 6, align: 'right' })
            .text(String(data.summary.morningPhysicalPlates), dhX[3], dhTotalY + 4, { width: dhWidths[3] - 6, align: 'right' })
            .text(formatPdfRupees(data.summary.morningAmountPaise), dhX[4], dhTotalY + 4, { width: dhWidths[4] - 6, align: 'right' })
            .text('—', dhX[5], dhTotalY + 4, { width: dhWidths[5] - 6, align: 'right' })
            .text(String(data.summary.nightPhysicalPlates), dhX[6], dhTotalY + 4, { width: dhWidths[6] - 6, align: 'right' })
            .text(formatPdfRupees(data.summary.nightAmountPaise), dhX[7], dhTotalY + 4, { width: dhWidths[7] - 6, align: 'right' })
            .text(formatPdfRupees(data.summary.roomAmountPaise), dhX[8], dhTotalY + 4, { width: dhWidths[8] - 6, align: 'right' })
            .text('—', dhX[9], dhTotalY + 4, { width: dhWidths[9] - 6, align: 'center' });

          // -------------------------------------------------------------
          // PAGE 3+: Detailed Member Daily Meal Ledger
          // -------------------------------------------------------------
          doc.addPage();

          function drawDetailedLedgerHeader() {
            doc
              .fontSize(12)
              .font('Helvetica-Bold')
              .fillColor(COLORS.textDark)
              .text('Detailed Member Daily Meal Ledger', MARGIN, MARGIN);

            doc
              .fontSize(8)
              .font('Helvetica')
              .fillColor(COLORS.textMuted)
              .text(
                'Individual daily meal status, plate share fractions, and exact integer-paise allocated costs for all active dates.',
                MARGIN,
                MARGIN + 15,
              );

            // Table header
            // Widths: Date (65) | Day (35) | Member (75) | M. Status (65) | M. Share (55) | M. Cost (75) | N. Status (65) | N. Share (55) | N. Cost (75) | Member Daily (95) | Notes (100) = 760 pt
            const dlWidths = [65, 35, 75, 65, 55, 75, 65, 55, 75, 95, 100];
            const dlX = [MARGIN];
            for (let i = 0; i < dlWidths.length - 1; i++) {
              dlX.push(dlX[i] + dlWidths[i]);
            }

            const y = MARGIN + 28;
            doc.rect(MARGIN, y, 760, 20).fill(COLORS.headerBg);

            doc
              .fontSize(7.5)
              .font('Helvetica-Bold')
              .fillColor(COLORS.headerText)
              .text('Date', dlX[0] + 6, y + 5, { width: dlWidths[0] - 10, align: 'left' })
              .text('Day', dlX[1], y + 5, { width: dlWidths[1] - 4, align: 'left' })
              .text('Member', dlX[2], y + 5, { width: dlWidths[2] - 6, align: 'left' })
              .text('M. Status', dlX[3], y + 5, { width: dlWidths[3] - 6, align: 'left' })
              .text('M. Share', dlX[4], y + 5, { width: dlWidths[4] - 6, align: 'right' })
              .text('M. Cost', dlX[5], y + 5, { width: dlWidths[5] - 6, align: 'right' })
              .text('N. Status', dlX[6], y + 5, { width: dlWidths[6] - 6, align: 'left' })
              .text('N. Share', dlX[7], y + 5, { width: dlWidths[7] - 6, align: 'right' })
              .text('N. Cost', dlX[8], y + 5, { width: dlWidths[8] - 6, align: 'right' })
              .text('Daily Member Total', dlX[9], y + 5, { width: dlWidths[9] - 6, align: 'right' })
              .text('Allocation Details', dlX[10], y + 5, { width: dlWidths[10] - 6, align: 'left' });

            doc.y = y + 20;
          }

          drawDetailedLedgerHeader();

          const dlWidths = [65, 35, 75, 65, 55, 75, 65, 55, 75, 95, 100];
          const dlX = [MARGIN];
          for (let i = 0; i < dlWidths.length - 1; i++) {
            dlX.push(dlX[i] + dlWidths[i]);
          }

          const activeLedgerDays = data.recordedActivityDays;

          if (activeLedgerDays.length === 0) {
            const noActY = doc.y + 10;
            doc.rect(MARGIN, noActY, 760, 30).fill(COLORS.rowAlt);
            doc.rect(MARGIN, noActY, 760, 30).stroke(COLORS.border);
            doc
              .fontSize(8.5)
              .font('Helvetica-Bold')
              .fillColor(COLORS.textMuted)
              .text('No recorded meal activity exists in this period.', MARGIN + 14, noActY + 10);
            doc.y = noActY + 40;
          } else {
            activeLedgerDays.forEach((day) => {
              // Required height for 3 members + 1 subtotal row = 3 * 15 + 16 = 61 pt
              const dateBlockHeight = 62;
              checkPageSpace(doc, dateBlockHeight, drawDetailedLedgerHeader);

              memberIds.forEach((id, mIndex) => {
                const mData = day.members[id];
                const rowY = doc.y;
                const rowHeight = 15;

                const isAlt = mIndex % 2 === 1;
                if (isAlt) {
                  doc.rect(MARGIN, rowY, 760, rowHeight).fill(COLORS.rowAlt);
                }
                doc.strokeColor(COLORS.borderLight).lineWidth(0.3).moveTo(MARGIN, rowY + rowHeight).lineTo(PAGE_WIDTH - MARGIN, rowY + rowHeight).stroke();

                // Show date and day only on the first member row of the date
                if (mIndex === 0) {
                  doc
                    .fontSize(7.5)
                    .font('Helvetica-Bold')
                    .fillColor(COLORS.textDark)
                    .text(day.compactDate, dlX[0] + 6, rowY + 3.5, { width: dlWidths[0] - 10, align: 'left' })
                    .font('Helvetica')
                    .fillColor(COLORS.textMuted)
                    .text(day.weekday, dlX[1], rowY + 3.5, { width: dlWidths[1] - 4, align: 'left' });
                }

                doc
                  .fontSize(7.5)
                  .font('Helvetica')
                  .fillColor(COLORS.textDark)
                  .text(mData.memberName, dlX[2], rowY + 3.5, { width: dlWidths[2] - 6, align: 'left' });

                // Morning Status & Share
                doc
                  .fillColor(mData.morning.status === 'Taking' ? COLORS.primary : COLORS.textMuted)
                  .text(mData.morning.status, dlX[3], rowY + 3.5, { width: dlWidths[3] - 6, align: 'left' })
                  .text(mData.morning.shareUnits > 0 ? formatPdfPlateFraction(mData.morning.shareUnits) : '—', dlX[4], rowY + 3.5, { width: dlWidths[4] - 6, align: 'right' })
                  .text(formatPdfRupees(mData.morning.amountPaise), dlX[5], rowY + 3.5, { width: dlWidths[5] - 6, align: 'right' });

                // Night Status & Share
                doc
                  .fillColor(mData.night.status === 'Taking' ? COLORS.primary : COLORS.textMuted)
                  .text(mData.night.status, dlX[6], rowY + 3.5, { width: dlWidths[6] - 6, align: 'left' })
                  .text(mData.night.shareUnits > 0 ? formatPdfPlateFraction(mData.night.shareUnits) : '—', dlX[7], rowY + 3.5, { width: dlWidths[7] - 6, align: 'right' })
                  .text(formatPdfRupees(mData.night.amountPaise), dlX[8], rowY + 3.5, { width: dlWidths[8] - 6, align: 'right' });

                // Member Daily Total
                doc
                  .font(mData.dailyTotalPaise > 0 ? 'Helvetica-Bold' : 'Helvetica')
                  .fillColor(mData.dailyTotalPaise > 0 ? COLORS.textDark : COLORS.textMuted)
                  .text(formatPdfRupees(mData.dailyTotalPaise), dlX[9], rowY + 3.5, { width: dlWidths[9] - 6, align: 'right' });

                // Allocation Notes (e.g. Shared / Standard)
                let note = '—';
                const mShare = mData.morning.shareUnits;
                const nShare = mData.night.shareUnits;
                if ((mShare > 0 && mShare < 6) || (nShare > 0 && nShare < 6)) {
                  note = 'Custom split allocation';
                } else if (mShare === 6 && nShare === 6) {
                  note = '2 full individual plates';
                } else if (mShare === 6 || nShare === 6) {
                  note = '1 full individual plate';
                }

                doc
                  .fontSize(6.5)
                  .font('Helvetica')
                  .fillColor(COLORS.textMuted)
                  .text(note, dlX[10], rowY + 4, { width: dlWidths[10] - 6, align: 'left' });

                doc.y = rowY + rowHeight;
              });

              // Subtotal bar for the date
              const subY = doc.y;
              doc.rect(MARGIN, subY, 760, 16).fill('#f1f5f9');
              doc.strokeColor(COLORS.border).lineWidth(0.5).moveTo(MARGIN, subY + 16).lineTo(PAGE_WIDTH - MARGIN, subY + 16).stroke();

              doc
                .fontSize(7)
                .font('Helvetica-Bold')
                .fillColor(COLORS.textDark)
                .text(
                  `${day.displayDate} Room Subtotal: Morning ${day.morning.physicalPlates} plt (${formatPdfRupees(day.morning.amountPaise)})  +  Night ${day.night.physicalPlates} plt (${formatPdfRupees(day.night.amountPaise)})`,
                  dlX[0] + 6,
                  subY + 4,
                  { width: 500, align: 'left' },
                )
                .text(`Daily Room Total: ${formatPdfRupees(day.dailyTotalPaise)}`, dlX[8], subY + 4, { width: dlWidths[8] + dlWidths[9] - 6, align: 'right' });

              doc.y = subY + 18;
            });
          }

          // -------------------------------------------------------------
          // UPCOMING SCHEDULED MEALS (If any future explicit schedule)
          // -------------------------------------------------------------
          if (data.scheduledFutureDays.length > 0) {
            checkPageSpace(doc, 100, () => {});

            doc.moveDown(0.8);
            doc
              .fontSize(11)
              .font('Helvetica-Bold')
              .fillColor('#7e22ce')
              .text('Upcoming Scheduled Meals (Estimated Plan)', MARGIN, doc.y);

            doc
              .fontSize(7.5)
              .font('Helvetica')
              .fillColor(COLORS.textMuted)
              .text(
                'These meals are scheduled in advance and do NOT constitute an amount currently due. Dues apply only as dates pass.',
                MARGIN,
                doc.y + 2,
              );

            const schedHeaderY = doc.y + 12;
            doc.rect(MARGIN, schedHeaderY, 760, 18).fill('#f3e8ff');
            doc
              .fontSize(7.5)
              .font('Helvetica-Bold')
              .fillColor('#581c87')
              .text('Date', MARGIN + 6, schedHeaderY + 4, { width: 80 })
              .text('Morning Meals (Plates / Est. Cost)', MARGIN + 100, schedHeaderY + 4, { width: 220 })
              .text('Night Meals (Plates / Est. Cost)', MARGIN + 330, schedHeaderY + 4, { width: 220 })
              .text('Est. Room Cost', MARGIN + 560, schedHeaderY + 4, { width: 190, align: 'right' });

            doc.y = schedHeaderY + 18;

            data.scheduledFutureDays.forEach((sDay, sIdx) => {
              checkPageSpace(doc, 15, () => {});
              const sY = doc.y;
              if (sIdx % 2 === 1) doc.rect(MARGIN, sY, 760, 14).fill(COLORS.rowAlt);

              doc
                .fontSize(7.5)
                .font('Helvetica')
                .fillColor(COLORS.textDark)
                .text(`${sDay.compactDate} (${sDay.weekday})`, MARGIN + 6, sY + 3, { width: 80 })
                .text(`${sDay.morning.physicalPlates} plates · ${formatPdfRupees(sDay.morning.amountPaise)}`, MARGIN + 100, sY + 3, { width: 220 })
                .text(`${sDay.night.physicalPlates} plates · ${formatPdfRupees(sDay.night.amountPaise)}`, MARGIN + 330, sY + 3, { width: 220 })
                .font('Helvetica-Bold')
                .text(formatPdfRupees(sDay.dailyTotalPaise), MARGIN + 560, sY + 3, { width: 190, align: 'right' });

              doc.y = sY + 14;
            });

            doc.moveDown(0.8);
          }

          // -------------------------------------------------------------
          // PAYMENTS & AUDIT LEDGER SECTION
          // -------------------------------------------------------------
          checkPageSpace(doc, 110, () => {});

          doc.moveDown(0.8);
          doc
            .fontSize(11)
            .font('Helvetica-Bold')
            .fillColor(COLORS.textDark)
            .text('Payments & Audit Ledger', MARGIN, doc.y);

          doc
            .fontSize(7.5)
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(
              'Recorded settlement transactions, UPI references, and void adjustments. Non-void payments contribute to the final paid amount.',
              MARGIN,
              doc.y + 2,
            );

          const payTableY = doc.y + 12;
          const payWidths = [80, 95, 90, 70, 75, 350];
          const payX = [MARGIN];
          for (let i = 0; i < payWidths.length - 1; i++) {
            payX.push(payX[i] + payWidths[i]);
          }

          doc.rect(MARGIN, payTableY, 760, 18).fill(COLORS.headerBg);
          doc
            .fontSize(7.5)
            .font('Helvetica-Bold')
            .fillColor(COLORS.headerText)
            .text('Date', payX[0] + 6, payTableY + 4, { width: payWidths[0] - 10, align: 'left' })
            .text('Member', payX[1], payTableY + 4, { width: payWidths[1] - 6, align: 'left' })
            .text('Amount', payX[2], payTableY + 4, { width: payWidths[2] - 6, align: 'right' })
            .text('Method', payX[3], payTableY + 4, { width: payWidths[3] - 6, align: 'center' })
            .text('Status', payX[4], payTableY + 4, { width: payWidths[4] - 6, align: 'center' })
            .text('UPI Reference / Payment ID', payX[5], payTableY + 4, { width: payWidths[5] - 6, align: 'left' });

          doc.y = payTableY + 18;

          if (data.payments.length === 0) {
            const noPayY = doc.y;
            doc.rect(MARGIN, noPayY, 760, 20).fill(COLORS.rowAlt);
            doc.rect(MARGIN, noPayY, 760, 20).stroke(COLORS.borderLight);
            doc
              .fontSize(7.5)
              .font('Helvetica')
              .fillColor(COLORS.textMuted)
              .text('No payment transactions have been recorded for this month.', MARGIN + 12, noPayY + 5);
            doc.y = noPayY + 24;
          } else {
            data.payments.forEach((p, pIndex) => {
              checkPageSpace(doc, 16, () => {});
              const pY = doc.y;
              if (pIndex % 2 === 1) doc.rect(MARGIN, pY, 760, 15).fill(COLORS.rowAlt);
              doc.strokeColor(COLORS.borderLight).lineWidth(0.3).moveTo(MARGIN, pY + 15).lineTo(PAGE_WIDTH - MARGIN, pY + 15).stroke();

              const refText = p.upiReference ? `${p.upiReference}  (${p.paymentId})` : p.paymentId;

              doc
                .fontSize(7.5)
                .font('Helvetica')
                .fillColor(COLORS.textDark)
                .text(p.date, payX[0] + 6, pY + 3.5, { width: payWidths[0] - 10, align: 'left' })
                .font('Helvetica-Bold')
                .text(p.memberName, payX[1], pY + 3.5, { width: payWidths[1] - 6, align: 'left' })
                .font(p.isVoid ? 'Helvetica' : 'Helvetica-Bold')
                .fillColor(p.isVoid ? COLORS.textSubtle : COLORS.success)
                .text(formatPdfRupees(p.amountPaise), payX[2], pY + 3.5, { width: payWidths[2] - 6, align: 'right' })
                .font('Helvetica')
                .fillColor(COLORS.textDark)
                .text(p.method, payX[3], pY + 3.5, { width: payWidths[3] - 6, align: 'center' })
                .fillColor(p.isVoid ? COLORS.textSubtle : COLORS.success)
                .text(p.isVoid ? 'VOIDED' : 'RECORDED', payX[4], pY + 3.5, { width: payWidths[4] - 6, align: 'center' })
                .fillColor(COLORS.textMuted)
                .text(refText, payX[5], pY + 3.5, { width: payWidths[5] - 6, align: 'left', ellipsis: true });

              doc.y = pY + 15;
            });
          }

          // Payment Disclaimer
          doc.moveDown(0.4);
          doc
            .fontSize(7)
            .font('Helvetica-Oblique')
            .fillColor(COLORS.textMuted)
            .text(
              'Notice: Payment entries are user-confirmed MealKhata records and are not independently verified by a bank.',
              MARGIN,
              doc.y,
              { width: 760 },
            );

          // -------------------------------------------------------------
          // FINAL TOTAL RECONCILIATION BOX & LEGAL FOOTNOTES
          // -------------------------------------------------------------
          checkPageSpace(doc, 90, () => {});

          doc.moveDown(0.8);
          const finalBoxY = doc.y;
          doc.rect(MARGIN, finalBoxY, 760, 52).fill('#f1f5f9');
          doc.rect(MARGIN, finalBoxY, 760, 52).stroke(COLORS.primary);

          doc
            .fontSize(8.5)
            .font('Helvetica-Bold')
            .fillColor(COLORS.primary)
            .text('Final Monthly Reconciliation & Balance Summary', MARGIN + 12, finalBoxY + 8);

          // Row 1 metrics in box
          doc
            .fontSize(8)
            .font('Helvetica')
            .fillColor(COLORS.textDark)
            .text(
              `Total Physical Plates: ${data.summary.totalPhysicalPlates} (${data.summary.morningPhysicalPlates} Morning + ${data.summary.nightPhysicalPlates} Night)`,
              MARGIN + 12,
              finalBoxY + 22,
            )
            .text(`Room Meal Bill: ${formatPdfRupees(data.summary.roomAmountPaise)}`, MARGIN + 280, finalBoxY + 22)
            .text(`Total Paid: ${formatPdfRupees(data.summary.paidAmountPaise)}`, MARGIN + 460, finalBoxY + 22)
            .font('Helvetica-Bold')
            .fillColor(data.summary.remainingAmountPaise > 0 ? COLORS.warning : COLORS.success)
            .text(
              data.summary.overpaidAmountPaise > 0
                ? `Net Overpaid: +${formatPdfRupees(data.summary.overpaidAmountPaise)}`
                : `Net Outstanding: ${formatPdfRupees(data.summary.remainingAmountPaise)}`,
              MARGIN + 600,
              finalBoxY + 22,
              { width: 145, align: 'right' },
            );

          // Row 2 explanation in box
          doc
            .fontSize(7)
            .font('Helvetica')
            .fillColor(COLORS.textMuted)
            .text(
              '✓ Integer Paise Audit: Sum of daily member allocations exactly equals room physical plate total. ' +
              (data.reportState === 'closed'
                ? 'Frozen settlement snapshot balances match ledger totals exactly.'
                : 'Open month balances are subject to ongoing daily meal updates until official settlement close.'),
              MARGIN + 12,
              finalBoxY + 36,
              { width: 735 },
            );

          doc.y = finalBoxY + 58;

          // Legend and Accounting Footnotes
          doc
            .fontSize(6.5)
            .font('Helvetica')
            .fillColor(COLORS.textSubtle)
            .text(
              'Legend: Taking = Member explicitly joined meal | Skip = Member explicitly skipped | Not set = Unspecified (0 plates, Rs. 0) | Share = Physical plate equivalent.\n' +
              'All calculations use integer paise. Shared plate costs are distributed using MealKhata\'s deterministic exact allocation rules so member totals always equal the physical plate cost.\n' +
              'This report was generated from MealKhata\'s authoritative meal, allocation, and payment records.',
              MARGIN,
              doc.y,
              { width: 760, lineGap: 2 },
            );

          // -------------------------------------------------------------
          // BUFFERED PAGES: Render clean footers on all pages
          // -------------------------------------------------------------
          const bufferedPages = doc.bufferedPageRange();
          for (let i = bufferedPages.start; i < bufferedPages.start + bufferedPages.count; i++) {
            doc.switchToPage(i);
            drawPageFooter(doc, data, i + 1, bufferedPages.count);
          }

          doc.end();
        } catch (error) {
          reject(error);
        }
      });
    },
  });
}

export const monthlyReportPdfService = createMonthlyReportPdfService();
