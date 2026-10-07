import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { Button } from '../ui/button.jsx';

export function ProtectedRoute({ allowedRoles = ['admin', 'superadmin'] } = {}) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.loading) {
    return <LoadingState label="Restoring your session" />;
  }

  if (auth.status === 'unavailable' && !auth.authenticated) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Unable to verify your session right now. The server may be connecting.
        </p>
        <Button
          type="button"
          onClick={() => auth.retrySession?.()}
          className="text-xs"
        >
          Retry Connection
        </Button>
      </div>
    );
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
