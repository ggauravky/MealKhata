import { CircleAlert } from 'lucide-react';

export function ErrorState({ title, message, actionLabel, onAction, compact = false }) {
  return (
    <div
      className={`rounded-lg border border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200 flex items-start gap-2.5 ${
        compact ? 'p-3 text-xs' : 'p-4 text-sm'
      }`}
      role="alert"
    >
      <CircleAlert className="h-4 w-4 shrink-0 text-red-600 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <strong className="block font-semibold">{title}</strong>
        {message && <p className="text-xs text-red-800/90 dark:text-red-300/90 mt-0.5">{message}</p>}
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="mt-2 text-xs font-semibold text-red-700 dark:text-red-400 underline hover:no-underline cursor-pointer"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
