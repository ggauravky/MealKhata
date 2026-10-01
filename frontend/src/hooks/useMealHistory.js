import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export function useMealHistory(date) {
  const [state, setState] = useState({
    date: null,
    loading: true,
    error: '',
    items: [],
    allocationChanges: [],
    allChanges: [],
  });
  const [refreshVersion, setRefreshVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    setRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!date) {
      return undefined;
    }

    const controller = new AbortController();
    api.get(`/api/meals/${encodeURIComponent(date)}/history`, { signal: controller.signal })
      .then((response) => {
        const items = response.data?.items || [];
        const allocationChanges = response.data?.allocationChanges || [];
        const allChanges = [...items, ...allocationChanges].sort((a, b) => {
          return new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime();
        });

        setState({
          date,
          loading: false,
          error: '',
          items,
          allocationChanges,
          allChanges,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({
            date,
            loading: false,
            error: 'Recent changes could not be loaded.',
            items: [],
            allocationChanges: [],
            allChanges: [],
          });
        }
      });

    return () => controller.abort();
  }, [date, refreshVersion]);

  useEffect(() => {
    if (!date) {
      return undefined;
    }

    const handleUpdate = (event) => {
      if (event?.date === date) {
        refresh();
      }
    };
    const handleReconnect = () => refresh();

    socket.on('meal:updated', handleUpdate);
    socket.io.on('reconnect', handleReconnect);

    return () => {
      socket.off('meal:updated', handleUpdate);
      socket.io.off('reconnect', handleReconnect);
    };
  }, [date, refresh]);

  const isCurrentDate = state.date === date;

  return {
    loading: !isCurrentDate || state.loading,
    error: isCurrentDate ? state.error : '',
    items: isCurrentDate ? state.items : [],
    allocationChanges: isCurrentDate ? state.allocationChanges : [],
    allChanges: isCurrentDate ? state.allChanges : [],
    refresh,
  };
}
