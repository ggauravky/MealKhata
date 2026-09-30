import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';

export function ReopenMonthDialog({ month, onClose, onReopened }) {
  const dialogRef = useRef(null);
  const reasonRef = useRef(null);
  const previousFocusRef = useRef(document.activeElement);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const monthLabel = formatLogicalMonth(month);

  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    dialogRef.current?.showModal();
    reasonRef.current?.focus();
    return () => previousFocus?.focus?.();
  }, []);

  const closeWhenSafe = () => !busy && onClose();

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Please provide a reason for reopening.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onReopened(trimmed);
    } catch (requestError) {
      setError(requestError.message || 'Unable to reopen this month.');
      setBusy(false);
    }
  };

  return (
    <dialog
      className="payment-dialog payment-dialog--compact"
      ref={dialogRef}
      aria-labelledby="reopen-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        closeWhenSafe();
      }}
    >
      <div className="payment-dialog__header">
        <div>
          <p className="page-heading__eyebrow">Audit Trail Required</p>
          <h2 id="reopen-dialog-title">Reopen {monthLabel}?</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close dialog"
          onClick={closeWhenSafe}
          disabled={busy}
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      <form className="payment-form" onSubmit={handleSubmit}>
        <p>
          Reopening <strong>{monthLabel}</strong> unlocks meals, rates, and payments for correction. The existing settlement statement will be preserved in history.
        </p>
        <label>
          <span>Reason for reopening</span>
          <input
            ref={reasonRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Incorrect night meal entry on 18 Sep"
            maxLength={200}
            required
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="payment-dialog__actions">
          <button className="button button--danger" type="submit" disabled={busy || !reason.trim()}>
            {busy ? 'Reopening…' : `Reopen ${monthLabel}`}
          </button>
          <button className="button button--quiet" type="button" onClick={closeWhenSafe} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
