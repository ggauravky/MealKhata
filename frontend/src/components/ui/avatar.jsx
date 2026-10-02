import { cn } from '../../lib/utils.js';

export function MemberAvatar({
  memberId,
  name = '',
  size = 'md',
  className = '',
}) {
  const initial = (name || memberId || '?').charAt(0).toUpperCase();

  const colorStyles = {
    gaurav:
      'bg-teal-50 text-teal-800 border-teal-200/80 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/60',
    nikhil:
      'bg-sky-50 text-sky-800 border-sky-200/80 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/60',
    devansh:
      'bg-purple-50 text-purple-800 border-purple-200/80 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800/60',
    admin:
      'bg-amber-50 text-amber-800 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60',
    superadmin:
      'bg-rose-50 text-rose-800 border-rose-200/80 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/60',
  };

  const sizeStyles = {
    xs: 'w-5 h-5 text-[10px]',
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm font-semibold',
    lg: 'w-10 h-10 text-base font-semibold',
  };

  const normalized = String(memberId || '').toLowerCase();
  const selectedColor = colorStyles[normalized] || 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700';

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full border select-none shrink-0 font-medium',
        selectedColor,
        sizeStyles[size] || sizeStyles.md,
        className,
      )}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
