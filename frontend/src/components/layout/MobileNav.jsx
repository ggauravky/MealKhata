import { CalendarDays, ChartNoAxesCombined, CreditCard, House } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const items = [
  { label: 'Home', path: '/', icon: House },
  { label: 'Calendar', path: '/calendar', icon: CalendarDays },
  { label: 'Reports', path: '/reports', icon: ChartNoAxesCombined },
  { label: 'Payments', path: '/payments', icon: CreditCard },
];

function linkClass({ isActive }) {
  return `mobile-nav__link${isActive ? ' is-active' : ''}`;
}

export function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Primary navigation">
      {items.map(({ label, path, icon: Icon }) => (
        <NavLink key={path} className={linkClass} end={path === '/'} to={path}>
          <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
