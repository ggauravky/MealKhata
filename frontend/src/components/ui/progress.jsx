import * as React from 'react';
import { cn } from '../../lib/utils.js';

export const Progress = React.forwardRef(({ className, value = 0, variant = 'default', ...props }, ref) => {
  const clampedValue = Math.min(100, Math.max(0, Number(value) || 0));

  const variantStyles = {
    default: 'bg-teal-600 dark:bg-teal-500',
    emerald: 'bg-emerald-600 dark:bg-emerald-500',
    amber: 'bg-amber-500 dark:bg-amber-400',
    red: 'bg-red-500 dark:bg-red-400',
  };

  const indicatorClass = variantStyles[variant] || variantStyles.default;

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedValue}
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800',
        className,
      )}
      {...props}
    >
      <div
        className={cn('h-full w-full flex-1 transition-all duration-300 ease-out', indicatorClass)}
        style={{ transform: `translateX(-${100 - clampedValue}%)` }}
      />
    </div>
  );
});

Progress.displayName = 'Progress';
