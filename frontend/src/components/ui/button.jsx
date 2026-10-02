import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../lib/utils.js';

const buttonVariants = ({
  variant = 'default',
  size = 'default',
  className = '',
} = {}) => {
  const base =
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none';

  const variants = {
    default:
      'bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 shadow-sm active:translate-y-px',
    secondary:
      'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 active:translate-y-px',
    outline:
      'border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-slate-200 active:translate-y-px',
    ghost:
      'hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200',
    destructive:
      'bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 shadow-sm active:translate-y-px',
    link: 'text-teal-700 dark:text-teal-400 underline-offset-4 hover:underline p-0 h-auto font-medium',
  };

  const sizes = {
    default: 'h-9 px-3.5 py-1.5',
    sm: 'h-8 px-2.5 text-xs',
    lg: 'h-10 px-5 text-base',
    icon: 'h-9 w-9 p-0',
    compact: 'h-7 px-2 text-xs',
  };

  return cn(base, variants[variant] || variants.default, sizes[size] || sizes.default, className);
};

export const Button = React.forwardRef(
  ({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={buttonVariants({ variant, size, className })}
        ref={ref}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
