import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export function usePaymentSettings(enabled) {
  const [state, setState] = useState({ loading: enabled, error: '', data: null });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const controller = new AbortController();
    api.get('/api/payment-settings', { signal: controller.signal })
      .then((response) => setState({ loading: false, error: '', data: response.data }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ loading: false, error: 'Unable to load receiver settings.', data: null });
      });
    return () => controller.abort();
  }, [enabled, refreshVersion]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleSettings = () => refresh();
    const handleReconnect = () => refresh();
    socket.on('payment:settings-updated', handleSettings);
    socket.io.on('reconnect', handleReconnect);
    return () => {
      socket.off('payment:settings-updated', handleSettings);
      socket.io.off('reconnect', handleReconnect);
    };
  }, [enabled, refresh]);

  return { ...state, refresh };
}
