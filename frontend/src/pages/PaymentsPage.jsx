import { ChevronLeft, ChevronRight, CircleDollarSign, History, WalletCards } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { PaymentFlowDialog } from '../components/payments/PaymentFlowDialog.jsx';
import { PaymentSettingsPanel } from '../components/payments/PaymentSettingsPanel.jsx';
import { VoidPaymentDialog } from '../components/payments/VoidPaymentDialog.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { usePaymentHistory } from '../hooks/usePaymentHistory.js';
import { usePaymentSummary } from '../hooks/usePaymentSummary.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { ROOMMATES } from '../lib/constants.js';
import { addLogicalMonths, formatLogicalMonth } from '../lib/logicalMonth.js';
import { formatPaise } from '../lib/money.js';
import { canInitiatePayment, PAYMENT_STATUS_LABELS } from '../lib/paymentFlow.js';

const periodLabels = { past: 'Completed month', current: 'Current total to date', future: 'Future month' };

function formatPaymentTime(value) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function MemberPaymentCard({ roommate, member, periodType, role, currentMemberId, onPay }) {
  const canPay = canInitiatePayment({ role, member, currentMemberId });
  const billLabel = member.billAmountPaise === null ? PAYMENT_STATUS_LABELS[member.status] : formatPaise(member.billAmountPaise);

  return (
    <article className="payment-member-card">
      <div className="payment-member-card__heading">
        <span className={`avatar avatar--${roommate.id}`} aria-hidden="true">{roommate.initial}</span>
        <div><h3>{roommate.name}</h3><span className={`payment-status payment-status--${member.status}`}>{PAYMENT_STATUS_LABELS[member.status]}</span></div>
      </div>
      <dl className="payment-amounts">
        <div><dt>Bill</dt><dd>{billLabel}</dd></div>
        <div><dt>Paid</dt><dd>{formatPaise(member.paidAmountPaise)}</dd></div>
        <div><dt>Remaining</dt><dd>{member.billAmountPaise === null ? '—' : formatPaise(member.remainingAmountPaise)}</dd></div>
        {member.overpaidAmountPaise > 0 && <div className="payment-amounts__overpaid"><dt>Overpaid</dt><dd>{formatPaise(member.overpaidAmountPaise)}</dd></div>}
      </dl>
      {periodType === 'current' && Number.isSafeInteger(member.projectedBillAmountPaise) && (
        <p className="projection-note">Projected month total: {formatPaise(member.projectedBillAmountPaise)} · not currently due</p>
      )}
      {canPay && <button className="button button--primary button--full" type="button" onClick={() => onPay({ ...roommate, ...member })}>Pay {formatPaise(member.remainingAmountPaise)}</button>}
      {member.status === 'rates_missing' && <p className="card-note">Payment unavailable until this month&apos;s meal rates are configured.</p>}
      {periodType === 'future' && <p className="card-note">Projected bill: {formatPaise(member.projectedBillAmountPaise)}</p>}
    </article>
  );
}

