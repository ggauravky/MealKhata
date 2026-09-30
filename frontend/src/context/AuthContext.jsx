import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { AuthContext } from './authContext.js';

const viewerSession = Object.freeze({
  authenticated: false,
  role: 'viewer',
  memberId: null,
  displayName: null,
  capabilities: Object.freeze({
    canEditToday: false,
    canEditPast: false,
    canEditFuture: false,
  }),
});

function normalizeSession(session) {
  if (!session?.authenticated || !['member', 'admin', 'superadmin'].includes(session.role)) {
    return viewerSession;
  }

  const isMember = session.role === 'member';
  const memberId = isMember && typeof session.memberId === 'string' ? session.memberId : null;
  const displayName = isMember && typeof session.displayName === 'string' ? session.displayName : null;

  return {
    authenticated: true,
    role: session.role,
    memberId,
    displayName,
    capabilities: {
      canEditToday: Boolean(session.capabilities?.canEditToday),
      canEditPast: Boolean(session.capabilities?.canEditPast),
      canEditFuture: Boolean(session.capabilities?.canEditFuture),
    },
  };
}

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState({
    loading: true,
    session: viewerSession,
  });

  useEffect(() => {
    const controller = new AbortController();

    api.get('/api/auth/session', { signal: controller.signal })
      .then((response) => {
        setAuthState({ loading: false, session: normalizeSession(response.session) });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAuthState({ loading: false, session: viewerSession });
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handleExpiredSession = () => {
      setAuthState({ loading: false, session: viewerSession });
    };
    window.addEventListener('mk:auth-expired', handleExpiredSession);
    return () => window.removeEventListener('mk:auth-expired', handleExpiredSession);
  }, []);

  const login = useCallback(async (credentials) => {
    const response = await api.post('/api/auth/login', credentials);
    const session = normalizeSession(response.session);
    setAuthState({ loading: false, session });
    return session;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    window.location.replace('/');
  }, []);

  const value = useMemo(
    () => ({
      loading: authState.loading,
      ...authState.session,
      login,
      logout,
    }),
    [authState, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
