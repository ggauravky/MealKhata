import { AlertTriangle, RotateCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { Button } from '../ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.jsx';
import { Input } from '../ui/input.jsx';
import { Label } from '../ui/label.jsx';

export function RestoreResidentDialog({ open, onOpenChange, stay, onRestored }) {
  const [rooms, setRooms] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [joinedOn, setJoinedOn] = useState('');
  const [occupancyFromDate, setOccupancyFromDate] = useState('');
  const [roomId, setRoomId] = useState('');
  const [assignmentAction, setAssignmentAction] = useState('REOPEN_EXISTING');
  const [assignmentId, setAssignmentId] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !stay) return;
    setJoinedOn(stay.joinedOn || '');
    setOccupancyFromDate('');
    setRoomId(stay.currentRoomId || stay.initialRoomId || '');
    setAssignmentAction('REOPEN_EXISTING');
    setAssignmentId('');
    setReason('');
    setPreview(null);
    setError('');
    Promise.all([
      api.get('/api/rooms'),
      api.get(`/api/room-fees/assignments/${stay.memberId}`),
    ]).then(([roomResponse, assignmentResponse]) => {
      setRooms(Array.isArray(roomResponse.data) ? roomResponse.data : []);
      setAssignments(Array.isArray(assignmentResponse.data) ? assignmentResponse.data : []);
    }).catch((requestError) => setError(requestError?.message || 'Unable to load room history.'));
  }, [open, stay]);

  const payload = useMemo(() => ({
    joinedOn,
    occupancyFromDate,
    roomId,
    assignmentAction,
    assignmentId: assignmentAction === 'CREATE_NEW' ? null : assignmentId,
    expectedRevision: stay?.revision,
    reason: reason.trim(),
  }), [assignmentAction, assignmentId, joinedOn, occupancyFromDate, reason, roomId, stay?.revision]);

  const clearPreview = () => setPreview(null);

  const handlePreview = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await api.post(`/api/stays/${stay.stayId}/restoration-preview`, payload);
      setPreview(response.data);
    } catch (requestError) {
      setPreview(null);
      setError(requestError?.message || 'Unable to preview resident restoration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestore = async () => {
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/api/stays/${stay.stayId}/restore`, {
        ...payload,
        previewToken: preview.previewToken,
      });
      onOpenChange(false);
      onRestored?.();
    } catch (requestError) {
      setPreview(null);
      setError(requestError?.message || 'Unable to restore this resident. Generate a fresh preview and retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-amber-600" /> Restore resident
          </DialogTitle>
          <DialogDescription>
            Super Admin repair for an incorrect checkout. Existing payments, deposit entries, and clearance snapshots remain immutable.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handlePreview} className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            No records are changed by this preview. Apply is enabled only when the Stay revision, room capacity, and assignment history still match.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="restoreJoinedOn">Correct joining date</Label>
              <Input id="restoreJoinedOn" type="date" value={joinedOn} onChange={(event) => { setJoinedOn(event.target.value); clearPreview(); }} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="restoreOccupancyFrom">Continuous occupancy from</Label>
              <Input id="restoreOccupancyFrom" type="date" value={occupancyFromDate} onChange={(event) => { setOccupancyFromDate(event.target.value); clearPreview(); }} required />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="restoreRoom">Room</Label>
              <select id="restoreRoom" value={roomId} onChange={(event) => { setRoomId(event.target.value); clearPreview(); }} required className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <option value="">Select room</option>
                {rooms.map((room) => <option key={room.roomId} value={room.roomId}>Room {room.roomNumber}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="restoreAssignmentAction">Assignment repair</Label>
              <select id="restoreAssignmentAction" value={assignmentAction} onChange={(event) => { setAssignmentAction(event.target.value); clearPreview(); }} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <option value="REOPEN_EXISTING">Reopen historical assignment</option>
                <option value="LINK_EXISTING">Link an already-active assignment</option>
                <option value="CREATE_NEW">Create a new assignment</option>
              </select>
            </div>
          </div>
          {assignmentAction !== 'CREATE_NEW' && (
            <div className="space-y-1.5">
              <Label htmlFor="restoreAssignment">Room Assignment</Label>
              <select id="restoreAssignment" value={assignmentId} onChange={(event) => { setAssignmentId(event.target.value); clearPreview(); }} required className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <option value="">Select an exact historical assignment</option>
                {assignments.map((assignment) => (
                  <option key={assignment.assignmentId} value={assignment.assignmentId}>
                    {assignment.roomNumber || assignment.roomId}: {assignment.effectiveFromDate || assignment.effectiveFromMonth} to {assignment.effectiveUntilDate || assignment.effectiveUntilMonth || 'present'}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="restoreReason">Audit reason</Label>
            <Input id="restoreReason" value={reason} onChange={(event) => { setReason(event.target.value); clearPreview(); }} maxLength={500} placeholder="Why the prior checkout was incorrect" required />
          </div>

          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          {preview && (
            <section className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/60" aria-label="Restoration preview">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                {preview.canApply ? <ShieldCheck className="h-4 w-4 text-teal-600" /> : <AlertTriangle className="h-4 w-4 text-rose-600" />}
                {preview.canApply ? `${preview.changes.length} exact record changes ready` : 'Conflicts must be resolved'}
              </div>
              {preview.conflicts?.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-rose-700 dark:text-rose-300">
                  {preview.conflicts.map((conflict) => <li key={`${conflict.code}-${conflict.assignmentId || conflict.stayId || ''}`}>{conflict.message}</li>)}
                </ul>
              )}
              <p className="mt-2 text-slate-500">
                Preserved: {preview.preservedFinancialRecords?.depositTransactionCount || 0} deposit entries and {preview.preservedFinancialRecords?.clearanceSnapshotCount || 0} clearance snapshots.
              </p>
            </section>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            {!preview && <Button type="submit" disabled={submitting}>{submitting ? 'Checking…' : 'Preview exact changes'}</Button>}
            {preview && <Button type="button" onClick={handleRestore} disabled={submitting || !preview.canApply} className="bg-amber-600 text-white hover:bg-amber-700">{submitting ? 'Restoring…' : 'Restore resident'}</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
