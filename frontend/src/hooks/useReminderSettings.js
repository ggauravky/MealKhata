import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export function useReminderSettings() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/api/settings/reminders', { signal: controller.signal })
      .then((response) => setState({ loading: false, error: '', data: response.data }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: 'Unable to load reminder settings.', data: null });
        }
      });
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const handleUpdate = () => refresh();
    socket.on('settings:reminders-updated', handleUpdate);
    socket.io.on('reconnect', handleUpdate);
    return () => {
      socket.off('settings:reminders-updated', handleUpdate);
      socket.io.off('reconnect', handleUpdate);
    };
  }, [refresh]);

  return { ...state, refresh };
}
