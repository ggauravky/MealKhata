import { ArrowRight, CreditCard, ReceiptText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatPaise } from '../../lib/money.js';
import { PAYMENT_STATUS_LABELS } from '../../lib/paymentFlow.js';

export function PersonalMonthlyCard({ personal }) {
  if (!personal) return null;

  const {
    month,
    monthLabel,
    morningCount,
    nightCount,
    totalPlates,
    billAmountPaise,
    paidAmountPaise,
    remainingAmountPaise,
    projectedBillAmountPaise,
    status,
  } = personal;

  const ratesMissing = status === 'rates_missing' || billAmountPaise === null;
  const hasRemaining = Number.isSafeInteger(remainingAmountPaise) && remainingAmountPaise > 0;

  return (
    <section className="panel personal-monthly-card" aria-labelledby="personal-monthly-title">
      <div className="personal-monthly-card__header">
        <div>
          <span className="section-eyebrow">YOUR {monthLabel.toUpperCase()}</span>
          <h2 id="personal-monthly-title">Monthly Meals &amp; Bill</h2>
        </div>
        <span className={`payment-status payment-status--${status}`}>
          {PAYMENT_STATUS_LABELS[status] || status}
        </span>
      </div>

      <div className="personal-monthly-stats">
        <div className="monthly-stat-item">
          <span className="monthly-stat-item__label">Morning Meals</span>
          <strong className="monthly-stat-item__value">{morningCount}</strong>
        </div>
        <div className="monthly-stat-item">
          <span className="monthly-stat-item__label">Night Meals</span>
          <strong className="monthly-stat-item__value">{nightCount}</strong>
        </div>
        <div className="monthly-stat-item">
          <span className="monthly-stat-item__label">Total Plates</span>
          <strong className="monthly-stat-item__value">{totalPlates}</strong>
        </div>
      </div>

      <div className="personal-finance-grid">
        <div className="finance-metric">
          <span className="finance-metric__label">Current Bill</span>
          <strong className="finance-metric__value">
            {ratesMissing ? 'Rates Pending' : formatPaise(billAmountPaise)}
          </strong>
        </div>
        <div className="finance-metric">
          <span className="finance-metric__label">Paid to Date</span>
          <strong className="finance-metric__value">{formatPaise(paidAmountPaise)}</strong>
        </div>
        <div className="finance-metric finance-metric--due">
          <span className="finance-metric__label">Remaining Due</span>
          <strong className="finance-metric__value">
            {ratesMissing ? '—' : formatPaise(remainingAmountPaise)}
          </strong>
        </div>
      </div>

      {Number.isSafeInteger(projectedBillAmountPaise) && (
        <p className="projection-note">
          Projected month total: {formatPaise(projectedBillAmountPaise)} · estimated to month end
        </p>
      )}

      {ratesMissing && (
        <p className="rates-pending-notice">
          Meal rates for {monthLabel} have not been configured yet. Bills and dues will calculate automatically once rates are set.
        </p>
      )}

      <div className="personal-card-actions">
        {hasRemaining ? (
          <Link className="button button--primary button--full" to={`/payments?month=${month}`}>
            <CreditCard size={17} aria-hidden="true" />
            Go to Payments ({formatPaise(remainingAmountPaise)})
          </Link>
        ) : (
          <Link className="button button--secondary button--full" to={`/reports?month=${month}`}>
            <ReceiptText size={17} aria-hidden="true" />
            View {monthLabel} Report <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>
    </section>
  );
}
