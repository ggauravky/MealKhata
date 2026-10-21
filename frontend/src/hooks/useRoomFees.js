import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import { getIndiaCurrentLogicalMonth } from '../lib/logicalDate.js';
import { mapMemberRoomFeeOverview, roomFeeRequestKey } from '../lib/roomFeeContracts.js';

/**
 * Hook for a Member to view their current month room fee statement & assignment
 */
export function useMyRoomFees(month, memberId = null) {
  const [state, setState] = useState({ key: null, loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    const controller = new AbortController();
    const key = roomFeeRequestKey(memberId, month);
    const query = new URLSearchParams({ month });
    if (memberId) query.set('memberId', memberId);
    api.get(`/api/room-fees/me?${query.toString()}`, { signal: controller.signal })
      .then((res) => setState({ key, loading: false, error: '', data: mapMemberRoomFeeOverview(res.data) }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ key, loading: false, error: err?.message || 'Unable to load room fees.', data: null });
        }
      });
    return () => controller.abort();
  }, [memberId, month, version]);

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

  const isCurrent = state.key === roomFeeRequestKey(memberId, month);
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
export function useMyRoomFeeHistory(memberId = null) {
  const [state, setState] = useState({ key: null, loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const key = memberId || 'self';
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    api.get(`/api/room-fees/me/history${query}`, { signal: controller.signal })
      .then((res) => setState({ key, loading: false, error: '', data: res.data }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ key, loading: false, error: err?.message || 'Unable to load history.', data: null });
        }
      });
    return () => controller.abort();
  }, [memberId, version]);

  useEffect(() => {
    const handleRoomFees = () => refresh();
    socket.on('room-fees:updated', handleRoomFees);
    return () => socket.off('room-fees:updated', handleRoomFees);
  }, [refresh]);

  const isCurrent = state.key === (memberId || 'self');
  return {
    loading: !isCurrent || state.loading,
    error: isCurrent ? state.error : '',
    data: isCurrent ? state.data : null,
    refresh,
  };
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
      .then((res) => {
        const roomsList = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.rooms) ? res.data.rooms : []);
        setState({ loading: false, error: '', rooms: roomsList });
      })
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
export function useMemberFeePlans(members = ['gaurav', 'nikhil', 'devansh'], targetMonth = null) {
  const [plans, setPlans] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [memberErrors, setMemberErrors] = useState({});
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    setMemberErrors({});
    setVersion((v) => v + 1);
  }, []);

  const activeMonth = targetMonth || getIndiaCurrentLogicalMonth();

  useEffect(() => {
    const controller = new AbortController();
    let isCancelled = false;

    Promise.allSettled(
      members.map((id) =>
        api.get(`/api/room-fees/plans/${id}`, { signal: controller.signal })
          .then((res) => {
            const list = Array.isArray(res.data) ? res.data : (res.data?.plans || (res.data?.feePlan ? [res.data.feePlan] : []));
            // Sort by effectiveFromMonth desc
            const sorted = [...list].sort((a, b) => (b.effectiveFromMonth || '').localeCompare(a.effectiveFromMonth || ''));
            // Authoritative plan-selection rules:
            // effectiveFromMonth <= activeMonth AND (effectiveUntilMonth is null OR effectiveUntilMonth >= activeMonth) AND supersededAt is null
            const activePlan = sorted.find((p) =>
              p.effectiveFromMonth <= activeMonth &&
              (!p.effectiveUntilMonth || p.effectiveUntilMonth >= activeMonth) &&
              !p.supersededAt
            ) || null;
            const futurePlan = sorted.find((p) => p.effectiveFromMonth > activeMonth && !p.supersededAt) || null;
            const historicalPlans = sorted.filter((p) =>
              (p.effectiveUntilMonth && p.effectiveUntilMonth < activeMonth) || p.supersededAt
            );
            return {
              memberId: id,
              activePlan,
              futurePlan,
              historicalPlans,
              allPlans: sorted,
              error: null,
            };
          })
          .catch((err) => {
            if (controller.signal.aborted) throw err;
            return {
              memberId: id,
              error: err?.message || 'Failed to load fee plan.',
              activePlan: null,
              futurePlan: null,
              historicalPlans: [],
              allPlans: [],
            };
          }),
      ),
    )
      .then((settled) => {
        if (isCancelled) return;
        const planMap = {};
        const errorMap = {};
        for (const item of settled) {
          if (item.status === 'fulfilled') {
            const val = item.value;
            if (val.error) {
              errorMap[val.memberId] = val.error;
            } else {
              planMap[val.memberId] = val.activePlan
                ? {
                    ...val.activePlan,
                    activePlan: val.activePlan,
                    futurePlan: val.futurePlan,
                    historicalPlans: val.historicalPlans,
                    allPlans: val.allPlans,
                  }
                : {
                    activePlan: null,
                    futurePlan: val.futurePlan,
                    historicalPlans: val.historicalPlans,
                    allPlans: val.allPlans,
                  };
            }
          }
        }
        setPlans(planMap);
        setMemberErrors(errorMap);
        setLoading(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted && !isCancelled) {
          setError(err?.message || 'Unable to load fee plans.');
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [members.join(','), activeMonth, version]);

  useEffect(() => {
    const handleRoomFees = () => refresh();
    socket.on('room-fees:updated', handleRoomFees);
    return () => socket.off('room-fees:updated', handleRoomFees);
  }, [refresh]);

  return { loading, error, memberErrors, plans, refresh };
}

/**
 * Hook for Admin to view Room Fee Payments for a specific month
 */
export function useRoomPayments(month) {
  const [state, setState] = useState({ key: null, loading: true, error: '', payments: [] });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    const controller = new AbortController();
    api.get(`/api/room-fees/payments/${encodeURIComponent(month)}`, { signal: controller.signal })
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.payments || []);
        setState({ key: month, loading: false, error: '', payments: list });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ key: month, loading: false, error: err?.message || 'Unable to load payments.', payments: [] });
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
    payments: isCurrent ? state.payments : [],
    refresh,
  };
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
        setSettings(res.data?.settings ?? res.data ?? null);
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
