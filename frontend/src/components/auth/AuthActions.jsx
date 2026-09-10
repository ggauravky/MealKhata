import { LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { getRoleLabel } from '../../lib/constants.js';

export function AuthActions({ mobile = false }) {
  const auth = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleLogout = async () => {
    setSubmitting(true);
    setError('');

    try {
      await auth.logout();
    } catch {
      setError('Logout failed. Please try again.');
      setSubmitting(false);
    }
  };

  if (auth.loading) {
    return (
      <span className={mobile ? 'mobile-auth-loading' : 'auth-loading'} role="status">
        <span className="sr-only">Checking session</span>
      </span>
    );
  }

  if (!auth.authenticated) {
    return (
      <Link
        className={mobile ? 'mobile-account-link' : 'button button--quiet button--compact'}
        to="/login"
        aria-label={mobile ? 'Sign in' : undefined}
      >
        <LogIn size={mobile ? 20 : 17} strokeWidth={1.8} />
        {!mobile && 'Sign in'}
      </Link>
    );
  }

  return (
    <>
      {!mobile && <span className="role-badge">{getRoleLabel(auth.role)}</span>}
      <NavLink
        className={mobile ? 'mobile-account-link' : 'icon-link'}
        to="/admin"
        aria-label="Open Admin"
      >
        <ShieldCheck size={19} strokeWidth={1.8} />
      </NavLink>
      <button
        className={mobile ? 'mobile-account-link' : 'button button--quiet button--compact'}
        type="button"
        onClick={handleLogout}
        disabled={submitting}
        aria-label={mobile ? 'Logout' : undefined}
      >
        <LogOut size={mobile ? 19 : 17} strokeWidth={1.8} />
        {!mobile && (submitting ? 'Signing out' : 'Logout')}
      </button>
      {error && <span className="sr-only" role="alert">{error}</span>}
    </>
  );
}
