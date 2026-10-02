import { Inbox } from 'lucide-react';

export function EmptyState({ title, message, icon: Icon = Inbox, className = '' }) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center rounded-lg border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 ${className}`}
    >
      <Icon className="h-8 w-8 text-slate-400 dark:text-slate-500 mb-2" aria-hidden="true" />
      <strong className="text-sm font-semibold text-slate-800 dark:text-slate-200 block">
        {title}
      </strong>
      {message && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-sm">
          {message}
        </p>
      )}
    </div>
  );
}
