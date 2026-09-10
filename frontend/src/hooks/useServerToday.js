import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export function useServerToday() {
  const [state, setState] = useState({ loading: true, date: '', error: '' });

  useEffect(() => {
    const controller = new AbortController();

    api.get('/api/meals/today', { signal: controller.signal })
      .then((response) => setState({ loading: false, date: response.data.date, error: '' }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ loading: false, date: '', error: 'Unable to determine the current India date.' });
        }
      });

    return () => controller.abort();
  }, []);

  return state;
}