export function PaymentsPage() {
  const auth = useAuth();
  const serverToday = useServerToday();
  const [selectedMonth, setSelectedMonth] = useState('');
  const [payingMember, setPayingMember] = useState(null);
  const [voidingPayment, setVoidingPayment] = useState(null);
  const [message, setMessage] = useState('');
  const month = selectedMonth || serverToday.date.slice(0, 7);
  const summary = usePaymentSummary(month);
  const history = usePaymentHistory(month);
  const data = summary.data;

  const refreshPayments = () => { summary.refresh(); history.refresh(); };
  const handleRecorded = () => {
    setPayingMember(null);
    setMessage('Payment recorded. It was confirmed by the user, not verified by a bank.');
    refreshPayments();
  };
  const handleVoided = () => {
    setVoidingPayment(null);
    setMessage('Payment voided. The financial record remains in history.');
    refreshPayments();
  };

  return (
    <div className="page-stack">
      <PageHeader title="Payments" description="Monthly bills, manual UPI payments, and an auditable payment history." />

      {serverToday.error && <ErrorState title="Payments unavailable" message={serverToday.error} />}
      {serverToday.loading && !month && <LoadingState label="Loading current month" />}

      {month && (
        <section className="panel report-toolbar" aria-label="Payment month controls">
          <button className="button button--quiet" type="button" onClick={() => setSelectedMonth(addLogicalMonths(month, -1))}><ChevronLeft size={17} aria-hidden="true" /> Previous</button>
          <div><strong>{formatLogicalMonth(month)}</strong><span>{data ? periodLabels[data.periodType] : 'Loading payments'}</span></div>
          <button className="button button--quiet" type="button" onClick={() => setSelectedMonth(addLogicalMonths(month, 1))}>Next <ChevronRight size={17} aria-hidden="true" /></button>
          <button className="button button--quiet" type="button" onClick={() => setSelectedMonth(serverToday.date.slice(0, 7))}>Current month</button>
          <label className="month-input"><span className="sr-only">Choose payment month</span><input type="month" value={month} onChange={(event) => setSelectedMonth(event.target.value)} /></label>
        </section>
      )}

      <p className="save-feedback payment-page-feedback" role="status" aria-live="polite">{message}</p>
      {auth.role === 'superadmin' && <PaymentSettingsPanel />}
      {summary.error && <ErrorState title="Payment summary unavailable" message={summary.error} actionLabel="Try again" onAction={summary.refresh} />}
      {summary.loading && !data && <LoadingState label="Calculating payment status" />}

      {data && (
        <>
          <section className="panel payment-room-summary" aria-labelledby="room-payment-title">
            <div className="section-heading section-heading--compact">
              <span className="feature-icon" aria-hidden="true"><WalletCards size={22} /></span>
              <div><h2 id="room-payment-title">Room total</h2><p>{periodLabels[data.periodType]}</p></div>
            </div>
            <div className="room-payment-figures">
              <div><span>Bill</span><strong>{data.room.billAmountPaise === null ? PAYMENT_STATUS_LABELS[data.room.status] : formatPaise(data.room.billAmountPaise)}</strong></div>
              <div><span>Paid</span><strong>{formatPaise(data.room.paidAmountPaise)}</strong></div>
              <div><span>Remaining</span><strong>{data.room.billAmountPaise === null ? '—' : formatPaise(data.room.remainingAmountPaise)}</strong></div>
            </div>
          </section>

          <section className="payment-member-grid" aria-label={`Member payment status for ${formatLogicalMonth(month)}`}>
            {ROOMMATES.map((roommate) => (
              <MemberPaymentCard
                key={roommate.id}
                roommate={roommate}
                member={data.members[roommate.id]}
                periodType={data.periodType}
                role={auth.role}
                currentMemberId={auth.memberId}
                onPay={setPayingMember}
              />
            ))}
          </section>
        </>
      )}

      <section className="panel payment-history" aria-labelledby="payment-history-title">
        <div className="section-heading section-heading--compact">
          <span className="feature-icon" aria-hidden="true"><History size={22} /></span>
          <div><h2 id="payment-history-title">Payment History</h2><p>Recorded and voided entries remain visible.</p></div>
        </div>
        {history.loading ? <LoadingState compact label="Loading payment history" /> : history.error ? (
          <ErrorState compact title="History unavailable" message={history.error} actionLabel="Try again" onAction={history.refresh} />
        ) : history.items.length === 0 ? (
          <EmptyState title="No payment history" message={`No payments have been recorded for ${formatLogicalMonth(month)}.`} />
        ) : (
          <ol className="payment-history-list">
            {history.items.map((payment) => {
              const roommate = ROOMMATES.find(({ id }) => id === payment.memberId);
              return (
                <li key={payment.paymentId} className={payment.status === 'voided' ? 'is-voided' : ''}>
                  <div className="payment-history-list__icon" aria-hidden="true"><CircleDollarSign size={20} /></div>
                  <div className="payment-history-list__content">
                    <time dateTime={payment.recordedAt}>{formatPaymentTime(payment.recordedAt)}</time>
                    <strong>{roommate?.name ?? payment.memberId}</strong>
                    <span>UPI · {payment.status === 'voided' ? 'Voided' : 'Recorded'}</span>
                    {payment.upiReference && <span>Reference: {payment.upiReference}</span>}
                    {payment.status === 'voided' && payment.voidReason && <span>Reason: {payment.voidReason}</span>}
                  </div>
                  <div className="payment-history-list__amount">
                    <strong>{formatPaise(payment.amountPaise)}</strong>
                    {auth.role === 'superadmin' && payment.status === 'recorded' && <button className="text-button text-button--danger" type="button" onClick={() => setVoidingPayment(payment)}>Void payment</button>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {payingMember && <PaymentFlowDialog member={payingMember} month={month} onClose={() => setPayingMember(null)} onRecorded={handleRecorded} />}
      {voidingPayment && <VoidPaymentDialog payment={voidingPayment} onClose={() => setVoidingPayment(null)} onVoided={handleVoided} />}
    </div>
  );
}
