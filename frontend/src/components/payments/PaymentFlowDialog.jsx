import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { formatPaise, paiseToRupeeInput } from '../../lib/money.js';
import { createIdempotencyKey, formatReceiverMobile, getReceiverMobileCopyValue } from '../../lib/paymentFlow.js';

export function PaymentFlowDialog({ member, month, onClose, onRecorded }) {
  const dialogRef = useRef(null);
  const prepareButtonRef = useRef(null);
  const previousFocusRef = useRef(document.activeElement);
  const [prepared, setPrepared] = useState(null);
  const [upiReference, setUpiReference] = useState('');
  const [idempotencyKey] = useState(() => createIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = previousFocusRef.current;
    dialog.showModal();
    prepareButtonRef.current?.focus();
    return () => previousFocus?.focus?.();
  }, []);

  const closeWhenSafe = () => {
    if (!busy) onClose();
  };

  const handlePrepare = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await api.post('/api/payments/prepare', { month, memberId: member.id });
      setPrepared(response.data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const copyValue = async (label, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied.`);
    } catch {
      setCopied(`Could not copy ${label.toLowerCase()}.`);
    }
  };

  const handleRecord = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/api/payments', {
        month,
        memberId: member.id,
        amountPaise: prepared.amountPaise,
        idempotencyKey,
        upiReference: upiReference || null,
      });
      onRecorded();
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };

  return (
    <dialog
      className="payment-dialog"
      ref={dialogRef}
      aria-labelledby="payment-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        closeWhenSafe();
      }}
    >
      <div className="payment-dialog__header">
        <div>
          <p className="page-heading__eyebrow">Manual UPI payment</p>
          <h2 id="payment-dialog-title">{prepared ? `Pay ${formatPaise(prepared.amountPaise)} to ${prepared.payee.name}` : `Pay for ${member.name}`}</h2>
        </div>
        <button className="icon-button" type="button" aria-label="Close payment dialog" onClick={closeWhenSafe} disabled={busy}>
          <X size={19} aria-hidden="true" />
        </button>
      </div>

      {!prepared ? (
        <form className="payment-form" onSubmit={handlePrepare}>
          <dl className="payment-dialog__facts">
            <div><dt>Member</dt><dd>{member.name}</dd></div>
            <div><dt>Month</dt><dd>{formatLogicalMonth(month)}</dd></div>
            <div><dt>Remaining amount</dt><dd>{formatPaise(member.remainingAmountPaise)}</dd></div>
          </dl>
          <p className="field-hint">MealKhata calculates the exact outstanding amount. You do not need to enter it manually.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button ref={prepareButtonRef} className="button button--primary button--full" type="submit" disabled={busy}>{busy ? 'Preparing…' : `Pay ${formatPaise(member.remainingAmountPaise)}`}</button>
        </form>
      ) : (
        <div className="upi-confirmation">
          <p>{prepared.upiUri
            ? 'Complete the payment in your UPI app, then return here. Opening the app does not mark this bill paid.'
            : 'Open your UPI app and pay this amount to the mobile number below. MealKhata does not fabricate or assume a UPI ID.'}</p>
          <dl className="upi-details">
            <div><dt>Receiver</dt><dd>{prepared.payee.name}</dd></div>
            {prepared.payee.upiId && <div><dt>UPI ID</dt><dd>{prepared.payee.upiId}</dd></div>}
            {prepared.payee.mobile && <div><dt>UPI-linked mobile</dt><dd>{formatReceiverMobile(prepared.payee.mobile)}</dd></div>}
            <div><dt>Amount</dt><dd>{formatPaise(prepared.amountPaise)}</dd></div>
            <div><dt>Note</dt><dd>{prepared.note}</dd></div>
          </dl>
          {prepared.upiUri && (
            <a className="button button--primary button--full" href={prepared.upiUri}>
              Open UPI App <ExternalLink size={17} aria-hidden="true" />
            </a>
          )}
          <div className="copy-actions">
            {prepared.payee.upiId && (
              <button className="button button--quiet" type="button" aria-label="Copy receiver UPI ID" onClick={() => copyValue('UPI ID', prepared.payee.upiId)}>
                <Copy size={16} aria-hidden="true" /> Copy UPI ID
              </button>
            )}
            {!prepared.payee.upiId && prepared.payee.mobile && (
              <button className="button button--quiet" type="button" aria-label="Copy receiver mobile number" onClick={() => copyValue('Mobile number', getReceiverMobileCopyValue(prepared.payee.mobile))}>
                <Copy size={16} aria-hidden="true" /> Copy mobile
              </button>
            )}
            <button className="button button--quiet" type="button" aria-label="Copy payment amount" onClick={() => copyValue('Amount', paiseToRupeeInput(prepared.amountPaise))}>
              <Copy size={16} aria-hidden="true" /> Copy amount
            </button>
          </div>
          <p className="save-feedback" role="status" aria-live="polite">{copied}</p>
          <label>
            <span>Payment transaction/reference ID (optional)</span>
            <input value={upiReference} onChange={(event) => setUpiReference(event.target.value)} maxLength={100} autoComplete="off" />
          </label>
          <div className="payment-confirmation-question">
            <strong>Did you complete the payment?</strong>
            <span>Only continue if the payment was actually completed. MealKhata records your declaration; it does not verify with the bank.</span>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="payment-dialog__actions">
            <button className="button button--primary" type="button" onClick={handleRecord} disabled={busy}>
              <Check size={17} aria-hidden="true" /> {busy ? 'Recording…' : 'Yes, payment done'}
            </button>
            <button className="button button--quiet" type="button" onClick={closeWhenSafe} disabled={busy}>Not yet</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
