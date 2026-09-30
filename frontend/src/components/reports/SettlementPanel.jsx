import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Download, History, Lock, Unlock } from 'lucide-react';
import { useState } from 'react';
import { ROOMMATES } from '../../lib/constants.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { formatPaise } from '../../lib/money.js';
import { CloseMonthDialog } from './CloseMonthDialog.jsx';
import { ReopenMonthDialog } from './ReopenMonthDialog.jsx';

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

export function SettlementPanel({
  month,
  settlement,
  role,
  onCloseMonth,
  onReopenMonth,
}) {
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const status = settlement.status;
  if (!status) return null;

  const monthLabel = formatLogicalMonth(month);
  const isClosed = status.state === 'closed';
  const activeSettlement = status.activeSettlement;
  const history = settlement.history || [];

  return (
    <section className="panel settlement-panel" aria-labelledby="settlement-title">
      <div className="settlement-panel__header">
        <div>
          <p className="page-heading__eyebrow">Accounting Layer</p>
          <div className="settlement-panel__title-group">
            <h2 id="settlement-title">Monthly Settlement</h2>
            <span className={`settlement-status settlement-status--${status.state}`}>
              {isClosed ? (
                <>
                  <CheckCircle2 size={15} aria-hidden="true" /> Closed
                </>
              ) : status.state === 'ready_to_close' ? (
                <>
                  <Lock size={15} aria-hidden="true" /> Ready to close
                </>
              ) : (
                <>
                  <AlertCircle size={15} aria-hidden="true" /> Not ready
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      {isClosed && activeSettlement && (
        <div className="settlement-closed-summary">
          <p className="settlement-closed-badge">
            ✓ <strong>FINAL STATEMENT</strong> — Meal counts, rates, bills, and payments are frozen.
          </p>

          <dl className="settlement-metadata-grid">
            <div>
              <dt>Settlement</dt>
              <dd>#{activeSettlement.sequence} (Active)</dd>
            </div>
            <div>
              <dt>Closed date</dt>
              <dd>{formatDateTime(activeSettlement.closedAt)}</dd>
            </div>
            <div>
              <dt>Closed by</dt>
              <dd>Super Admin</dd>
            </div>
            <div>
              <dt>Final room total</dt>
              <dd className="highlight-amount">
                {formatPaise(activeSettlement.snapshot.room.billAmountPaise)}
              </dd>
            </div>
          </dl>

          <div className="settlement-actions-row">
            <a
              className="button button--secondary"
              href={`/api/settlements/${encodeURIComponent(month)}/statement.pdf`}
              download={`MealKhata-Settlement-${month}.pdf`}
            >
              <Download size={16} aria-hidden="true" /> Download PDF
            </a>
            <a
              className="button button--secondary"
              href={`/api/settlements/${encodeURIComponent(month)}/statement.csv`}
              download={`MealKhata-Settlement-${month}.csv`}
            >
              <Download size={16} aria-hidden="true" /> Download CSV
            </a>
            {role === 'superadmin' && (
              <button
                className="button button--quiet"
                type="button"
                onClick={() => setShowReopenDialog(true)}
              >
                <Unlock size={16} aria-hidden="true" /> Reopen Month
              </button>
            )}
          </div>
        </div>
      )}

      {!isClosed && status.state === 'ready_to_close' && (
        <div className="settlement-ready-summary">
          <p>
            All member bills and payments are fully settled (remaining: ₹0, overpaid: ₹0).
            Super Admin can now close {monthLabel} to freeze the final statement.
          </p>
          {role === 'superadmin' ? (
            <div className="settlement-actions-row">
              <button
                className="button button--primary"
                type="button"
                onClick={() => setShowCloseDialog(true)}
              >
                <Lock size={16} aria-hidden="true" /> Close {monthLabel}
              </button>
            </div>
          ) : (
            <p className="card-note">Only Super Admin can close the month.</p>
          )}
        </div>
      )}

      {!isClosed && status.state === 'not_ready' && (
        <div className="settlement-blockers-summary">
          <p>
            Outstanding balances or missing configuration must be resolved before {monthLabel} can be closed.
          </p>
          <ul className="settlement-blockers-list">
            {status.blockers.map((blocker, index) => {
              const roommate = ROOMMATES.find((r) => r.id === blocker.memberId);
              const memberName = roommate?.name || blocker.memberId;
              let description = blocker.message;

              if (blocker.type === 'remaining_balance') {
                description = `${memberName} has ${formatPaise(blocker.amountPaise)} remaining balance.`;
              } else if (blocker.type === 'overpayment') {
                description = `${memberName} is overpaid by ${formatPaise(blocker.amountPaise)}. Correct the payment ledger before closing.`;
              } else if (blocker.type === 'rates_missing') {
                description = `Meal rates are not configured for ${monthLabel}.`;
              }

              return <li key={index}>{description}</li>;
            })}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div className="settlement-history-section">
          <button
            className="button button--quiet settlement-history-toggle"
            type="button"
            onClick={() => setShowHistory((prev) => !prev)}
            aria-expanded={showHistory}
          >
            <History size={16} aria-hidden="true" />
            <span>Settlement History ({history.length})</span>
            {showHistory ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          </button>

          {showHistory && (
            <div className="settlement-history-list">
              {history.map((record) => (
                <article
                  key={record.settlementId}
                  className={`settlement-history-item ${record.status === 'closed' ? 'is-active' : 'is-reopened'}`}
                >
                  <div className="settlement-history-item__header">
                    <strong>Settlement #{record.sequence}</strong>
                    <span className={`settlement-status settlement-status--${record.status}`}>
                      {record.status === 'closed' ? 'Active / Final' : 'Reopened'}
                    </span>
                  </div>
                  <dl className="settlement-history-facts">
                    <div>
                      <dt>Closed</dt>
                      <dd>{formatDateTime(record.closedAt)} by {record.closedByRole}</dd>
                    </div>
                    {record.reopenedAt && (
                      <div>
                        <dt>Reopened</dt>
                        <dd>{formatDateTime(record.reopenedAt)} by {record.reopenedByRole}</dd>
                      </div>
                    )}
                    {record.reopenReason && (
                      <div>
                        <dt>Reason</dt>
                        <dd><em>&ldquo;{record.reopenReason}&rdquo;</em></dd>
                      </div>
                    )}
                    <div>
                      <dt>Room Total</dt>
                      <dd>{formatPaise(record.snapshot?.room?.billAmountPaise)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {showCloseDialog && (
        <CloseMonthDialog
          month={month}
          onClose={() => setShowCloseDialog(false)}
          onClosed={async () => {
            await onCloseMonth();
            setShowCloseDialog(false);
          }}
        />
      )}

      {showReopenDialog && (
        <ReopenMonthDialog
          month={month}
          onClose={() => setShowReopenDialog(false)}
          onReopened={async (reason) => {
            await onReopenMonth(reason);
            setShowReopenDialog(false);
          }}
        />
      )}
    </section>
  );
}
