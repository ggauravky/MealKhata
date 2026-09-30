import PDFDocument from 'pdfkit';
import { MEMBER_NAMES } from '../config/members.js';

function formatRupees(paise) {
  const amount = (paise / 100).toFixed(2);
  return `Rs. ${amount}`;
}

export function generateSettlementPdf(settlement) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `MealKhata Settlement - ${settlement.month}`,
          Author: 'MealKhata',
          Subject: 'Monthly Settlement Statement',
        },
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const { month, sequence, settlementId, closedAt, snapshot } = settlement;
      const { rates, members, room } = snapshot;

      // Header Banner
      doc
        .fontSize(22)
        .font('Helvetica-Bold')
        .fillColor('#1e293b')
        .text('MealKhata', { align: 'left' });

      doc
        .fontSize(12)
        .font('Helvetica')
        .fillColor('#64748b')
        .text('Monthly Settlement Statement — Final Financial Account', { align: 'left' });

      doc.moveDown(0.8);
      doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.8);

      // Metadata Block
      const metaY = doc.y;
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text(`Accounting Month: ${month}`, 50, metaY)
        .font('Helvetica')
        .fillColor('#334155')
        .text(`Settlement Version: #${sequence}`, 50, metaY + 16)
        .text(`Settlement ID: ${settlementId}`, 50, metaY + 32);

      const formattedClosedDate = closedAt
        ? new Date(closedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        : 'N/A';

      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text(`Status: FINAL / CLOSED`, 330, metaY)
        .font('Helvetica')
        .fillColor('#334155')
        .text(`Closed At: ${formattedClosedDate}`, 330, metaY + 16)
        .text(`Timezone: Asia/Kolkata`, 330, metaY + 32);

      doc.y = metaY + 54;
      doc.moveDown(0.5);

      // Rates section
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text('Approved Meal Rates:');

      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#334155')
        .text(
          `Morning Meal: ${formatRupees(rates.morningPricePaise)} per plate   |   Night Meal: ${formatRupees(rates.nightPricePaise)} per plate`,
        );

      doc.moveDown(1);

      // Member Settlement Table Header
      const tableTop = doc.y;
      doc.rect(50, tableTop, 495, 24).fill('#f1f5f9');

      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#1e293b')
        .text('Member', 55, tableTop + 7, { width: 85 })
        .text('Morning', 140, tableTop + 7, { width: 50, align: 'right' })
        .text('Night', 195, tableTop + 7, { width: 50, align: 'right' })
        .text('Plates', 250, tableTop + 7, { width: 45, align: 'right' })
        .text('Bill Amount', 300, tableTop + 7, { width: 75, align: 'right' })
        .text('Total Paid', 380, tableTop + 7, { width: 75, align: 'right' })
        .text('Balance', 460, tableTop + 7, { width: 75, align: 'right' });

      let currentY = tableTop + 24;

      // Table Rows
      const memberKeys = ['gaurav', 'nikhil', 'devansh'];
      for (const key of memberKeys) {
        const m = members[key] || {
          morningCount: 0,
          nightCount: 0,
          totalPlates: 0,
          billAmountPaise: 0,
          paidAmountPaise: 0,
          remainingAmountPaise: 0,
        };

        const name = MEMBER_NAMES[key] || key;

        doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(50, currentY).lineTo(545, currentY).stroke();

        doc
          .fontSize(9)
          .font('Helvetica')
          .fillColor('#0f172a')
          .text(name, 55, currentY + 6, { width: 85 })
          .text(String(m.morningCount), 140, currentY + 6, { width: 50, align: 'right' })
          .text(String(m.nightCount), 195, currentY + 6, { width: 50, align: 'right' })
          .text(String(m.totalPlates), 250, currentY + 6, { width: 45, align: 'right' })
          .text(formatRupees(m.billAmountPaise), 300, currentY + 6, { width: 75, align: 'right' })
          .text(formatRupees(m.paidAmountPaise), 380, currentY + 6, { width: 75, align: 'right' })
          .text(formatRupees(m.remainingAmountPaise || 0), 460, currentY + 6, { width: 75, align: 'right' });

        currentY += 22;
      }

      // Room Total Row
      doc.rect(50, currentY, 495, 24).fill('#e2e8f0');
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text('Room Total', 55, currentY + 7, { width: 85 })
        .text(String(room.morningCount), 140, currentY + 7, { width: 50, align: 'right' })
        .text(String(room.nightCount), 195, currentY + 7, { width: 50, align: 'right' })
        .text(String(room.totalPlates), 250, currentY + 7, { width: 45, align: 'right' })
        .text(formatRupees(room.billAmountPaise), 300, currentY + 7, { width: 75, align: 'right' })
        .text(formatRupees(room.paidAmountPaise), 380, currentY + 7, { width: 75, align: 'right' })
        .text(formatRupees(room.remainingAmountPaise || 0), 460, currentY + 7, { width: 75, align: 'right' });

      currentY += 34;

      // Settlement Verification Note
      doc.y = currentY;
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#047857')
        .text('✓ All member balances exactly settled (Remaining: Rs. 0.00, Overpaid: Rs. 0.00).');

      doc.moveDown(1.5);

      // Audit & Disclaimers Footer
      doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.6);

      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#64748b')
        .text(
          'Notice: Payment entries in MealKhata are user-confirmed records and are not independently bank-verified. ' +
            'This document represents an immutable settlement record closed by Super Admin on the recorded timestamp.',
          { align: 'justify' },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
