import { Inbox } from 'lucide-react';

export function EmptyState({ title, message }) {
  return (
    <div className="state-message state-message--empty">
      <Inbox size={23} strokeWidth={1.6} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}
