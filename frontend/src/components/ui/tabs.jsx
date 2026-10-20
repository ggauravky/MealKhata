import * as React from 'react';
import { cn } from '../../lib/utils.js';

const TabsContext = React.createContext(null);

export function Tabs({ defaultValue, value, onValueChange, children, className }) {
  const [selected, setSelected] = React.useState(defaultValue || '');
  const activeTab = value !== undefined ? value : selected;
  const changeTab = React.useCallback(
    (val) => {
      if (value === undefined) setSelected(val);
      if (onValueChange) onValueChange(val);
    },
    [value, onValueChange],
  );

  return (
    <TabsContext.Provider value={{ activeTab, changeTab }}>
      <div className={cn('w-full', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children, ...props }) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-lg bg-slate-100 p-1 text-slate-500 dark:bg-slate-800/80 dark:text-slate-400',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, className, children, disabled = false, ...props }) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('TabsTrigger must be used within Tabs');

  const isActive = context.activeTab === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      disabled={disabled}
      onClick={() => context.changeTab(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium ring-offset-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
        isActive
          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100 font-semibold'
          : 'hover:text-slate-900 dark:hover:text-slate-200',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className, children, ...props }) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('TabsContent must be used within Tabs');

  if (context.activeTab !== value) return null;

  return (
    <div
      role="tabpanel"
      className={cn(
        'mt-3 ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
