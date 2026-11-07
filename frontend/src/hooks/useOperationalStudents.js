import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toOperationalRoster } from '../lib/operationalRoster.js';

export function useOperationalStudents({ includeArchived = false, enabled = true } = {}) {
  const [state, setState] = useState({ loading: true, error: '', data: [] });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, error: '', data: [] });
      return undefined;
    }
    const controller = new AbortController();
    api.get('/api/students/roster', { signal: controller.signal })
      .then((response) => setState({ loading: false, error: '',
        data: toOperationalRoster(response.data, { includeArchived }) }))
      .catch((error) => {
        if (!controller.signal.aborted) setState({ loading: false, error: error?.message || 'Unable to load students.', data: [] });
      });
    return () => controller.abort();
  }, [enabled, includeArchived, version]);

  return enabled ? { ...state, refresh } : { loading: false, error: '', data: [], refresh };
}
