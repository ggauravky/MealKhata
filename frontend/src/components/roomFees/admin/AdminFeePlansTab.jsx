import { AlertCircle, AlertTriangle, Edit, History, Plus, RefreshCw, Scale, ShieldCheck, Trash2 } from 'lucide-react';
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
import { getIndiaCurrentLogicalMonth } from '../../../lib/logicalDate.js';

export function AdminFeePlansTab({
  plans = {},
  rooms = [],
  onRefresh,
  loading = false,
  error = '',
  memberErrors = {},
  targetMonth = null,
  role = 'admin',
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyMemberId, setHistoryMemberId] = useState('nikhil');
  const [selectedMemberId, setSelectedMemberId] = useState('nikhil');
  const [rupeesAmount, setRupeesAmount] = useState('2800');
  const [effectiveFromMonth, setEffectiveFromMonth] = useState(() => targetMonth || getIndiaCurrentLogicalMonth());
  const [dueDay, setDueDay] = useState('5');
  const [reason, setReason] = useState('Standard monthly hostel room fee');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileMemberId, setReconcileMemberId] = useState('gaurav');
  const [reconcileSchedule, setReconcileSchedule] = useState([]);
  const [reconcileReason, setReconcileReason] = useState('');
  const [reconcilePreview, setReconcilePreview] = useState(null);
  const [reconcileError, setReconcileError] = useState('');
  const [reconcileSubmitting, setReconcileSubmitting] = useState(false);

  const openConfigure = (memberId) => {
    setSelectedMemberId(memberId);
    const existing = plans[memberId]?.activePlan || plans[memberId];
    if (existing && existing.amountPaise) {
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

  const openReconciliation = (memberId) => {
    const current = (plans[memberId]?.allPlans || [])
      .filter((plan) => !plan.supersededAt)
      .sort((a, b) => a.effectiveFromMonth.localeCompare(b.effectiveFromMonth));
    setReconcileMemberId(memberId);
    setReconcileSchedule((current.length ? current : [{
      effectiveFromMonth: targetMonth || getIndiaCurrentLogicalMonth(),
      effectiveUntilMonth: '',
      amountPaise: 0,
      dueDay: 5,
    }]).map((plan) => ({
      effectiveFromMonth: plan.effectiveFromMonth,
      effectiveUntilMonth: plan.effectiveUntilMonth || '',
      rupeesAmount: plan.amountPaise ? String(plan.amountPaise / 100) : '',
      dueDay: String(plan.dueDay || 5),
    })));
    setReconcileReason('');
    setReconcilePreview(null);
    setReconcileError('');
    setReconcileOpen(true);
  };

  const updateReconcilePeriod = (index, key, value) => {
    setReconcileSchedule((periods) => periods.map((period, periodIndex) => (
      periodIndex === index ? { ...period, [key]: value } : period
    )));
    setReconcilePreview(null);
  };

  const reconciliationPayload = () => ({
    schedule: reconcileSchedule.map((period) => ({
      effectiveFromMonth: period.effectiveFromMonth,
      effectiveUntilMonth: period.effectiveUntilMonth || null,
      amountPaise: rupeesToPaise(period.rupeesAmount),
      dueDay: Number(period.dueDay),
    })),
    reason: reconcileReason.trim(),
  });

  const handleReconciliationPreview = async (event) => {
    event.preventDefault();
    setReconcileSubmitting(true);
    setReconcileError('');
    try {
      const response = await api.post(`/api/room-fees/plans/${reconcileMemberId}/reconciliation-preview`, reconciliationPayload());
      setReconcilePreview(response.data);
    } catch (requestError) {
      setReconcilePreview(null);
      setReconcileError(requestError?.message || 'Unable to preview Fee Plan reconciliation.');
    } finally {
      setReconcileSubmitting(false);
    }
  };

  const handleReconcile = async () => {
    setReconcileSubmitting(true);
    setReconcileError('');
    try {
      await api.post(`/api/room-fees/plans/${reconcileMemberId}/reconcile`, {
        ...reconciliationPayload(),
        previewToken: reconcilePreview.previewToken,
      });
      setReconcileOpen(false);
      onRefresh();
    } catch (requestError) {
      setReconcilePreview(null);
      setReconcileError(requestError?.message || 'Unable to reconcile Fee Plans. Generate a fresh preview.');
    } finally {
      setReconcileSubmitting(false);
    }
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
                const memberErr = memberErrors[roommate.id];
                const activePlan = plan?.activePlan;
                const futurePlan = plan?.futurePlan;
                const hasActive = Boolean(activePlan && activePlan.amountPaise);
                const hasFuture = Boolean(futurePlan && futurePlan.amountPaise);
                const hasHistorical = Boolean(plan?.allPlans && plan.allPlans.length > 0);

                return (
                  <TableRow key={roommate.id}>
                    <TableCell className="font-bold text-slate-900 dark:text-slate-100">
                      {roommate.name}
                    </TableCell>
                    <TableCell>
                      {memberErr ? (
                        <div className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 font-medium">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>{memberErr}</span>
                        </div>
                      ) : hasActive ? (
                        <div>
                          <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                            {formatPaise(activePlan.amountPaise)}
                          </span>
                          {hasFuture && (
                            <span className="block text-[11px] text-teal-600 dark:text-teal-400 font-medium">
                              Future: {formatPaise(futurePlan.amountPaise)} from {formatLogicalMonth(futurePlan.effectiveFromMonth)}
                            </span>
                          )}
                        </div>
                      ) : hasFuture ? (
                        <div>
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Scheduled: {formatPaise(futurePlan.amountPaise)}
                          </span>
                          <span className="block text-[11px] text-teal-600 dark:text-teal-400 font-medium">
                            Starts {formatLogicalMonth(futurePlan.effectiveFromMonth)}
                          </span>
                        </div>
                      ) : hasHistorical ? (
                        <div>
                          <span className="text-xs text-slate-500 italic">
                            Prior rate: {formatPaise(plan.allPlans[0].amountPaise)}
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            Ended {plan.allPlans[0].effectiveUntilMonth ? formatLogicalMonth(plan.allPlans[0].effectiveUntilMonth) : 'previously'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-amber-600 dark:text-amber-400 italic font-medium">
                          Fee not configured
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                      {memberErr ? '—' : hasActive ? formatLogicalMonth(activePlan.effectiveFromMonth) : hasFuture ? formatLogicalMonth(futurePlan.effectiveFromMonth) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                      {memberErr ? '—' : hasActive ? `${activePlan.dueDay}th of month` : hasFuture ? `${futurePlan.dueDay}th of month` : '—'}
                    </TableCell>
                    <TableCell>
                      {memberErr ? (
                        <Badge variant="destructive" className="text-[10px] py-0">
                          Load Failed
                        </Badge>
                      ) : hasActive ? (
                        <Badge variant="taking" className="text-[10px] py-0">
                          Active Plan
                        </Badge>
                      ) : hasFuture ? (
                        <Badge variant="outline" className="text-[10px] py-0 border-teal-500 text-teal-700 dark:text-teal-300">
                          Future Scheduled
                        </Badge>
                      ) : hasHistorical ? (
                        <Badge variant="secondary" className="text-[10px] py-0">
                          Historical Only
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-[10px] py-0">
                          No Active Plan
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {memberErr && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={onRefresh}
                            className="text-xs text-rose-600 hover:text-rose-800"
                            title="Retry loading plan"
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1" />
                            <span>Retry</span>
                          </Button>
                        )}
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
                          <span>{hasActive ? 'Update / Change Rate' : 'Configure Fee'}</span>
                        </Button>
                        {role === 'superadmin' && hasHistorical && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReconciliation(roommate.id)}
                            className="gap-1.5 text-xs font-semibold border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
                          >
                            <Scale className="h-3.5 w-3.5" />
                            <span>Reconcile history</span>
                          </Button>
                        )}
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

      <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}>
        <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
              <Scale className="h-4 w-4 text-amber-600" />
              Reconcile Fee Plan history — {ROOMMATES.find((member) => member.id === reconcileMemberId)?.name}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Enter the verified schedule. Existing plans remain in history; only their active status changes. Issued charges remain linked to their original plans.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleReconciliationPreview} className="space-y-4 pt-2">
            <div className="space-y-2">
              {reconcileSchedule.map((period, index) => (
                <div key={index} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_1fr_80px_auto] dark:border-slate-800">
                  <div className="space-y-1">
                    <Label htmlFor={`reconcileFrom-${index}`}>From</Label>
                    <Input id={`reconcileFrom-${index}`} type="month" value={period.effectiveFromMonth} onChange={(event) => updateReconcilePeriod(index, 'effectiveFromMonth', event.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`reconcileUntil-${index}`}>Until</Label>
                    <Input id={`reconcileUntil-${index}`} type="month" value={period.effectiveUntilMonth} onChange={(event) => updateReconcilePeriod(index, 'effectiveUntilMonth', event.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`reconcileAmount-${index}`}>Monthly ₹</Label>
                    <Input id={`reconcileAmount-${index}`} type="number" min="1" step="1" value={period.rupeesAmount} onChange={(event) => updateReconcilePeriod(index, 'rupeesAmount', event.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`reconcileDue-${index}`}>Due</Label>
                    <Input id={`reconcileDue-${index}`} type="number" min="1" max="28" value={period.dueDay} onChange={(event) => updateReconcilePeriod(index, 'dueDay', event.target.value)} required />
                  </div>
                  <Button type="button" variant="ghost" size="sm" aria-label="Remove period" disabled={reconcileSchedule.length === 1} onClick={() => { setReconcileSchedule((periods) => periods.filter((_, itemIndex) => itemIndex !== index)); setReconcilePreview(null); }} className="self-end text-rose-600">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => { setReconcileSchedule((periods) => [...periods, { effectiveFromMonth: '', effectiveUntilMonth: '', rupeesAmount: '', dueDay: '5' }]); setReconcilePreview(null); }}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add schedule period
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reconcileReason">Audit reason</Label>
              <Input id="reconcileReason" value={reconcileReason} onChange={(event) => { setReconcileReason(event.target.value); setReconcilePreview(null); }} maxLength={500} placeholder="Source and reason for the verified schedule" required />
            </div>

            {reconcileError && <p role="alert" className="text-xs text-rose-600">{reconcileError}</p>}
            {reconcilePreview && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/60">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  {reconcilePreview.canApply ? <ShieldCheck className="h-4 w-4 text-teal-600" /> : <AlertTriangle className="h-4 w-4 text-rose-600" />}
                  {reconcilePreview.changes?.supersedePlanIds?.length || 0} existing plans will be superseded; {reconcilePreview.proposedSchedule?.length || 0} verified periods will be created.
                </div>
                <p className="mt-2 text-slate-500">Detected {reconcilePreview.overlappingPairs?.length || 0} legacy overlap pairs and {reconcilePreview.referencedPlans?.length || 0} plans referenced by issued charges.</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setReconcileOpen(false)} disabled={reconcileSubmitting}>Cancel</Button>
              {!reconcilePreview && <Button type="submit" size="sm" disabled={reconcileSubmitting}>{reconcileSubmitting ? 'Checking…' : 'Preview reconciliation'}</Button>}
              {reconcilePreview && <Button type="button" size="sm" onClick={handleReconcile} disabled={reconcileSubmitting || !reconcilePreview.canApply} className="bg-amber-600 text-white hover:bg-amber-700">{reconcileSubmitting ? 'Applying…' : 'Apply verified schedule'}</Button>}
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
