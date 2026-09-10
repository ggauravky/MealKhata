export function LiveIndicator({ connected }) {
  return (
    <span className={`live-indicator${connected ? ' is-connected' : ''}`} role="status">
      <span aria-hidden="true" />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

