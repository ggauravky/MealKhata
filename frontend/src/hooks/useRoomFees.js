import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

/**
 * Hook for a Member to view their current month room fee statement & assignment
 */
export function useMyRoomFees(month) {
  const [state, setState] = useState({ key: null, loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    const controller = new AbortController();
    api.get(`/api/room-fees/me?month=${encodeURIComponent(month)}`, { signal: controller.signal })
      .then((res) => setState({ key: month, loading: false, error: '', data: res.data }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ key: month, loading: false, error: err?.message || 'Unable to load room fees.', data: null });
        }
      });
    return () => controller.abort();
  }, [month, version]);

  useEffect(() => {
    const handleRoomFees = (event) => {
      if (!event?.month || event.month === month) refresh();
    };
    const handleReconnect = () => refresh();

    socket.on('room-fees:updated', handleRoomFees);
    socket.io?.on('reconnect', handleReconnect);
    window.addEventListener('online', handleReconnect);
    return () => {
      socket.off('room-fees:updated', handleRoomFees);
      socket.io?.off('reconnect', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, [month, refresh]);

  const isCurrent = state.key === month;
  return {
    loading: !isCurrent || state.loading,
    error: isCurrent ? state.error : '',
    data: isCurrent ? state.data : null,
    refresh,
  };
}

/**
 * Hook for a Member to view their month-wise history of issued room fees
 */
export function useMyRoomFeeHistory() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/api/room-fees/me/history', { signal: controller.signal })
      .then((res) => setState({ loading: false, error: '', data: res.data }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: err?.message || 'Unable to load history.', data: null });
        }
      });
    return () => controller.abort();
  }, [version]);

  useEffect(() => {
    const handleRoomFees = () => refresh();
    socket.on('room-fees:updated', handleRoomFees);
    return () => socket.off('room-fees:updated', handleRoomFees);
  }, [refresh]);

  return { loading: state.loading, error: state.error, data: state.data, refresh };
}

/**
 * Hook for Admin to view household summary of room fees for a month
 */
export function useAdminRoomFeeSummary(month) {
  const [state, setState] = useState({ key: null, loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    const controller = new AbortController();
    api.get(`/api/room-fees/summary/${encodeURIComponent(month)}`, { signal: controller.signal })
      .then((res) => setState({ key: month, loading: false, error: '', data: res.data }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ key: month, loading: false, error: err?.message || 'Unable to load summary.', data: null });
        }
      });
    return () => controller.abort();
  }, [month, version]);

  useEffect(() => {
    const handleRoomFees = (event) => {
      if (!event?.month || event.month === month) refresh();
    };
    socket.on('room-fees:updated', handleRoomFees);
    return () => socket.off('room-fees:updated', handleRoomFees);
  }, [month, refresh]);

  const isCurrent = state.key === month;
  return {
    loading: !isCurrent || state.loading,
    error: isCurrent ? state.error : '',
    data: isCurrent ? state.data : null,
    refresh,
  };
}

/**
 * Hook for Admin to view and manage Rooms & Assignments
 */
export function useRooms() {
  const [state, setState] = useState({ loading: true, error: '', rooms: [] });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/api/rooms', { signal: controller.signal })
      .then((res) => setState({ loading: false, error: '', rooms: res.data?.rooms || [] }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: err?.message || 'Unable to load rooms.', rooms: [] });
        }
      });
    return () => controller.abort();
  }, [version]);

  useEffect(() => {
    const handleRoomFees = () => refresh();
    socket.on('room-fees:updated', handleRoomFees);
    return () => socket.off('room-fees:updated', handleRoomFees);
  }, [refresh]);

  return { loading: state.loading, error: state.error, rooms: state.rooms, refresh };
}

/**
 * Hook for Admin to view and manage Fee Plans for all members
 */
export function useMemberFeePlans(members = ['gaurav', 'nikhil', 'devansh']) {
  const [plans, setPlans] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      members.map((id) =>
        api.get(`/api/room-fees/plans/${id}`, { signal: controller.signal })
          .then((res) => ({ memberId: id, plan: res.data?.feePlan || null }))
          .catch(() => ({ memberId: id, plan: null })),
      ),
    )
      .then((results) => {
        const map = {};
        for (const item of results) map[item.memberId] = item.plan;
        setPlans(map);
        setLoading(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err?.message || 'Unable to load fee plans.');
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [members.join(','), version]);

  useEffect(() => {
    const handleRoomFees = () => refresh();
    socket.on('room-fees:updated', handleRoomFees);
    return () => socket.off('room-fees:updated', handleRoomFees);
  }, [refresh]);

  return { loading, error, plans, refresh };
}

/**
 * Hook for Payment Settings (Hostel owner / Admin collector)
 */
export function useRoomPaymentSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/api/room-fees/settings', { signal: controller.signal })
      .then((res) => {
        setSettings(res.data?.settings || null);
        setLoading(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err?.message || 'Unable to load room payment settings.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [version]);

  useEffect(() => {
    const handleRoomFees = () => refresh();
    socket.on('room-fees:updated', handleRoomFees);
    return () => socket.off('room-fees:updated', handleRoomFees);
  }, [refresh]);

  return { loading, error, settings, refresh };
}
