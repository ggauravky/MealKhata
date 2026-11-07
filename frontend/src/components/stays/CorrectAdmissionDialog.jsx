import { AlertCircle, PencilLine } from 'lucide-react';
import { useEffect, useState } from 'react';
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

export function CorrectAdmissionDialog({ open, onOpenChange, stay, onConfirm }) {
  const [rooms, setRooms] = useState([]);
  const [joinedOn, setJoinedOn] = useState('');
  const [roomId, setRoomId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setJoinedOn(stay?.joinedOn || '');
    setRoomId(stay?.initialRoomId || '');
    setReason('');
    setError('');
    api.get('/api/rooms')
      .then((response) => setRooms(response.data || []))
      .catch(() => setRooms([]));
  }, [open, stay]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError('Enter a clear reason for this correction.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onConfirm({ joinedOn, roomId, reason: reason.trim(), expectedRevision: stay.revision });
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to correct this admission.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PencilLine className="h-5 w-5 text-teal-600" /> Correct admission</DialogTitle>
          <DialogDescription>
            Super Admin only. The change is blocked when financial or clearance activity exists and is recorded in the Stay audit history.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="correctJoinedOn">Joining date</Label>
            <Input id="correctJoinedOn" type="date" value={joinedOn} onChange={(event) => setJoinedOn(event.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correctAdmissionRoom">Initial room</Label>
            <select id="correctAdmissionRoom" value={roomId} onChange={(event) => setRoomId(event.target.value)} required className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <option value="">Select room</option>
              {rooms.map((room) => <option key={room.roomId} value={room.roomId}>Room {room.roomNumber}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admissionCorrectionReason">Reason</Label>
            <Input id="admissionCorrectionReason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required />
          </div>
          {error && <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-600"><AlertCircle className="h-4 w-4" />{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting || !joinedOn || !roomId}>{submitting ? 'Savingâ€¦' : 'Save correction'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
