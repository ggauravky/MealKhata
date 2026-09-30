import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { LoadingState } from '../ui/LoadingState.jsx';

export function ProtectedRoute({ allowedRoles = ['admin', 'superadmin'] } = {}) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.loading) {
    return <LoadingState label="Restoring your session" />;
  }

  if (!auth.authenticated) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate replace to={`/login?next=${encodeURIComponent(next)}`} />;
  }

  if (allowedRoles && !allowedRoles.includes(auth.role)) {
    return <Navigate replace to="/" />;
  }

  return <Outlet />;
}
