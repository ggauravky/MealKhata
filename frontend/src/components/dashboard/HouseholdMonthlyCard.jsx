import { ArrowRight, CreditCard, ReceiptText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatPaise } from '../../lib/money.js';

export function HouseholdMonthlyCard({ household }) {
  if (!household) return null;

  const {
    month,
    monthLabel,
    morningCount,
    nightCount,
    totalPlates,
    billAmountPaise,
    projectedBillAmountPaise,
    paidAmountPaise,
    remainingAmountPaise,
  } = household;

  return (
    <section className="panel household-monthly-card" aria-labelledby="household-monthly-title">
      <div className="household-monthly-card__header">
        <div>
          <span className="section-eyebrow">HOUSEHOLD {monthLabel.toUpperCase()}</span>
          <h2 id="household-monthly-title">Monthly Kitchen &amp; Expenses</h2>
        </div>
        <span className="badge-pill badge-pill--taking">
          Fixed Pricing
        </span>
      </div>

      <div className="personal-monthly-stats">
        <div className="monthly-stat-item">
          <span className="monthly-stat-item__label">Morning Plates</span>
          <strong className="monthly-stat-item__value">{morningCount}</strong>
        </div>
        <div className="monthly-stat-item">
          <span className="monthly-stat-item__label">Night Plates</span>
          <strong className="monthly-stat-item__value">{nightCount}</strong>
        </div>
        <div className="monthly-stat-item">
          <span className="monthly-stat-item__label">Total Physical</span>
          <strong className="monthly-stat-item__value">{totalPlates}</strong>
        </div>
      </div>

      <div className="personal-finance-grid">
        <div className="finance-metric">
          <span className="finance-metric__label">Room Bill to Date</span>
          <strong className="finance-metric__value">
            {billAmountPaise !== null ? formatPaise(billAmountPaise) : '—'}
          </strong>
        </div>
        <div className="finance-metric">
          <span className="finance-metric__label">Total Collected</span>
          <strong className="finance-metric__value">{formatPaise(paidAmountPaise)}</strong>
        </div>
        <div className="finance-metric finance-metric--due">
          <span className="finance-metric__label">Outstanding Total</span>
          <strong className="finance-metric__value">
            {remainingAmountPaise !== null ? formatPaise(remainingAmountPaise) : '—'}
          </strong>
        </div>
      </div>

      {Number.isSafeInteger(projectedBillAmountPaise) && (
        <p className="projection-note">
          Projected full-month room bill: {formatPaise(projectedBillAmountPaise)}
        </p>
      )}

      <div className="household-card-actions">
        <Link className="button button--secondary" to={`/reports?month=${month}`}>
          <ReceiptText size={17} aria-hidden="true" />
          Full Report <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <Link className="button button--secondary" to={`/payments?month=${month}`}>
          <CreditCard size={17} aria-hidden="true" />
          Payment Ledger <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
