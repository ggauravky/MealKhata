export function LoadingState({ label = 'Loading', compact = false }) {
  return (
    <div className={`state-message state-message--loading${compact ? ' is-compact' : ''}`} role="status">
      <span className="state-message__skeleton" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
