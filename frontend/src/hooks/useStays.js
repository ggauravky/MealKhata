import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import {
  mapCheckoutReview,
  mapDepositSummary,
  mapLifetimeSummary,
  mapRoomHistory,
  parseMyStayResponse,
} from '../lib/stayContracts.js';

/**
 * Hook for Member to view their current active/pending stay and deposit summary
 */
export function useMyStay() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/api/stays/me', { signal: controller.signal })
      .then((res) => {
        setState({ loading: false, error: '', data: parseMyStayResponse(res) });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: err?.message || 'Unable to load stay information.', data: null });
        }
      });
    return () => controller.abort();
  }, [version]);

  useEffect(() => {
    const handleStayUpdated = () => refresh();
    const handleDepositUpdated = () => refresh();
    const handleClearanceUpdated = () => refresh();
    const handleReconnect = () => refresh();

    socket.on('stay:updated', handleStayUpdated);
    socket.on('deposit:updated', handleDepositUpdated);
    socket.on('clearance:updated', handleClearanceUpdated);
    socket.io?.on('reconnect', handleReconnect);
    window.addEventListener('online', handleReconnect);

    return () => {
      socket.off('stay:updated', handleStayUpdated);
      socket.off('deposit:updated', handleDepositUpdated);
      socket.off('clearance:updated', handleClearanceUpdated);
      socket.io?.off('reconnect', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, [refresh]);

  const requestCheckout = async (payload = {}) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to request checkout.');
    }
    const preferredLeaveDate = payload.preferredLeaveDate || payload.checkoutRequestedFor;
    const reason = payload.reason || payload.checkoutRequestNote;
    const res = await api.post('/api/stays/me/checkout-request', {
      preferredLeaveDate,
      reason,
      checkoutRequestedFor: preferredLeaveDate,
      checkoutRequestNote: reason,
    });
    refresh();
    return res.data;
  };

  const cancelCheckoutRequest = async () => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to cancel checkout request.');
    }
    const res = await api.delete('/api/stays/me/checkout-request');
    refresh();
    return res.data;
  };

  return {
    loading: state.loading,
    error: state.error,
    data: state.data,
    refresh,
    requestCheckout,
    cancelCheckoutRequest,
  };
}

/**
 * Hook for Member to view all their stays (active and historical)
 */
export function useMyStayHistory() {
  const [state, setState] = useState({ loading: true, error: '', data: [] });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/api/stays/me/history', { signal: controller.signal })
      .then((res) => {
        setState({ loading: false, error: '', data: res.data || [] });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: err?.message || 'Unable to load stay history.', data: [] });
        }
      });
    return () => controller.abort();
  }, [version]);

  useEffect(() => {
    const handleStayUpdated = () => refresh();
    socket.on('stay:updated', handleStayUpdated);
    return () => socket.off('stay:updated', handleStayUpdated);
  }, [refresh]);

  return {
    loading: state.loading,
    error: state.error,
    data: state.data,
    refresh,
  };
}

/**
 * Hook for Admin to view and manage all household stays
 */
