import {
  BedDouble,
  CalendarDays,
  ChartNoAxesCombined,
  CreditCard,
  Download,
  House,
  LogIn,
  LogOut,
  Moon,
  MoreHorizontal,
  Receipt,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { usePwa } from '../../hooks/usePwa.js';
import { useTheme } from '../../hooks/useTheme.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.jsx';

const mainNavItems = [
  { label: 'Home', path: '/', icon: House },
  { label: 'Mess', path: '/calendar', icon: CalendarDays },
  { label: 'Room', path: '/room-fees', icon: BedDouble },
  { label: 'Expenses', path: '/expenses', icon: Receipt },
];

export function MobileNav() {
  const auth = useAuth();
  const { canInstall, installApp } = usePwa();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const canAccessAdmin = auth.role === 'admin' || auth.role === 'superadmin';

  const handleLogout = async () => {
    setSubmitting(true);
    try {
      await auth.logout();
      navigate('/login');
    } catch {
      // Ignored
    } finally {
      setSubmitting(false);
    }
  };

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 dark:bg-[#171a1f]/95 dark:border-slate-800/90 pb-[env(safe-area-inset-bottom)] shadow-xs"
      aria-label="Mobile navigation"
    >
      <div className="grid grid-cols-5 h-14 max-w-md mx-auto">
        {mainNavItems.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) =>
              [
                'flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors select-none py-1',
                isActive
                  ? 'text-teal-700 dark:text-teal-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={19}
                  strokeWidth={isActive ? 2.3 : 1.7}
                  aria-hidden="true"
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}

        {/* 5th Item: More Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors select-none py-1 focus-visible:outline-none cursor-pointer"
              aria-label="More options"
            >
              <MoreHorizontal size={19} strokeWidth={1.8} aria-hidden="true" />
              <span>More</span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" side="top" className="w-56 mb-2">
            <DropdownMenuLabel className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              More options
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Payments */}
            <DropdownMenuItem
              onClick={() => navigate('/payments')}
              className="flex items-center gap-2.5 cursor-pointer text-xs font-medium"
            >
              <CreditCard className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <span>Payments</span>
            </DropdownMenuItem>

            {/* Reports */}
            <DropdownMenuItem
              onClick={() => navigate('/reports')}
              className="flex items-center gap-2.5 cursor-pointer text-xs font-medium"
            >
              <ChartNoAxesCombined className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <span>Reports</span>
            </DropdownMenuItem>

            {/* Admin Panel */}
            {canAccessAdmin && (
              <>
                <DropdownMenuItem
                  onClick={() => navigate('/admin/expenses')}
                  className="flex items-center gap-2.5 cursor-pointer text-xs font-medium"
                >
                  <Receipt className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span>Expense Admin</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigate('/admin/room-fees')}
                  className="flex items-center gap-2.5 cursor-pointer text-xs font-medium"
                >
                  <BedDouble className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span>Room Fee Admin</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigate('/admin')}
                  className="flex items-center gap-2.5 cursor-pointer text-xs font-medium"
                >
                  <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span>Mess Admin Panel</span>
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />

            {/* Theme Toggle */}
            <DropdownMenuItem
              onClick={cycleTheme}
              className="flex items-center justify-between cursor-pointer text-xs font-medium"
            >
              <span className="flex items-center gap-2.5">
                {resolvedTheme === 'dark' ? (
                  <Moon className="h-4 w-4 text-indigo-400" />
                ) : (
                  <Sun className="h-4 w-4 text-amber-500" />
                )}
                <span>Theme ({theme})</span>
              </span>
            </DropdownMenuItem>

            {/* Install App */}
            {canInstall && (
              <DropdownMenuItem
                onClick={() => installApp()}
                className="flex items-center gap-2.5 cursor-pointer text-xs font-medium"
              >
                <Download className="h-4 w-4 text-slate-500" />
                <span>Install app</span>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {/* Auth action */}
            {auth.authenticated ? (
              <DropdownMenuItem
                onClick={handleLogout}
                disabled={submitting}
                className="flex items-center gap-2.5 text-red-600 dark:text-red-400 focus:text-red-700 dark:focus:text-red-300 focus:bg-red-50 dark:focus:bg-red-950/40 cursor-pointer text-xs font-medium"
              >
                <LogOut className="h-4 w-4" />
                <span>{submitting ? 'Signing out...' : 'Sign out'}</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => navigate('/login')}
                className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-teal-700 dark:text-teal-400"
              >
                <LogIn className="h-4 w-4" />
                <span>Sign in</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
