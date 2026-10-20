import { AlertCircle, ArrowLeftRight, BedDouble } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatPaise, rupeesToPaise } from '../../lib/money.js';
import { getIndiaTodayLogicalDate } from '../../lib/logicalDate.js';
import { addLogicalMonths } from '../../lib/logicalMonth.js';
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

export function RoomTransferDialog({
  open,
  onOpenChange,
  stay,
  onSubmitTransfer,
}) {
  const [rooms, setRooms] = useState([]);
  const [destinationRoomId, setDestinationRoomId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [newRentRupees, setNewRentRupees] = useState('');
  const [reason, setReason] = useState('');
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load available rooms
  useEffect(() => {
    if (!open) return;
    setLoadingRooms(true);
    api.get('/api/rooms')
      .then((res) => {
        setRooms(res.data || []);
      })
      .catch(() => {
        // Fallback room list
        setRooms([]);
      })
      .finally(() => setLoadingRooms(false));

    // Default effective date to next month's 1st using Asia/Kolkata logical date
    const todayLogical = getIndiaTodayLogicalDate();
    const currentLogicalMonth = todayLogical.slice(0, 7);
    const nextLogicalMonth = addLogicalMonths(currentLogicalMonth, 1);
    setEffectiveDate(`${nextLogicalMonth}-01`);
    setNewRentRupees('');
    setReason('');
    setError('');
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stay?.stayId || !destinationRoomId || !effectiveDate) {
      setError('Please select a destination room and effective date.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const newMonthlyRentPaise = newRentRupees ? rupeesToPaise(newRentRupees) : undefined;
      await onSubmitTransfer(stay.stayId, {
        destinationRoomId,
        effectiveDate,
        newMonthlyRentPaise,
        reason: reason.trim() || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Failed to transfer room.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <ArrowLeftRight className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            Transfer Room
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Transfer resident from their current room to a new room. History is preserved and capacity will be validated.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-2.5 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 py-1">
          <div className="p-2.5 rounded-md bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 flex justify-between">
            <span>Current Room:</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Room {stay?.initialRoomId || 'Assigned Room'}
            </span>
          </div>

          <div className="space-y-1">
            <Label htmlFor="destRoom" className="text-xs">
              Destination Room
            </Label>
            <select
              id="destRoom"
              value={destinationRoomId}
              onChange={(e) => setDestinationRoomId(e.target.value)}
              required
              className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="">Select Room</option>
              {rooms.map((r) => (
                <option key={r.roomId} value={r.roomId}>
                  Room {r.roomNumber} ({r.occupancy || 'Standard'}, Cap: {r.capacity})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="effDate" className="text-xs">
              Effective Date (YYYY-MM-DD)
            </Label>
            <Input
              id="effDate"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              required
              className="text-xs"
            />
            <p className="text-[11px] text-slate-400">
              Transfers on the 1st of a month create clean billing boundaries.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="newRate" className="text-xs">
              New Monthly Rent (₹, Optional override)
            </Label>
            <Input
              id="newRate"
              type="number"
              placeholder="e.g. 3000"
              value={newRentRupees}
              onChange={(e) => setNewRentRupees(e.target.value)}
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="transferReason" className="text-xs">
              Reason for Transfer (Optional)
            </Label>
            <Input
              id="transferReason"
              placeholder="e.g. Resident requested quieter room"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-xs"
            />
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !destinationRoomId}
              className="text-xs bg-teal-600 hover:bg-teal-700 text-white"
            >
              {submitting ? 'Transferring...' : 'Confirm Transfer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
