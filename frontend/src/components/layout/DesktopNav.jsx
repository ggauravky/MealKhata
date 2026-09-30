import { NavLink } from 'react-router-dom';
import { AuthActions } from '../auth/AuthActions.jsx';
import { InstallAppButton } from '../pwa/InstallAppButton.jsx';
import { NAV_ITEMS } from '../../lib/constants.js';

function linkClass({ isActive }) {
  return `desktop-nav__link${isActive ? ' is-active' : ''}`;
}

export function DesktopNav() {
  return (
    <div className="desktop-navigation">
      <nav className="desktop-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.path} className={linkClass} end={item.path === '/'} to={item.path}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="account-actions" aria-label="Account links">
        <InstallAppButton />
        <AuthActions />
      </div>
    </div>
  );
}
