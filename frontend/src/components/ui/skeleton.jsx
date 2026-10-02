import { cn } from '../../lib/utils.js';

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800/80', className)}
      {...props}
    />
  );
}
