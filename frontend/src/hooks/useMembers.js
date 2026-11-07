import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { normalizeMemberRoster } from '../lib/memberContracts.js';

export function useMembers() {
  const [state, setState] = useState({ loading: true, error: '', data: [] });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/api/admin/members', { signal: controller.signal })
      .then((response) => setState({
        loading: false,
        error: '',
        data: normalizeMemberRoster(response.data),
      }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            loading: false,
            error: error?.message || 'Unable to load configured members.',
            data: [],
          });
        }
      });
    return () => controller.abort();
  }, [version]);

  const runMutation = useCallback(async (method, path, payload) => {
    const response = await api[method](path, payload, { preserveSessionOnUnauthorized: true });
    refresh();
    return response.data;
  }, [refresh]);

  return {
    ...state,
    refresh,
    provisionAccount: (memberId, payload) => runMutation('post', `/api/admin/members/${memberId}/provision`, payload),
    changeEmail: (memberId, payload) => runMutation('patch', `/api/admin/members/${memberId}/email`, payload),
    resetPassword: (memberId, payload) => runMutation('post', `/api/admin/members/${memberId}/reset-password`, payload),
    setAccountActive: (memberId, active, payload) => runMutation(
      'post',
      `/api/admin/members/${memberId}/${active ? 'activate' : 'deactivate'}`,
      payload,
    ),
  };
}
