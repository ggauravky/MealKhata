import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { useAuth } from './useAuth.js';

export function useMemberFinance(month, targetMemberId = null) {
  const { authenticated, role } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFinance = useCallback(async () => {
    if (!month || !authenticated || role === 'viewer') {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const url = targetMemberId
        ? `/api/finance/members/${targetMemberId}/${month}`
        : `/api/finance/me/${month}`;
      const response = await api.get(url);
      if (response && response.data) {
        setData(response.data);
      }
    } catch (err) {
      setError(err?.message || 'Unable to load personal finances.');
    } finally {
      setLoading(false);
    }
  }, [month, targetMemberId, authenticated]);

  useEffect(() => {
    fetchFinance();

    const socket = getSocket();
    if (!socket) return;

    let debounceTimer = null;
    const handleUpdate = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchFinance();
      }, 250);
    };

    socket.on('meal:updated', handleUpdate);
    socket.on('payment:updated', handleUpdate);
    socket.on('settlement:updated', handleUpdate);
    socket.on('room-fees:updated', handleUpdate);
    socket.on('expenses:updated', handleUpdate);

    return () => {
      clearTimeout(debounceTimer);
      socket.off('meal:updated', handleUpdate);
      socket.off('payment:updated', handleUpdate);
      socket.off('settlement:updated', handleUpdate);
      socket.off('room-fees:updated', handleUpdate);
      socket.off('expenses:updated', handleUpdate);
    };
  }, [fetchFinance]);

  return { data, loading, error, refresh: fetchFinance };
}

export function useHouseholdFinance(month) {
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'superadmin';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHousehold = useCallback(async () => {
    if (!month || !isAdmin) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/api/finance/overview/${month}`);
      if (response && response.data) {
        setData(response.data);
      }
    } catch (err) {
      setError(err?.message || 'Unable to load household finances.');
    } finally {
      setLoading(false);
    }
  }, [month, isAdmin]);

  useEffect(() => {
    fetchHousehold();

    const socket = getSocket();
    if (!socket) return;

    let debounceTimer = null;
    const handleUpdate = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchHousehold();
      }, 250);
    };

    socket.on('meal:updated', handleUpdate);
    socket.on('payment:updated', handleUpdate);
    socket.on('settlement:updated', handleUpdate);
    socket.on('room-fees:updated', handleUpdate);
    socket.on('expenses:updated', handleUpdate);

    return () => {
      clearTimeout(debounceTimer);
      socket.off('meal:updated', handleUpdate);
      socket.off('payment:updated', handleUpdate);
      socket.off('settlement:updated', handleUpdate);
      socket.off('room-fees:updated', handleUpdate);
      socket.off('expenses:updated', handleUpdate);
    };
  }, [fetchHousehold]);

  return { data, loading, error, refresh: fetchHousehold };
}

export function useFinance(month, targetMemberId = null) {
  return useMemberFinance(month, targetMemberId);
}
