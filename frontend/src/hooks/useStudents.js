import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { mergeStudentManagementRoster, normalizeStudentList } from '../lib/studentContracts.js';

async function loadStudentManagementRoster(signal) {
  const [studentResponse, currentMemberResponse] = await Promise.all([
    api.get('/api/students', { signal }),
    api.get('/api/admin/members', { signal }),
  ]);
  const students = normalizeStudentList(studentResponse.data);
  const currentMembers = Array.isArray(currentMemberResponse.data) ? currentMemberResponse.data : [];
  const currentIds = new Set(currentMembers.map((member) => member?.memberId));
  const historicalMembers = await Promise.all(
    students
      .filter((student) => !currentIds.has(student.studentId))
      .map(async (student) => {
        const response = await api.get(`/api/admin/members/${encodeURIComponent(student.studentId)}`, { signal });
        return response.data;
      }),
  );
  return mergeStudentManagementRoster(students, [...currentMembers, ...historicalMembers]);
}

export function useStudents() {
  const [state, setState] = useState({ loading: true, error: '', data: [] });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadStudentManagementRoster(controller.signal)
      .then((data) => setState({ loading: false, error: '', data }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: error?.message || 'Unable to load students.', data: [] });
        }
      });
    return () => controller.abort();
  }, [version]);

  const runMutation = useCallback(async (method, path, payload) => {
    const response = await api[method](path, payload, { preserveSessionOnUnauthorized: true });
    refresh();
    return response.data;
  }, [refresh]);

  return {
    ...state,
    refresh,
    createStudent: (payload) => runMutation('post', '/api/students', payload),
    updateStudent: (studentId, payload) => runMutation('patch', `/api/students/${encodeURIComponent(studentId)}`, payload),
    archiveStudent: (studentId, payload) => runMutation('post', `/api/students/${encodeURIComponent(studentId)}/archive`, payload),
    reactivateStudent: (studentId, payload) => runMutation('post', `/api/students/${encodeURIComponent(studentId)}/reactivate`, payload),
    provisionAccount: (studentId, payload) => runMutation('post', `/api/admin/members/${encodeURIComponent(studentId)}/provision`, payload),
    changeEmail: (studentId, payload) => runMutation('patch', `/api/admin/members/${encodeURIComponent(studentId)}/email`, payload),
    resetPassword: (studentId, payload) => runMutation('post', `/api/admin/members/${encodeURIComponent(studentId)}/reset-password`, payload),
    setAccountActive: (studentId, active, payload) => runMutation('post', `/api/admin/members/${encodeURIComponent(studentId)}/${active ? 'activate' : 'deactivate'}`, payload),
  };
}
