import { CalendarDays, ChartNoAxesCombined, CreditCard, House } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const items = [
  { label: 'Home', path: '/', icon: House },
  { label: 'Calendar', path: '/calendar', icon: CalendarDays },
  { label: 'Reports', path: '/reports', icon: ChartNoAxesCombined },
  { label: 'Payments', path: '/payments', icon: CreditCard },
];

export function MobileNav() {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 dark:bg-[#171a1f]/95 dark:border-slate-800/90 pb-[env(safe-area-inset-bottom)] shadow-xs"
      aria-label="Primary navigation"
    >
      <div className="grid grid-cols-4 h-14 max-w-md mx-auto">
        {items.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) =>
              [
                'flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors select-none py-1',
                isActive
                  ? 'text-teal-700 dark:text-teal-400'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.2 : 1.7}
                  aria-hidden="true"
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
