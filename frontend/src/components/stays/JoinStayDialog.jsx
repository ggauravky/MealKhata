import { AlertCircle, BedDouble, House, PlusCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { ROOMMATES } from '../../lib/constants.js';
import { rupeesToPaise } from '../../lib/money.js';
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

export function JoinStayDialog({
  open,
  onOpenChange,
  onSubmitStay,
  isSuperAdmin = false,
  initialMemberId = null,
}) {
  const [memberId, setMemberId] = useState('gaurav');
  const [joinedOn, setJoinedOn] = useState('');
  const [rooms, setRooms] = useState([]);
  const [initialRoomId, setInitialRoomId] = useState('');
  const [rentRupees, setRentRupees] = useState('');
  const [expectedDepositRupees, setExpectedDepositRupees] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [historicalReason, setHistoricalReason] = useState('');

  useEffect(() => {
    if (!open) return;
    api.get('/api/rooms')
      .then((res) => setRooms(res.data || []))
      .catch(() => setRooms([]));

    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    setMemberId(initialMemberId || 'gaurav');
    setJoinedOn(todayStr);
    setError('');
    setHistoricalReason('');
  }, [initialMemberId, open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!memberId || !joinedOn || !initialRoomId) {
      setError('Please select a resident, joining date, and initial room.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const monthlyFeePaise = rentRupees ? rupeesToPaise(rentRupees) : undefined;
      const expectedDepositPaise = expectedDepositRupees ? rupeesToPaise(expectedDepositRupees) : 0;

      await onSubmitStay({
        memberId,
        joinedOn,
        initialRoomId,
        monthlyFeePaise,
        monthlyRentPaise: monthlyFeePaise,
        expectedDepositPaise,
        historicalReason: historicalReason.trim() || undefined,
      });

      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Failed to register hostel stay.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <House className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            Register Hostel Stay / Admission
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Onboard a resident into the hostel lifecycle. Sets the admission date, room allocation, and expected security deposit.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-2.5 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 py-1">
          <div className="space-y-1">
            <Label htmlFor="stayMember" className="text-xs">
              Resident Member
            </Label>
            <select
              id="stayMember"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              {ROOMMATES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="stayJoinDate" className="text-xs">
              Admission / Joining Date (YYYY-MM-DD)
            </Label>
            <Input
              id="stayJoinDate"
              type="date"
              value={joinedOn}
              onChange={(e) => setJoinedOn(e.target.value)}
              required
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="stayRoom" className="text-xs">
              Initial Room Assignment
            </Label>
            <select
              id="stayRoom"
              value={initialRoomId}
              onChange={(e) => setInitialRoomId(e.target.value)}
              required
              className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="">Select Initial Room</option>
              {rooms.map((r) => (
                <option key={r.roomId} value={r.roomId}>
                  Room {r.roomNumber} ({r.occupancy || 'Standard'}, Cap: {r.capacity})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="stayRent" className="text-xs">
                Monthly Rent (₹, Optional)
              </Label>
              <Input
                id="stayRent"
                type="number"
                placeholder="e.g. 2800"
                value={rentRupees}
                onChange={(e) => setRentRupees(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="stayDeposit" className="text-xs">
                Expected Deposit (₹)
              </Label>
              <Input
                id="stayDeposit"
                type="number"
                placeholder="Enter amount if applicable (e.g. 5000)"
                value={expectedDepositRupees}
                onChange={(e) => setExpectedDepositRupees(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 italic">
            Note: Setting expected deposit records the commitment; receipt of deposit funds must be recorded separately when paid.
          </p>

          {isSuperAdmin && joinedOn && joinedOn < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()) && (
            <div className="space-y-1">
              <Label htmlFor="stayHistoricalReason" className="text-xs">
                Historical admission reason
              </Label>
              <Input
                id="stayHistoricalReason"
                value={historicalReason}
                onChange={(e) => setHistoricalReason(e.target.value)}
                placeholder="Why is this admission being entered now?"
                required
                maxLength={500}
                className="text-xs"
              />
            </div>
          )}

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
              disabled={submitting || !initialRoomId || !joinedOn}
              className="text-xs bg-teal-600 hover:bg-teal-700 text-white"
            >
              {submitting ? 'Creating...' : 'Create Stay'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
