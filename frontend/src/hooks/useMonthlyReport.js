import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export function useMonthlyReport(month) {
  const [state, setState] = useState({ key: null, loading: true, error: '', data: null });
  const [refreshVersion, setRefreshVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    setRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!month) {
      return undefined;
    }

    const controller = new AbortController();
    api.get(`/api/reports/monthly/${encodeURIComponent(month)}`, { signal: controller.signal })
      .then((response) => setState({ key: month, loading: false, error: '', data: response.data }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ key: month, loading: false, error: "Unable to load this month's report.", data: null });
        }
      });

    return () => controller.abort();
  }, [month, refreshVersion]);

  useEffect(() => {
    if (!month) {
      return undefined;
    }

    const handleMealUpdate = (event) => {
      if (event?.date?.slice(0, 7) === month) {
        refresh();
      }
    };
    const handleRateUpdate = (event) => {
      if (event?.month === month) {
        refresh();
      }
    };
    const handleSettlementUpdate = (event) => {
      if (event?.month === month) {
        refresh();
      }
    };
    const handleReconnect = () => refresh();

    socket.on('meal:updated', handleMealUpdate);
    socket.on('billing:rate-updated', handleRateUpdate);
    socket.on('settlement:updated', handleSettlementUpdate);
    socket.io.on('reconnect', handleReconnect);
    return () => {
      socket.off('meal:updated', handleMealUpdate);
      socket.off('billing:rate-updated', handleRateUpdate);
      socket.off('settlement:updated', handleSettlementUpdate);
      socket.io.off('reconnect', handleReconnect);
    };
  }, [month, refresh]);

  const current = state.key === month;
  return {
    loading: !current || state.loading,
    error: current ? state.error : '',
    data: current ? state.data : null,
    refresh,
  };
}

