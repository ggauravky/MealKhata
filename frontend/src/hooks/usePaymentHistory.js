import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export function usePaymentHistory(month) {
  const [state, setState] = useState({ key: null, loading: true, error: '', items: [] });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    setRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    const controller = new AbortController();
    api.get(`/api/payments/history/${encodeURIComponent(month)}`, { signal: controller.signal })
      .then((response) => setState({ key: month, loading: false, error: '', items: response.data.items }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ key: month, loading: false, error: 'Unable to load payment history.', items: [] });
      });
    return () => controller.abort();
  }, [month, refreshVersion]);

  useEffect(() => {
    if (!month) return undefined;
    const handlePayment = (event) => event?.month === month && refresh();
    const handleReconnect = () => refresh();
    socket.on('payment:updated', handlePayment);
    socket.io.on('reconnect', handleReconnect);
    window.addEventListener('mk:online-reconnected', handleReconnect);
    window.addEventListener('online', handleReconnect);
    return () => {
      socket.off('payment:updated', handlePayment);
      socket.io.off('reconnect', handleReconnect);
      window.removeEventListener('mk:online-reconnected', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, [month, refresh]);

  const current = state.key === month;
  return { loading: !current || state.loading, error: current ? state.error : '', items: current ? state.items : [], refresh };
}

