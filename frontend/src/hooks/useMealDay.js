import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

function getEndpoint(date) {
  return date === 'today' ? '/api/meals/today' : `/api/meals/${encodeURIComponent(date)}`;
}

export function useMealDay(date) {
  const [state, setState] = useState({ requestKey: null, loading: true, error: '', data: null });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [live, setLive] = useState(socket.connected);
  const currentData = useRef(null);

  useEffect(() => {
    currentData.current = state.data;
  }, [state.data]);

  // Background refreshes keep the current data on screen; `loading` only shows a
  // placeholder when there is nothing to display yet.
  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: !current.data, error: '' }));
    setRefreshVersion((version) => version + 1);
  }, []);

  const applyServerData = useCallback((data) => {
    const displayed = currentData.current;
    // Concurrent saves can answer out of order; never replace newer data with older.
    if (displayed && data && displayed.date === data.date
      && Number.isInteger(displayed.revision) && Number.isInteger(data.revision)
      && data.revision < displayed.revision) {
      return;
    }
    currentData.current = data;
    setState({ requestKey: date, loading: false, error: '', data });
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();

    api.get(getEndpoint(date), { signal: controller.signal })
      .then((response) => applyServerData(response.data))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState((current) => ({
            ...current,
            requestKey: date,
            loading: false,
            error: 'Meal data is temporarily unavailable. Please try again.',
          }));
        }
      });

    return () => controller.abort();
  }, [applyServerData, date, refreshVersion]);

  useEffect(() => {
    const handleUpdate = (event) => {
      const displayed = currentData.current;

      if (!displayed || event?.date !== displayed.date || event.revision <= displayed.revision) {
        return;
      }

      refresh();
    };

    const handleConnect = () => setLive(true);
    const handleDisconnect = () => setLive(false);
    const handleReconnect = () => refresh();

    socket.on('meal:updated', handleUpdate);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.io.on('reconnect', handleReconnect);
    window.addEventListener('mk:online-reconnected', handleReconnect);
    window.addEventListener('online', handleReconnect);

    return () => {
      socket.off('meal:updated', handleUpdate);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.io.off('reconnect', handleReconnect);
      window.removeEventListener('mk:online-reconnected', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, [refresh]);

  const hasCurrentData = state.requestKey === date;

  return {
    loading: !hasCurrentData || state.loading,
    error: hasCurrentData ? state.error : '',
    data: hasCurrentData ? state.data : null,
    live,
    refresh,
    applyServerData,
  };
}
