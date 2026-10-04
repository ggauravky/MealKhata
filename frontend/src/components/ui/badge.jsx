import { cn } from '../../lib/utils.js';

const badgeVariants = ({
  variant = 'default',
  className = '',
} = {}) => {
  const base =
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors select-none';

  const variants = {
    default:
      'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/50 dark:text-teal-300',
    secondary:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300',
    outline:
      'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-transparent',
    destructive:
      'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300',
    taking:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-300',
    skip:
      'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400',
    not_set:
      'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400',
    shared:
      'border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-800/60 dark:bg-purple-950/50 dark:text-purple-300',
    morning:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300',
    night:
      'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/60 dark:bg-indigo-950/50 dark:text-indigo-300',
    warning:
      'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/50 dark:text-orange-300',
  };

  return cn(base, variants[variant] || variants.default, className);
};

export function Badge({ className, variant = 'default', ...props }) {
  return (
    <div className={badgeVariants({ variant, className })} {...props} />
  );
}
