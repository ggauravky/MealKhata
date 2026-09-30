import { MEMBER_NAMES } from '../config/members.js';

function escapeCsvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateSettlementCsv(settlement) {
  const headers = [
    'month',
    'settlement_id',
    'settlement_sequence',
    'member_id',
    'member_name',
    'morning_meals',
    'night_meals',
    'total_plates',
    'morning_rate_paise',
    'night_rate_paise',
    'bill_amount_paise',
    'paid_amount_paise',
    'remaining_amount_paise',
    'status',
    'closed_at',
  ];

  const rows = [headers.map(escapeCsvCell).join(',')];

  const { month, settlementId, sequence, status, closedAt, snapshot } = settlement;
  const { rates, members } = snapshot;

  const memberKeys = ['gaurav', 'nikhil', 'devansh'];

  for (const memberId of memberKeys) {
    const m = members[memberId] || {
      morningCount: 0,
      nightCount: 0,
      totalPlates: 0,
      billAmountPaise: 0,
      paidAmountPaise: 0,
      remainingAmountPaise: 0,
    };

    const row = [
      month,
      settlementId,
      sequence,
      memberId,
      MEMBER_NAMES[memberId] || memberId,
      m.morningCount,
      m.nightCount,
      m.totalPlates,
      rates.morningPricePaise,
      rates.nightPricePaise,
      m.billAmountPaise,
      m.paidAmountPaise,
      m.remainingAmountPaise || 0,
      status.toUpperCase(),
      closedAt ? new Date(closedAt).toISOString() : '',
    ];

    rows.push(row.map(escapeCsvCell).join(','));
  }

  return rows.join('\r\n') + '\r\n';
}
