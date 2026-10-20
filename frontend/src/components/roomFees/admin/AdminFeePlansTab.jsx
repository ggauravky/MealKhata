import { BedDouble, CircleDollarSign, Edit, History, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../ui/badge.jsx';
import { Button } from '../../ui/button.jsx';
import { Card, CardContent, CardHeader } from '../../ui/card.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.jsx';
import { Input } from '../../ui/input.jsx';
import { Label } from '../../ui/label.jsx';
import { Select } from '../../ui/select.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.jsx';
import { ROOMMATES } from '../../../lib/constants.js';
import { formatLogicalMonth } from '../../../lib/logicalMonth.js';
import { formatPaise, rupeesToPaise } from '../../../lib/money.js';
import { api } from '../../../lib/api.js';

export function AdminFeePlansTab({ plans = {}, rooms = [], onRefresh, loading = false, error = '' }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyMemberId, setHistoryMemberId] = useState('nikhil');
  const [selectedMemberId, setSelectedMemberId] = useState('nikhil');
  const [rupeesAmount, setRupeesAmount] = useState('2800');
  const [effectiveFromMonth, setEffectiveFromMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [dueDay, setDueDay] = useState('5');
  const [reason, setReason] = useState('Standard monthly hostel room fee');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const openConfigure = (memberId) => {
    setSelectedMemberId(memberId);
    const existing = plans[memberId];
    if (existing) {
      setRupeesAmount(String(Math.floor(existing.amountPaise / 100)));
      setDueDay(String(existing.dueDay || 5));
    } else {
      setRupeesAmount('2500');
      setDueDay('5');
    }
    setFormError('');
    setDialogOpen(true);
  };

  const openHistory = (memberId) => {
    setHistoryMemberId(memberId);
    setHistoryDialogOpen(true);
  };

  const handleSavePlan = async (e) => {
    e.preventDefault();
    setFormError('');
    const amountPaise = rupeesToPaise(rupeesAmount);
    if (!amountPaise || amountPaise <= 0) {
      setFormError('Please enter a valid rupee amount greater than 0.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/api/room-fees/plans', {
        memberId: selectedMemberId,
        amountPaise,
        effectiveFromMonth,
        dueDay: Number(dueDay) || 5,
        reason: reason.trim() || undefined,
      });
      setDialogOpen(false);
      onRefresh();
    } catch (err) {
      setFormError(err.message || 'Failed to save fee plan.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-slate-200 dark:border-slate-800 p-8 text-center">
        <p className="text-xs text-slate-500 dark:text-slate-400">Loading fee plans...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20 p-6 text-center">
        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</p>
        {onRefresh && (
          <Button onClick={onRefresh} size="sm" variant="outline" className="mt-3 text-xs">
            Retry
          </Button>
        )}
      </Card>
    );
  }

  const historyPlans = plans[historyMemberId]?.allPlans || [];
  const historyMemberName = ROOMMATES.find((m) => m.id === historyMemberId)?.name || historyMemberId;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Individual Room Fee Plans
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure independent pricing for each resident. Roommates sharing a room can have different rates.
          </p>
        </div>
      </div>

      <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Monthly Fee</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead>Default Due Day</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROOMMATES.map((roommate) => {
                const plan = plans[roommate.id];
                const hasPlan = Boolean(plan && plan.amountPaise);
                const hasFuture = Boolean(plan?.futurePlan);

                return (
                  <TableRow key={roommate.id}>
                    <TableCell className="font-bold text-slate-900 dark:text-slate-100">
                      {roommate.name}
                    </TableCell>
                    <TableCell>
                      {hasPlan ? (
                        <div>
                          <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                            {formatPaise(plan.amountPaise)}
                          </span>
                          {hasFuture && (
                            <span className="block text-[11px] text-teal-600 dark:text-teal-400 font-medium">
                              Future: {formatPaise(plan.futurePlan.amountPaise)} from {formatLogicalMonth(plan.futurePlan.effectiveFromMonth)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-amber-600 dark:text-amber-400 italic font-medium">
                          Fee not configured
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                      {hasPlan ? formatLogicalMonth(plan.effectiveFromMonth) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                      {hasPlan ? `${plan.dueDay}th of month` : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={hasPlan ? 'taking' : 'warning'} className="text-[10px] py-0">
                        {hasPlan ? 'Active Plan' : 'Unconfigured'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {plan?.allPlans && plan.allPlans.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openHistory(roommate.id)}
                            className="text-xs text-slate-500 hover:text-slate-800"
                            title="View pricing history"
                          >
                            <History className="h-3.5 w-3.5 mr-1" />
                            <span>History</span>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openConfigure(roommate.id)}
                          className="gap-1.5 text-xs font-semibold"
                        >
                          <Edit className="h-3.5 w-3.5" />
                          <span>{hasPlan ? 'Update / Change Rate' : 'Configure Fee'}</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Configure Fee Plan Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              Configure Room Fee Plan — {ROOMMATES.find((m) => m.id === selectedMemberId)?.name}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Individual fee plans take effect from the chosen month without retroactively altering historical bills.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSavePlan} className="space-y-4 pt-2">
            {formError && (
              <div className="p-2.5 rounded bg-red-50 text-red-700 text-xs border border-red-200">
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="feeRupees">Monthly Room Fee (₹) *</Label>
              <Input
                id="feeRupees"
                type="number"
                min="100"
                step="50"
                placeholder="e.g. 2800"
                value={rupeesAmount}
                onChange={(e) => setRupeesAmount(e.target.value)}
                required
              />
              <span className="text-[11px] text-slate-400">
                Stored precisely in integer paise ({rupeesToPaise(rupeesAmount) || 0} paise)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="planFrom">Effective From *</Label>
                <Input
                  id="planFrom"
                  type="month"
                  value={effectiveFromMonth}
                  onChange={(e) => setEffectiveFromMonth(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dueDayInput">Due Day of Month *</Label>
                <Select
                  id="dueDayInput"
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                >
                  <option value="1">1st of month</option>
                  <option value="5">5th of month</option>
                  <option value="7">7th of month</option>
                  <option value="10">10th of month</option>
                  <option value="15">15th of month</option>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason / Pricing Note</Label>
              <Input
                id="reason"
                placeholder="e.g. Double occupancy agreed fee"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? 'Saving Plan...' : 'Save Plan'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-lg w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <History className="h-4 w-4 text-teal-600" />
              <span>Fee Plan History — {historyMemberName}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Immutable historical pricing records. Older rates are preserved for accurate past bills.
            </DialogDescription>
          </DialogHeader>

          <div className="pt-2">
            {historyPlans.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No fee plan history found.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border rounded-lg overflow-hidden">
                {historyPlans.map((hp) => (
                  <div key={hp.feePlanId} className="p-3 text-xs flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {formatPaise(hp.amountPaise)} / month
                      </div>
                      <div className="text-slate-500 text-[11px] mt-0.5">
                        Effective: {formatLogicalMonth(hp.effectiveFromMonth)} {hp.effectiveUntilMonth ? `to ${formatLogicalMonth(hp.effectiveUntilMonth)}` : '(ongoing)'}
                        {hp.reason && ` · Note: ${hp.reason}`}
                      </div>
                    </div>
                    <div>
                      <Badge variant={hp.supersededAt ? 'outline' : 'taking'} className="text-[10px] py-0">
                        {hp.supersededAt ? 'Superseded' : 'Active / Scheduled'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button size="sm" variant="outline" onClick={() => setHistoryDialogOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
