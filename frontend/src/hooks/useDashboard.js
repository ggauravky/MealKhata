import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export function useDashboard() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [live, setLive] = useState(socket.connected);
  const debounceTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: current.data ? false : true, error: '' }));
    setRefreshVersion((v) => v + 1);
  }, []);

  const debouncedRefresh = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        refresh();
      }
    }, 200);
  }, [refresh]);

  useEffect(() => {
    isMountedRef.current = true;
    const controller = new AbortController();

    api.get('/api/dashboard', { signal: controller.signal })
      .then((response) => {
        if (isMountedRef.current) {
          setState({ loading: false, error: '', data: response.data });
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted && isMountedRef.current) {
          setState((current) => ({
            ...current,
            loading: false,
            error: err?.message || 'Dashboard data is temporarily unavailable. Please try again.',
          }));
        }
      });

    return () => {
      isMountedRef.current = false;
      controller.abort();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [refreshVersion]);

  useEffect(() => {
    const handleConnect = () => setLive(true);
    const handleDisconnect = () => setLive(false);
    const handleReconnect = () => debouncedRefresh();

    socket.on('meal:updated', debouncedRefresh);
    socket.on('payment:updated', debouncedRefresh);
    socket.on('settlement:updated', debouncedRefresh);
    socket.on('reminder-settings:updated', debouncedRefresh);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.io?.on('reconnect', handleReconnect);
    window.addEventListener('mk:online-reconnected', handleReconnect);
    window.addEventListener('online', handleReconnect);

    return () => {
      socket.off('meal:updated', debouncedRefresh);
      socket.off('payment:updated', debouncedRefresh);
      socket.off('settlement:updated', debouncedRefresh);
      socket.off('reminder-settings:updated', debouncedRefresh);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.io?.off('reconnect', handleReconnect);
      window.removeEventListener('mk:online-reconnected', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, [debouncedRefresh]);

  const applyMealDayUpdate = useCallback((mealDay) => {
    if (!mealDay?.date || !mealDay.meals) return;
    setState((current) => {
      if (!current.data) return current;
      const morning = mealDay.meals.morning;
      const night = mealDay.meals.night;
      const morningPlates = Object.values(morning).filter((s) => s === 'taking').length;
      const nightPlates = Object.values(night).filter((s) => s === 'taking').length;

      const updatedMembers = current.data.householdToday?.members?.map((m) => ({
        ...m,
        morning: morning[m.memberId] || m.morning,
        night: night[m.memberId] || m.night,
        plates:
          ((morning[m.memberId] || m.morning) === 'taking' ? 1 : 0) +
          ((night[m.memberId] || m.night) === 'taking' ? 1 : 0),
      })) || [];

      const personalHero = current.data.personalHero
        ? {
            ...current.data.personalHero,
            morning: morning[current.data.personalHero.memberId] || current.data.personalHero.morning,
            night: night[current.data.personalHero.memberId] || current.data.personalHero.night,
          }
        : null;

      return {
        ...current,
        data: {
          ...current.data,
          meals: {
            ...current.data.meals,
            morning,
            night,
            revision: mealDay.revision ?? current.data.meals.revision,
            saved: true,
          },
          personalHero,
          householdToday: {
            ...current.data.householdToday,
            morningPlates,
            nightPlates,
            totalPlates: morningPlates + nightPlates,
            members: updatedMembers,
          },
        },
      };
    });
  }, []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    live,
    refresh,
    applyMealDayUpdate,
  };
}
