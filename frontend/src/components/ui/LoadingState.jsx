import { Loader2 } from 'lucide-react';

export function LoadingState({ label = 'Loading...', compact = false }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400 ${
        compact ? 'p-3 text-xs' : 'p-8 text-sm'
      }`}
      role="status"
    >
      <Loader2 className="h-4 w-4 animate-spin text-teal-700 dark:text-teal-400" />
      <span>{label}</span>
    </div>
  );
}