export function useAdminStays(filter = {}) {
  const [state, setState] = useState({ loading: true, error: '', data: [] });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (filter.status) query.set('status', filter.status);
    if (filter.memberId) query.set('memberId', filter.memberId);
    const qs = query.toString() ? `?${query.toString()}` : '';

    api.get(`/api/stays${qs}`, { signal: controller.signal })
      .then((res) => {
        setState({ loading: false, error: '', data: res.data || [] });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: err?.message || 'Unable to load stays.', data: [] });
        }
      });
    return () => controller.abort();
  }, [version, filter.status, filter.memberId]);

  useEffect(() => {
    const handleStayUpdated = () => refresh();
    const handleDepositUpdated = () => refresh();
    const handleClearanceUpdated = () => refresh();
    const handleReconnect = () => refresh();

    socket.on('stay:updated', handleStayUpdated);
    socket.on('deposit:updated', handleDepositUpdated);
    socket.on('clearance:updated', handleClearanceUpdated);
    socket.io?.on('reconnect', handleReconnect);
    window.addEventListener('online', handleReconnect);

    return () => {
      socket.off('stay:updated', handleStayUpdated);
      socket.off('deposit:updated', handleDepositUpdated);
      socket.off('clearance:updated', handleClearanceUpdated);
      socket.io?.off('reconnect', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, [refresh]);

  const createStay = async (payload) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to register a stay.');
    }
    const res = await api.post('/api/stays', payload);
    refresh();
    return res.data;
  };

  const transferRoom = async (stayId, payload) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to perform room transfers.');
    }
    const res = await api.post(`/api/stays/${stayId}/transfers`, payload);
    refresh();
    return res.data;
  };

  const cancelStay = async (stayId, payload) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to cancel a Stay.');
    }
    const res = await api.post(`/api/stays/${stayId}/cancel`, payload);
    refresh();
    return res.data;
  };

  const correctAdmission = async (stayId, payload) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to correct an admission.');
    }
    const res = await api.post(`/api/stays/${stayId}/correct-admission`, payload);
    refresh();
    return res.data;
  };

  const recordDepositTransaction = async (stayId, payload) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to record deposit transactions.');
    }
    const res = await api.post(`/api/stays/${stayId}/deposit/transactions`, payload);
    refresh();
    return res.data;
  };

  const voidDepositTransaction = async (stayId, transactionId, payload) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to void deposit transactions.');
    }
    const res = await api.post(`/api/stays/${stayId}/deposit/transactions/${transactionId}/void`, payload);
    refresh();
    return res.data;
  };

  const approveCheckoutReview = async (stayId, payload) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to update checkout review.');
    }
    const res = await api.post(`/api/stays/${stayId}/checkout-review`, payload);
    refresh();
    return res.data;
  };

  const finalizeCheckout = async (stayId, payload) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to finalize checkout.');
    }
    const res = await api.post(`/api/stays/${stayId}/finalize-checkout`, payload);
    refresh();
    return res.data;
  };

  const reissueClearance = async (stayId, payload) => {
    if (!navigator.onLine) {
      throw new Error('You are offline. Connect to the internet to reissue clearance.');
    }
    const res = await api.post(`/api/stays/${stayId}/clearance/reissue`, payload);
    refresh();
    return res.data;
  };

  return {
    loading: state.loading,
    error: state.error,
    stays: state.data,
    refresh,
    createStay,
    cancelStay,
    correctAdmission,
    transferRoom,
    recordDepositTransaction,
    voidDepositTransaction,
    approveCheckoutReview,
    finalizeCheckout,
    reissueClearance,
  };
}

/**
 * Hook to fetch full stay details, deposit summary, room history, and clearances
 */
export function useStayDetails(stayId) {
  const [state, setState] = useState({
    loading: true,
    error: '',
    stay: null,
    deposit: null,
    roomHistory: [],
    clearances: [],
  });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!stayId) return undefined;
    const controller = new AbortController();

    Promise.all([
      api.get(`/api/stays/${stayId}`, { signal: controller.signal }),
      api.get(`/api/stays/${stayId}/deposit`, { signal: controller.signal }),
      api.get(`/api/stays/${stayId}/room-history`, { signal: controller.signal }),
      api.get(`/api/stays/${stayId}/clearances`, { signal: controller.signal }).catch(() => ({ data: [] })),
    ])
      .then(([stayRes, depRes, roomRes, clearRes]) => {
        setState({
          loading: false,
          error: '',
          stay: stayRes.data,
          deposit: mapDepositSummary(depRes.data),
          roomHistory: mapRoomHistory(roomRes.data),
          clearances: clearRes.data || [],
        });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState((curr) => ({
            ...curr,
            loading: false,
            error: err?.message || 'Unable to load stay details.',
          }));
        }
      });

    return () => controller.abort();
  }, [stayId, version]);

  useEffect(() => {
    const handleStayUpdated = () => refresh();
    const handleDepositUpdated = () => refresh();
    const handleClearanceUpdated = () => refresh();

    socket.on('stay:updated', handleStayUpdated);
    socket.on('deposit:updated', handleDepositUpdated);
    socket.on('clearance:updated', handleClearanceUpdated);

    return () => {
      socket.off('stay:updated', handleStayUpdated);
      socket.off('deposit:updated', handleDepositUpdated);
      socket.off('clearance:updated', handleClearanceUpdated);
    };
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}

/**
 * Hook to fetch financial review during checkout
 */
export function useStayFinancialReview(stayId) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!stayId) return undefined;
    const controller = new AbortController();

    api.get(`/api/stays/${stayId}/financial-review`, { signal: controller.signal })
      .then((res) => {
        setState({ loading: false, error: '', data: mapCheckoutReview(res.data) });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: err?.message || 'Unable to load financial review.', data: null });
        }
      });

    return () => controller.abort();
  }, [stayId, version]);

  return {
    loading: state.loading,
    error: state.error,
    data: state.data,
    refresh,
  };
}

/**
 * Hook to fetch lifetime summary for a stay
 */
export function useStayLifetimeSummary(stayId) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!stayId) return undefined;
    const controller = new AbortController();

    api.get(`/api/stays/${stayId}/lifetime-summary`, { signal: controller.signal })
      .then((res) => {
        setState({ loading: false, error: '', data: mapLifetimeSummary(res.data) });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: err?.message || 'Unable to load lifetime summary.', data: null });
        }
      });

    return () => controller.abort();
  }, [stayId, version]);

  return {
    loading: state.loading,
    error: state.error,
    data: state.data,
    refresh,
  };
}
