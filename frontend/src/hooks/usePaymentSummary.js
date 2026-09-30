import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export function usePaymentSummary(month) {
  const [state, setState] = useState({ key: null, loading: true, error: '', data: null });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    setRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    const controller = new AbortController();
    api.get(`/api/payments/summary/${encodeURIComponent(month)}`, { signal: controller.signal })
      .then((response) => setState({ key: month, loading: false, error: '', data: response.data }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ key: month, loading: false, error: 'Unable to load payment summary.', data: null });
      });
    return () => controller.abort();
  }, [month, refreshVersion]);

  useEffect(() => {
    if (!month) return undefined;
    const handlePayment = (event) => event?.month === month && refresh();
    const handleMeal = (event) => event?.date?.slice(0, 7) === month && refresh();
    const handleRate = (event) => event?.month === month && refresh();
    const handleReconnect = () => refresh();
    socket.on('payment:updated', handlePayment);
    socket.on('meal:updated', handleMeal);
    socket.on('billing:rate-updated', handleRate);
    socket.io.on('reconnect', handleReconnect);
    window.addEventListener('mk:online-reconnected', handleReconnect);
    window.addEventListener('online', handleReconnect);
    return () => {
      socket.off('payment:updated', handlePayment);
      socket.off('meal:updated', handleMeal);
      socket.off('billing:rate-updated', handleRate);
      socket.io.off('reconnect', handleReconnect);
      window.removeEventListener('mk:online-reconnected', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, [month, refresh]);

  const current = state.key === month;
  return { loading: !current || state.loading, error: current ? state.error : '', data: current ? state.data : null, refresh };
}

