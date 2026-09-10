import { CircleAlert } from 'lucide-react';

export function ErrorState({ title, message, actionLabel, onAction, compact = false }) {
  return (
    <div className={`state-message state-message--error${compact ? ' is-compact' : ''}`} role="alert">
      <CircleAlert size={23} strokeWidth={1.7} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
        {actionLabel && onAction && (
          <button className="text-button" type="button" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
