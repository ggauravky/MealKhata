import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export const Select = React.forwardRef(({ className, children, ...props }, ref) => {
  return (
    <div className="relative inline-block w-full">
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-1 pr-8 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 cursor-pointer',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
    </div>
  );
});

Select.displayName = 'Select';
