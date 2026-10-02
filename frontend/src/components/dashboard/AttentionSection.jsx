import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import { Link } from 'react-router-dom';

function getAttentionIcon(type) {
  switch (type) {
    case 'financial':
      return AlertCircle;
    case 'settlement':
      return CheckCircle2;
    case 'configuration':
      return AlertTriangle;
    default:
      return Info;
  }
}

export function AttentionSection({ items = [] }) {
  // Requirement 40: Do not render a large information banner when nothing is wrong
  if (!items || items.length === 0) {
    return (
      <div className="attention-empty-banner text-[11px] text-slate-400 dark:text-slate-500 py-0" role="status">
        <span className="sr-only">You&apos;re all set. No urgent attention required today.</span>
      </div>
    );
  }

  return (
    <section className="space-y-2" aria-labelledby="attention-section-title">
      <h2 id="attention-section-title" className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Attention needed
      </h2>

      <div className="space-y-2">
        {items.map((item) => {
          const Icon = getAttentionIcon(item.type);
          return (
            <div
              key={item.id}
              role="alert"
              className={`attention-card attention-card--${item.type} flex items-center justify-between gap-3 rounded-lg border border-amber-200/90 bg-amber-50/70 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200`}
            >
              <div className="flex items-start gap-2.5">
                <Icon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden="true" />
                <div>
                  <strong className="font-semibold block">{item.title}</strong>
                  <p className="text-amber-800/90 dark:text-amber-300/90 text-xs mt-0.5">{item.message}</p>
                </div>
              </div>
              {item.link && (
                <Link
                  to={item.link}
                  className="inline-flex items-center gap-1 font-medium text-amber-800 hover:text-amber-950 dark:text-amber-300 dark:hover:text-amber-100 whitespace-nowrap ml-2"
                >
                  <span>{item.actionLabel || 'View'}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
