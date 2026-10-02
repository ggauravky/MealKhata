import { NavLink } from 'react-router-dom';
import { AccountMenu } from './AccountMenu.jsx';
import { ThemeToggle } from '../common/ThemeToggle.jsx';
import { NAV_ITEMS } from '../../lib/constants.js';

function navLinkClass({ isActive }) {
  return [
    'px-3 py-1.5 rounded-sm text-sm font-medium transition-colors select-none',
    isActive
      ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300'
      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/60',
  ].join(' ');
}

export function DesktopNav() {
  return (
    <div className="hidden md:flex md:items-center md:justify-between md:flex-1 md:ml-8">
      <nav className="flex items-center gap-1" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={navLinkClass}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-2" aria-label="Account actions">
        <ThemeToggle />
        <AccountMenu />
      </div>
    </div>
  );
}
