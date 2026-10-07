import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { isNetworkOrServerError, normalizeSession, viewerSession } from '../lib/session.js';
import { AuthContext } from './authContext.js';

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState({
    loading: true,
    status: 'loading',
    session: viewerSession,
    error: null,
  });

  const checkSession = useCallback(async (signal) => {
    const maxAttempts = 3;
    const retryDelays = [500, 1500];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await api.get('/api/auth/session', { signal });
        if (signal?.aborted) return;

        const session = normalizeSession(response.session);
        setAuthState({
          loading: false,
          status: session.authenticated ? 'authenticated' : 'viewer',
          session,
          error: null,
        });
        return;
      } catch (error) {
        if (signal?.aborted) return;

        const isNetworkFailure = isNetworkOrServerError(error);

        if (isNetworkFailure && attempt < maxAttempts) {
          const delay = retryDelays[attempt - 1] ?? 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (signal?.aborted) return;
          continue;
        }

        if (isNetworkFailure) {
          setAuthState((prev) => ({
            loading: false,
            status: prev.session.authenticated ? 'authenticated' : 'unavailable',
            session: prev.session.authenticated ? prev.session : viewerSession,
            error: error.message || 'Unable to reach the server. Check your connection.',
          }));
          return;
        }

        // Definite rejection (client 4xx)
        setAuthState({
          loading: false,
          status: 'viewer',
          session: viewerSession,
          error: null,
        });
        return;
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    checkSession(controller.signal);
    return () => controller.abort();
  }, [checkSession]);

  useEffect(() => {
    const handleExpiredSession = () => {
      setAuthState({ loading: false, status: 'viewer', session: viewerSession, error: null });
    };
    window.addEventListener('mk:auth-expired', handleExpiredSession);
    return () => window.removeEventListener('mk:auth-expired', handleExpiredSession);
  }, []);

  // Multi-tab session synchronization via BroadcastChannel
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    let channel;
    try {
      channel = new BroadcastChannel('mealkhata-auth');
      const handleMessage = (event) => {
        if (event.data?.type === 'logout') {
          setAuthState({ loading: false, status: 'viewer', session: viewerSession, error: null });
        } else if (event.data?.type === 'login') {
          checkSession();
        }
      };

      channel.addEventListener('message', handleMessage);
      return () => {
        channel.removeEventListener('message', handleMessage);
        channel.close();
      };
    } catch {
      // BroadcastChannel optional fallback
    }
  }, [checkSession]);

  const login = useCallback(async (credentials) => {
    const response = await api.post('/api/auth/login', credentials);
    const session = normalizeSession(response.session);
    setAuthState({ loading: false, status: 'authenticated', session, error: null });

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel('mealkhata-auth');
        channel.postMessage({ type: 'login' });
        channel.close();
      } catch {
        // BroadcastChannel optional
      }
    }

    return session;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const channel = new BroadcastChannel('mealkhata-auth');
          channel.postMessage({ type: 'logout' });
          channel.close();
        } catch {
          // BroadcastChannel optional
        }
      }
      window.location.replace('/');
    }
  }, []);

  const retrySession = useCallback(() => {
    setAuthState((prev) => ({ ...prev, loading: true, error: null }));
    return checkSession();
  }, [checkSession]);

  const value = useMemo(
    () => ({
      loading: authState.loading,
      status: authState.status,
      error: authState.error,
      retrySession,
      ...authState.session,
      login,
      logout,
    }),
    [authState, login, logout, retrySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
