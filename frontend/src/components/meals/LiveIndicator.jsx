export function LiveIndicator({ connected, className = '' }) {
  if (connected) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/80 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300 select-none ${className}`}
        role="status"
        title="Realtime sync connected"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-pulse" aria-hidden="true" />
        <span>Live</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50/80 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300 select-none ${className}`}
      role="status"
      title="Disconnected from realtime sync"
    >
      <span className="h-1.5 w-1.5 rounded-full border border-amber-600 dark:border-amber-400" aria-hidden="true" />
      <span>Offline</span>
    </span>
  );
}
