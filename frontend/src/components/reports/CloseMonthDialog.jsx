import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';

export function CloseMonthDialog({ month, onClose, onClosed }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(document.activeElement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const monthLabel = formatLogicalMonth(month);

  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    dialogRef.current?.showModal();
    return () => previousFocus?.focus?.();
  }, []);

  const closeWhenSafe = () => !busy && onClose();

  const handleConfirm = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onClosed();
    } catch (requestError) {
      setError(requestError.message || 'Unable to close this month.');
      setBusy(false);
    }
  };

  return (
    <dialog
      className="payment-dialog payment-dialog--compact"
      ref={dialogRef}
      aria-labelledby="close-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        closeWhenSafe();
      }}
    >
      <div className="payment-dialog__header">
        <div>
          <p className="page-heading__eyebrow">Monthly Settlement</p>
          <h2 id="close-dialog-title">Close {monthLabel}?</h2>
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
      <form className="payment-form" onSubmit={handleConfirm}>
        <p>
          This will freeze the final meal counts, rates, bills, and payments for <strong>{monthLabel}</strong> into an immutable accounting statement.
        </p>
        <p className="card-note">
          Once closed, meal edits, rate updates, and payment changes are locked until the month is explicitly reopened by Super Admin.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="payment-dialog__actions">
          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? 'Closing…' : `Close ${monthLabel}`}
          </button>
          <button className="button button--quiet" type="button" onClick={closeWhenSafe} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
