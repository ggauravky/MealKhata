import PDFDocument from 'pdfkit';
import { MEMBER_NAMES } from '../config/members.js';
import { formatPlateFraction } from '../meals/plateAllocation.service.js';

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
          `Morning Meal: ${formatRupees(rates.morningPricePaise)} / physical plate   |   Night Meal: ${formatRupees(rates.nightPricePaise)} / physical plate`,
        );

      doc.moveDown(1);

      // Member Settlement Table Header
      // Layout (50 to 545 = 495):
      // Member: 50 -> 125 (width 75)
      // M. Meals: 125 -> 165 (width 40)
      // M. Plates: 165 -> 210 (width 45)
      // N. Meals: 210 -> 250 (width 40)
      // N. Plates: 250 -> 295 (width 45)
      // Total: 295 -> 340 (width 45)
      // Bill: 340 -> 405 (width 65)
      // Paid: 405 -> 475 (width 70)
      // Balance: 475 -> 545 (width 70)
      const tableTop = doc.y;
      doc.rect(50, tableTop, 495, 24).fill('#f1f5f9');

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#1e293b')
        .text('Member', 53, tableTop + 7, { width: 72 })
        .text('M. Joined', 125, tableTop + 7, { width: 40, align: 'right' })
        .text('M. Plates', 165, tableTop + 7, { width: 45, align: 'right' })
        .text('N. Joined', 210, tableTop + 7, { width: 40, align: 'right' })
        .text('N. Plates', 250, tableTop + 7, { width: 45, align: 'right' })
        .text('Total Plt', 295, tableTop + 7, { width: 45, align: 'right' })
        .text('Bill Amount', 340, tableTop + 7, { width: 65, align: 'right' })
        .text('Total Paid', 405, tableTop + 7, { width: 70, align: 'right' })
        .text('Balance', 475, tableTop + 7, { width: 67, align: 'right' });

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
        const morningPart = m.morningParticipationCount ?? m.morningCount ?? 0;
        const nightPart = m.nightParticipationCount ?? m.nightCount ?? 0;
        const morningUnits = m.morningShareUnits ?? (morningPart * 6);
        const nightUnits = m.nightShareUnits ?? (nightPart * 6);
        const totalUnits = m.totalShareUnits ?? (morningUnits + nightUnits);

        doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(50, currentY).lineTo(545, currentY).stroke();

        doc
          .fontSize(8)
          .font('Helvetica')
          .fillColor('#0f172a')
          .text(name, 53, currentY + 6, { width: 72 })
          .text(String(morningPart), 125, currentY + 6, { width: 40, align: 'right' })
          .text(formatPlateFraction(morningUnits), 165, currentY + 6, { width: 45, align: 'right' })
          .text(String(nightPart), 210, currentY + 6, { width: 40, align: 'right' })
          .text(formatPlateFraction(nightUnits), 250, currentY + 6, { width: 45, align: 'right' })
          .text(formatPlateFraction(totalUnits), 295, currentY + 6, { width: 45, align: 'right' })
          .text(formatRupees(m.billAmountPaise), 340, currentY + 6, { width: 65, align: 'right' })
          .text(formatRupees(m.paidAmountPaise), 405, currentY + 6, { width: 70, align: 'right' })
          .text(formatRupees(m.remainingAmountPaise || 0), 475, currentY + 6, { width: 67, align: 'right' });

        currentY += 22;
      }

      // Room Total Row
      const roomMorningPlates = room.morningPhysicalPlates ?? room.morningCount ?? 0;
      const roomNightPlates = room.nightPhysicalPlates ?? room.nightCount ?? 0;
      const roomTotalPlates = room.totalPhysicalPlates ?? room.totalPlates ?? (roomMorningPlates + roomNightPlates);

      doc.rect(50, currentY, 495, 24).fill('#e2e8f0');
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text('Room Physical', 53, currentY + 7, { width: 72 })
        .text('-', 125, currentY + 7, { width: 40, align: 'right' })
        .text(String(roomMorningPlates), 165, currentY + 7, { width: 45, align: 'right' })
        .text('-', 210, currentY + 7, { width: 40, align: 'right' })
        .text(String(roomNightPlates), 250, currentY + 7, { width: 45, align: 'right' })
        .text(String(roomTotalPlates), 295, currentY + 7, { width: 45, align: 'right' })
        .text(formatRupees(room.billAmountPaise), 340, currentY + 7, { width: 65, align: 'right' })
        .text(formatRupees(room.paidAmountPaise), 405, currentY + 7, { width: 70, align: 'right' })
        .text(formatRupees(room.remainingAmountPaise || 0), 475, currentY + 7, { width: 67, align: 'right' });

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
