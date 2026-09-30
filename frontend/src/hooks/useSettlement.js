import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export function useSettlement(month) {
  const [state, setState] = useState({
    key: null,
    loading: true,
    error: '',
    status: null,
    history: [],
  });
  const [refreshVersion, setRefreshVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    setRefreshVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;

    const controller = new AbortController();
    Promise.all([
      api.get(`/api/settlements/${encodeURIComponent(month)}`, { signal: controller.signal }),
      api.get(`/api/settlements/${encodeURIComponent(month)}/history`, { signal: controller.signal }).catch(() => ({ data: [] })),
    ])
      .then(([statusRes, historyRes]) => {
        setState({
          key: month,
          loading: false,
          error: '',
          status: statusRes?.data || null,
          history: historyRes?.data || [],
        });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({
            key: month,
            loading: false,
            error: err.message || 'Unable to load settlement status.',
            status: null,
            history: [],
          });
        }
      });

    return () => controller.abort();
  }, [month, refreshVersion]);

  useEffect(() => {
    if (!month) return undefined;

    const handleSettlementUpdate = (event) => {
      if (event?.month === month) {
        refresh();
      }
    };
    const handleMealUpdate = (event) => {
      if (event?.date?.slice(0, 7) === month) {
        refresh();
      }
    };
    const handlePaymentUpdate = (event) => {
      if (event?.month === month) {
        refresh();
      }
    };
    const handleRateUpdate = (event) => {
      if (event?.month === month) {
        refresh();
      }
    };
    const handleReconnect = () => refresh();

    socket.on('settlement:updated', handleSettlementUpdate);
    socket.on('meal:updated', handleMealUpdate);
    socket.on('payment:updated', handlePaymentUpdate);
    socket.on('billing:rate-updated', handleRateUpdate);
    socket.io.on('reconnect', handleReconnect);

    return () => {
      socket.off('settlement:updated', handleSettlementUpdate);
      socket.off('meal:updated', handleMealUpdate);
      socket.off('payment:updated', handlePaymentUpdate);
      socket.off('billing:rate-updated', handleRateUpdate);
      socket.io.off('reconnect', handleReconnect);
    };
  }, [month, refresh]);

  const current = state.key === month;
  const status = current ? state.status : null;
  const isClosed = status?.state === 'closed';

  const closeMonth = async () => {
    const res = await api.post(`/api/settlements/${encodeURIComponent(month)}/close`, { month });
    refresh();
    return res;
  };

  const reopenMonth = async (reason) => {
    const res = await api.post(`/api/settlements/${encodeURIComponent(month)}/reopen`, { reason });
    refresh();
    return res;
  };

  return {
    loading: !current || state.loading,
    error: current ? state.error : '',
    status,
    isClosed,
    history: current ? state.history : [],
    refresh,
    closeMonth,
    reopenMonth,
  };
}
