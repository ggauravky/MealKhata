import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/** Loads administrator accounts, recent account audit events and system settings. */
export function useStaffAccounts({ enabled = true } = {}) {
  const [state, setState] = useState({ loading: enabled, error: '', accounts: [], audit: [], settings: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: '' }));
    Promise.all([
      api.get('/api/admin/accounts', { signal: controller.signal }),
      api.get('/api/admin/accounts/audit?limit=25', { signal: controller.signal }),
      api.get('/api/settings/system', { signal: controller.signal }),
    ])
      .then(([accounts, audit, settings]) => setState({
        loading: false,
        error: '',
        accounts: Array.isArray(accounts.data) ? accounts.data : [],
        audit: Array.isArray(audit.data) ? audit.data : [],
        settings: settings.data ?? null,
      }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState((current) => ({ ...current, loading: false, error: error?.message || 'Unable to load settings.' }));
        }
      });
    return () => controller.abort();
  }, [enabled, version]);

  const mutate = useCallback(async (request) => {
    const response = await request();
    refresh();
    return response;
  }, [refresh]);

  return {
    ...state,
    refresh,
    createAdmin: (payload) => mutate(() => api.post('/api/admin/accounts', payload)),
    resetAdminPassword: (userId, payload) => mutate(() => api.post(
      `/api/admin/accounts/${encodeURIComponent(userId)}/reset-password`, payload)),
    setAdminActive: (userId, active, payload) => mutate(() => api.post(
      `/api/admin/accounts/${encodeURIComponent(userId)}/${active ? 'activate' : 'deactivate'}`, payload)),
    updateSettings: (payload) => mutate(() => api.patch('/api/settings/system', payload)),
  };
}
