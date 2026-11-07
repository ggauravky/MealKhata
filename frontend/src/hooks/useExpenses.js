import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

/**
 * Hook to fetch and listen to expenses for a specific month with optional category/status filters.
 */
export function useExpenses(month, { category = '', status = '' } = {}) {
  const requestKey = `${month || ''}:${category}:${status}`;
  const [state, setState] = useState({ key: null, loading: true, error: '', data: [] });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    const controller = new AbortController();

    const params = new URLSearchParams({ month });
    if (category) params.set('category', category);
    if (status) params.set('status', status);

    api.get(`/api/expenses?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        setState({ key: requestKey, loading: false, error: '', data: res.data || [] });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ key: requestKey, loading: false, error: err?.message || 'Unable to load expenses.', data: [] });
        }
      });

    return () => controller.abort();
  }, [month, category, status, requestKey, version]);

  useEffect(() => {
    const handleExpensesUpdated = (event) => {
      if (!event?.month || event.month === month) {
        refresh();
      }
    };
    const handleReconnect = () => refresh();

    socket.on('expenses:updated', handleExpensesUpdated);
    socket.io?.on('reconnect', handleReconnect);
    window.addEventListener('online', handleReconnect);

    return () => {
      socket.off('expenses:updated', handleExpensesUpdated);
      socket.io?.off('reconnect', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, [month, refresh]);

  const isCurrent = state.key === requestKey;
  return {
    loading: !isCurrent || state.loading,
    error: isCurrent ? state.error : '',
    data: isCurrent ? state.data : [],
    refresh,
  };
}

/**
 * Hook to fetch and listen to expense summary for a month (Member or Household).
 */
export function useExpenseSummary(month, memberId = null) {
  const [state, setState] = useState({ key: null, loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    const controller = new AbortController();

    const url = `/api/expenses/summary/${encodeURIComponent(month)}${memberId ? `?memberId=${encodeURIComponent(memberId)}` : ''}`;

    api.get(url, { signal: controller.signal })
      .then((res) => {
        setState({ key: `${month}:${memberId || 'all'}`, loading: false, error: '', data: res.data });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({
            key: `${month}:${memberId || 'all'}`,
            loading: false,
            error: err?.message || 'Unable to load summary.',
            data: null,
          });
        }
      });

    return () => controller.abort();
  }, [month, memberId, version]);

  useEffect(() => {
    const handleExpensesUpdated = (event) => {
      if (!event?.month || event.month === month) {
        refresh();
      }
    };
    const handleReconnect = () => refresh();

    socket.on('expenses:updated', handleExpensesUpdated);
    socket.io?.on('reconnect', handleReconnect);
    window.addEventListener('online', handleReconnect);

    return () => {
      socket.off('expenses:updated', handleExpensesUpdated);
      socket.io?.off('reconnect', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, [month, refresh]);

  const expectedKey = `${month}:${memberId || 'all'}`;
  const isCurrent = state.key === expectedKey;
  return {
    loading: !isCurrent || state.loading,
    error: isCurrent ? state.error : '',
    data: isCurrent ? state.data : null,
    refresh,
  };
}

/**
 * Hook to fetch single expense details.
 */
export function useExpenseDetails(expenseId) {
  const [state, setState] = useState({ key: null, loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!expenseId) return undefined;
    const controller = new AbortController();

    api.get(`/api/expenses/${encodeURIComponent(expenseId)}`, { signal: controller.signal })
      .then((res) => {
        setState({ key: expenseId, loading: false, error: '', data: res.data });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ key: expenseId, loading: false, error: err?.message || 'Unable to load expense.', data: null });
        }
      });

    return () => controller.abort();
  }, [expenseId, version]);

  useEffect(() => {
    const handleExpensesUpdated = () => refresh();
    socket.on('expenses:updated', handleExpensesUpdated);
    return () => socket.off('expenses:updated', handleExpensesUpdated);
  }, [refresh]);

  const isCurrent = state.key === expenseId;
  return {
    loading: !isCurrent || state.loading,
    error: isCurrent ? state.error : '',
    data: isCurrent ? state.data : null,
    refresh,
  };
}

/**
 * Hook to fetch reimbursements for a month or expense.
 */
export function useExpenseReimbursements(month, { expenseId = '', includeVoided = false } = {}) {
  const [state, setState] = useState({ key: null, loading: true, error: '', data: [] });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((curr) => ({ ...curr, loading: true, error: '' }));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    const controller = new AbortController();

    const params = new URLSearchParams({ month });
    if (expenseId) params.set('expenseId', expenseId);
    if (includeVoided) params.set('includeVoided', 'true');

    api.get(`/api/expenses/reimbursements?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        setState({ key: `${month}:${expenseId}`, loading: false, error: '', data: res.data || [] });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({
            key: `${month}:${expenseId}`,
            loading: false,
            error: err?.message || 'Unable to load reimbursements.',
            data: [],
          });
        }
      });

    return () => controller.abort();
  }, [month, expenseId, includeVoided, version]);

  useEffect(() => {
    const handleExpensesUpdated = (event) => {
      if (!event?.month || event.month === month) refresh();
    };
    socket.on('expenses:updated', handleExpensesUpdated);
    return () => socket.off('expenses:updated', handleExpensesUpdated);
  }, [month, refresh]);

  const expectedKey = `${month}:${expenseId}`;
  const isCurrent = state.key === expectedKey;
  return {
    loading: !isCurrent || state.loading,
    error: isCurrent ? state.error : '',
    data: isCurrent ? state.data : [],
    refresh,
  };
}
