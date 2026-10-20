import { AlertCircle, Calendar, CheckCircle2, DollarSign, Edit3, Send, Sparkles } from 'lucide-react';
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

export function AdminMonthlyChargesTab({ month, summary, onRefresh, role, loading = false, error = '' }) {
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [issueConfirmOpen, setIssueConfirmOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueResult, setIssueResult] = useState('');

  // Adjustment state (Super Admin)
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustCharge, setAdjustCharge] = useState(null);
  const [adjustAmountRupees, setAdjustAmountRupees] = useState('');
  const [adjustType, setAdjustType] = useState('discount'); // discount (-) or addition (+)
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  const membersList = Array.isArray(summary?.members) ? summary.members : Object.values(summary?.members || {});
  const membersMap = new Map(membersList.map((m) => [m.memberId, m]));

  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    setIssueResult('');
    try {
      const res = await api.post('/api/room-fees/charges/preview', { month });
      setPreviewData(res.data);
      setIssueConfirmOpen(true);
    } catch (err) {
      setPreviewError(err.message || 'Failed to preview room charges.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleIssue = async () => {
    setIssuing(true);
    setPreviewError('');
    try {
      const res = await api.post('/api/room-fees/charges/issue', { month });
      setIssueConfirmOpen(false);
      setIssueResult(`Successfully issued ${res.data?.issuedCount || 0} room charges for ${formatLogicalMonth(month)}.`);
      onRefresh();
    } catch (err) {
      setPreviewError(err.message || 'Failed to issue room charges.');
    } finally {
      setIssuing(false);
    }
  };

  const openAdjustment = (memberData) => {
    if (!memberData?.charge) return;
    setAdjustCharge(memberData.charge);
    setAdjustAmountRupees('');
    setAdjustType('discount');
    setAdjustReason('');
    setAdjustError('');
    setAdjustDialogOpen(true);
  };

  const handleSaveAdjustment = async (e) => {
    e.preventDefault();
    if (!adjustCharge) return;
    setAdjustError('');
    const paise = rupeesToPaise(adjustAmountRupees);
    if (!paise || paise <= 0) {
      setAdjustError('Please enter a valid adjustment amount.');
      return;
    }
    const signedPaise = adjustType === 'discount' ? -paise : paise;

    setAdjusting(true);
    try {
      await api.post(`/api/room-fees/charges/${adjustCharge.chargeId}/adjustments`, {
        amountPaise: signedPaise,
        reason: adjustReason.trim(),
      });
      setAdjustDialogOpen(false);
      onRefresh();
    } catch (err) {
      setAdjustError(err.message || 'Failed to record adjustment.');
    } finally {
      setAdjusting(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-slate-200 dark:border-slate-800 p-8 text-center">
        <p className="text-xs text-slate-500 dark:text-slate-400">Loading monthly charges...</p>
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

  const previewMembers = previewData?.members || [];
  const issuableCount = previewMembers.filter((m) => m.status === 'ready_to_issue').length;
  const alreadyIssuedCount = previewMembers.filter((m) => m.status === 'already_issued').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Monthly Room Charges — {formatLogicalMonth(month)}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Review proposed member charges based on active fee plans and explicitly issue payable charges.
          </p>
        </div>
        <div>
          <Button
            size="sm"
            onClick={handlePreview}
            disabled={previewLoading}
            className="gap-1.5 text-xs font-semibold"
          >
            <Send className="h-4 w-4" />
            <span>{previewLoading ? 'Loading Preview...' : 'Preview & Issue Charges'}</span>
          </Button>
        </div>
      </div>

      {issueResult && (
        <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
          <span>{issueResult}</span>
        </div>
      )}

      {previewError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          <span>{previewError}</span>
        </div>
      )}

      {/* Charges Table */}
      <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Base Fee</TableHead>
                <TableHead>Adjustments</TableHead>
                <TableHead>Effective Bill</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Charge Status</TableHead>
                {role === 'superadmin' && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROOMMATES.map((roommate) => {
                const memberData = membersMap.get(roommate.id);
                const charge = memberData?.charge;
                const isIssued = Boolean(charge && charge.status !== 'cancelled');
                const roomInfo = memberData?.room;
                const adjustments = charge?.adjustments || [];
                const adjSum = adjustments.reduce((acc, a) => acc + a.amountPaise, 0);

                const baseAmountPaise = charge?.baseAmountPaise ?? 0;
                const finalBillAmountPaise = charge?.finalBillAmountPaise ?? memberData?.effectiveChargePaise ?? 0;
                const paidAmountPaise = charge?.paidAmountPaise ?? memberData?.paidPaise ?? 0;
                const remainingAmountPaise = charge?.remainingAmountPaise ?? memberData?.remainingPaise ?? 0;

                return (
                  <TableRow key={roommate.id}>
                    <TableCell className="font-bold text-slate-900 dark:text-slate-100">
                      {roommate.name}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                      {roomInfo ? `Room ${roomInfo.roomNumber}` : '—'}
                    </TableCell>
                    <TableCell>
                      {isIssued ? formatPaise(baseAmountPaise) : (
                        <span className="text-xs text-slate-400 italic">Not issued</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {adjustments.length > 0 ? (
                        <span className={adjSum >= 0 ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'}>
                          {adjSum >= 0 ? `+${formatPaise(adjSum)}` : `-${formatPaise(Math.abs(adjSum))}`}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-bold text-slate-900 dark:text-slate-100">
                      {isIssued ? formatPaise(finalBillAmountPaise) : '—'}
                    </TableCell>
                    <TableCell className="text-emerald-700 dark:text-emerald-400 font-medium">
                      {isIssued ? formatPaise(paidAmountPaise) : '—'}
                    </TableCell>
                    <TableCell className="font-bold text-amber-700 dark:text-amber-400">
                      {isIssued ? formatPaise(remainingAmountPaise) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isIssued ? 'taking' : 'outline'} className="text-[10px] py-0">
                        {isIssued ? (charge.paymentStatus || 'Issued') : 'Unissued'}
                      </Badge>
                    </TableCell>
                    {role === 'superadmin' && (
                      <TableCell className="text-right">
                        {isIssued && (
                          <Button
                            variant="ghost"
                            size="compact"
                            onClick={() => openAdjustment(memberData)}
                            className="text-xs text-teal-700 hover:text-teal-800"
                          >
                            <Edit3 className="h-3.5 w-3.5 mr-1" />
                            <span>Adjust</span>
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Preview & Issue Confirmation Dialog */}
      <Dialog open={issueConfirmOpen} onOpenChange={setIssueConfirmOpen}>
        <DialogContent className="max-w-xl w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              Review Proposed Room Charges — {formatLogicalMonth(month)}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Confirm issuing monthly charges based on each resident's individual fee plan.
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3 border border-slate-200/80 dark:border-slate-800">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Monthly Fee</TableHead>
                      <TableHead>Status & Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewMembers.map((item) => (
                      <TableRow key={item.memberId}>
                        <TableCell className="font-semibold">{item.memberName}</TableCell>
                        <TableCell>{item.roomNumber ? `Room ${item.roomNumber}` : '—'}</TableCell>
                        <TableCell className="font-bold">
                          {item.amountPaise ? formatPaise(item.amountPaise) : (
                            <span className="text-xs text-amber-600 font-normal">No rate</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.status === 'ready_to_issue' && (
                            <Badge variant="taking" className="text-[10px] py-0">
                              Ready to issue
                            </Badge>
                          )}
                          {item.status === 'already_issued' && (
                            <Badge variant="outline" className="text-[10px] py-0 text-slate-600">
                              Already issued
                            </Badge>
                          )}
                          {item.status === 'blocked_missing_room' && (
                            <span className="text-[11px] text-amber-600 font-medium">
                              Missing room assignment
                            </span>
                          )}
                          {item.status === 'blocked_missing_fee_plan' && (
                            <span className="text-[11px] text-amber-600 font-medium">
                              Fee not configured
                            </span>
                          )}
                          {item.blockingReason && item.status !== 'ready_to_issue' && (
                            <span className="block text-[10px] text-slate-400 mt-0.5">
                              {item.blockingReason}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-bold bg-white dark:bg-slate-950">
                      <TableCell colSpan={2}>Total Proposed Charges</TableCell>
                      <TableCell colSpan={2} className="text-teal-700 dark:text-teal-400 font-mono text-base">
                        {formatPaise(previewData.totalProposedPaise || 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {alreadyIssuedCount > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded border border-amber-200">
                  Notice: {alreadyIssuedCount} member charge(s) already issued for this month and will not be duplicated.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setIssueConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleIssue}
                  disabled={issuing || !previewData.canIssue || issuableCount === 0}
                  className="gap-1.5"
                >
                  <Send className="h-4 w-4" />
                  <span>{issuing ? 'Issuing...' : `Issue ${issuableCount} Room Fee${issuableCount === 1 ? '' : 's'}`}</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Super Admin Adjustment Dialog */}
      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent className="max-w-md w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              Adjust Room Charge (Super Admin)
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Apply an auditable discount or additional surcharge to this issued charge.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveAdjustment} className="space-y-4 pt-2">
            {adjustError && (
              <div className="p-2.5 rounded bg-red-50 text-red-700 text-xs border border-red-200">
                {adjustError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Adjustment Type *</Label>
              <Select
                value={adjustType}
                onChange={(e) => setAdjustType(e.target.value)}
              >
                <option value="discount">Approved Discount (-)</option>
                <option value="addition">Additional Surcharge (+)</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adjustRupees">Amount (₹) *</Label>
              <Input
                id="adjustRupees"
                type="number"
                min="10"
                step="10"
                placeholder="e.g. 300"
                value={adjustAmountRupees}
                onChange={(e) => setAdjustAmountRupees(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adjReason">Auditable Reason *</Label>
              <Input
                id="adjReason"
                placeholder="e.g. Mid-month maintenance concession"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAdjustDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={adjusting}>
                {adjusting ? 'Saving...' : 'Apply Adjustment'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
