import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { ROOMMATES } from '../../lib/constants.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { formatPaise } from '../../lib/money.js';

export function VoidPaymentDialog({ payment, onClose, onVoided }) {
  const dialogRef = useRef(null);
  const reasonRef = useRef(null);
  const previousFocusRef = useRef(document.activeElement);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const memberName = ROOMMATES.find(({ id }) => id === payment.memberId)?.name ?? payment.memberId;

  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    dialogRef.current.showModal();
    reasonRef.current?.focus();
    return () => previousFocus?.focus?.();
  }, []);

  const closeWhenSafe = () => !busy && onClose();
  const handleSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/payments/${encodeURIComponent(payment.paymentId)}/void`, { reason });
      onVoided();
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };

  return (
    <dialog className="payment-dialog payment-dialog--compact" ref={dialogRef} aria-labelledby="void-dialog-title" onCancel={(event) => { event.preventDefault(); closeWhenSafe(); }}>
      <div className="payment-dialog__header">
        <div><p className="page-heading__eyebrow">Keep the audit trail</p><h2 id="void-dialog-title">Void {formatPaise(payment.amountPaise)} payment?</h2></div>
        <button className="icon-button" type="button" aria-label="Close void payment dialog" onClick={closeWhenSafe} disabled={busy}><X size={19} aria-hidden="true" /></button>
      </div>
      <form className="payment-form" onSubmit={handleSubmit}>
        <p>The payment will remain in history and stop contributing to the paid total.</p>
        <dl className="payment-dialog__facts">
          <div><dt>Member</dt><dd>{memberName}</dd></div>
          <div><dt>Month</dt><dd>{formatLogicalMonth(payment.month)}</dd></div>
          <div><dt>Amount</dt><dd>{formatPaise(payment.amountPaise)}</dd></div>
        </dl>
        <label><span>Reason</span><input ref={reasonRef} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="payment-dialog__actions">
          <button className="button button--danger" type="submit" disabled={busy || !reason.trim()}>{busy ? 'Voiding…' : 'Void payment'}</button>
          <button className="button button--quiet" type="button" onClick={closeWhenSafe} disabled={busy}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}
