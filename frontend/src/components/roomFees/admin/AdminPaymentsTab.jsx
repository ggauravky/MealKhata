import { AlertCircle, CheckCircle2, CircleDollarSign, Plus, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
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
import { useRoomPayments } from '../../../hooks/useRoomFees.js';

function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatPaymentTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

export function AdminPaymentsTab({ month, summary, onRefresh, role }) {
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);

  // Dedicated payments ledger hook
  const { payments, loading: paymentsLoading, error: paymentsError, refresh: refreshPayments } = useRoomPayments(month);

  // Record payment form
  const [memberId, setMemberId] = useState('nikhil');
  const [amountRupees, setAmountRupees] = useState('');
  const [method, setMethod] = useState('upi');
  const [reference, setReference] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [recording, setRecording] = useState(false);
  const [formError, setFormError] = useState('');

  // Void payment form
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');

  // Lookup active charge for selected member
  const membersList = Array.isArray(summary?.members) ? summary.members : Object.values(summary?.members || {});
  const selectedMemberSummary = membersList.find((m) => m.memberId === memberId);
  const selectedCharge = selectedMemberSummary?.charge;
  const isChargeEligible = Boolean(selectedCharge && selectedCharge.status !== 'cancelled');
  const remainingAmountPaise = selectedCharge?.remainingAmountPaise ?? 0;
  const isFullyPaid = isChargeEligible && remainingAmountPaise === 0;

  const openRecordDialog = () => {
    const initialMember = 'nikhil';
    setMemberId(initialMember);
    const mSummary = membersList.find((m) => m.memberId === initialMember);
    const rem = mSummary?.charge?.remainingAmountPaise ?? 0;
    setAmountRupees(rem > 0 ? String(Math.floor(rem / 100)) : '');
    setMethod('upi');
    setReference('');
    setFormError('');
    setIdempotencyKey(generateUuid());
    setRecordDialogOpen(true);
  };

  const handleMemberChange = (newMemberId) => {
    setMemberId(newMemberId);
    setFormError('');
    const mSummary = membersList.find((m) => m.memberId === newMemberId);
    const rem = mSummary?.charge?.remainingAmountPaise ?? 0;
    setAmountRupees(rem > 0 ? String(Math.floor(rem / 100)) : '');
  };

  const handleOpenConfirm = (e) => {
    e.preventDefault();
    setFormError('');

    if (!isChargeEligible || !selectedCharge?.chargeId) {
      setFormError(`No active issued room charge found for ${memberId} in ${formatLogicalMonth(month)}. Issue a charge first.`);
      return;
    }

    if (isFullyPaid) {
      setFormError('This room charge is already fully paid.');
      return;
    }

    const paise = rupeesToPaise(amountRupees);
    if (!paise || paise <= 0) {
      setFormError('Please enter a valid rupee amount greater than 0.');
      return;
    }

    if (paise > remainingAmountPaise) {
      setFormError(`Amount cannot exceed remaining balance of ${formatPaise(remainingAmountPaise)}.`);
      return;
    }

    setRecordDialogOpen(false);
    setConfirmDialogOpen(true);
  };

  const handleConfirmRecord = async () => {
    setRecording(true);
    setFormError('');
    try {
      const paise = rupeesToPaise(amountRupees);
      await api.post('/api/room-fees/payments', {
        chargeId: selectedCharge.chargeId,
        memberId,
        month,
        amountPaise: paise,
        method,
        reference: reference.trim() || undefined,
        idempotencyKey,
      });
      setConfirmDialogOpen(false);
      setAmountRupees('');
      setReference('');
      setIdempotencyKey(generateUuid());
      onRefresh();
      refreshPayments();
    } catch (err) {
      setFormError(err.message || 'Failed to record payment.');
      setConfirmDialogOpen(false);
      setRecordDialogOpen(true);
    } finally {
      setRecording(false);
    }
  };

  const openVoidDialog = (payment) => {
    setSelectedPayment(payment);
    setVoidReason('');
    setVoidError('');
    setVoidDialogOpen(true);
  };

  const handleVoidPayment = async (e) => {
    e.preventDefault();
    if (!selectedPayment) return;
    setVoidError('');
    if (!voidReason.trim()) {
      setVoidError('A mandatory reason is required to void a payment.');
      return;
    }

    setVoiding(true);
    try {
      await api.post(`/api/room-fees/payments/${selectedPayment.roomPaymentId}/void`, {
        reason: voidReason.trim(),
      });
      setVoidDialogOpen(false);
      onRefresh();
      refreshPayments();
    } catch (err) {
      setVoidError(err.message || 'Failed to void payment.');
    } finally {
      setVoiding(false);
    }
  };

  const selectedMemberName = ROOMMATES.find((m) => m.id === memberId)?.name || memberId;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Room Fee Payments — {formatLogicalMonth(month)}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Record confirmed room fee receipts. Partial payments, multiple payments, and immutable audit tracking supported.
          </p>
        </div>
        <div>
          <Button
            size="sm"
            onClick={openRecordDialog}
            className="gap-1.5 text-xs font-semibold"
          >
            <Plus className="h-4 w-4" />
            <span>Record Room Payment</span>
          </Button>
        </div>
      </div>

      {paymentsError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{paymentsError}</span>
          </div>
          <Button size="sm" variant="outline" onClick={refreshPayments} className="h-7 text-xs">
            Retry
          </Button>
        </div>
      )}

      {/* Payments Ledger Table */}
      <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
        <CardContent className="p-0">
          {paymentsLoading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading payments ledger...</div>
          ) : payments.length === 0 ? (
            <div className="p-8 text-center">
              <CircleDollarSign className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                No room payments recorded
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Payments recorded for {formatLogicalMonth(month)} will appear in this dedicated ledger.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resident</TableHead>
                  <TableHead>Charge / Month</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference / Details</TableHead>
                  <TableHead>Recorded At</TableHead>
                  <TableHead>Status</TableHead>
                  {role === 'superadmin' && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => {
                  const roommate = ROOMMATES.find((m) => m.id === payment.memberId);
                  const isVoided = payment.status === 'voided';

                  return (
                    <TableRow key={payment.roomPaymentId} className={isVoided ? 'opacity-50' : ''}>
                      <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                        {roommate?.name || payment.memberId}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 font-mono">
                        {payment.month}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`font-bold ${
                            isVoided ? 'line-through text-slate-400' : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {formatPaise(payment.amountPaise)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-mono uppercase bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                          {payment.method}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                        {payment.reference ? (
                          <span className="font-mono">{payment.reference}</span>
                        ) : (
                          '—'
                        )}
                        {isVoided && payment.voidReason && (
                          <div className="text-red-600 font-normal mt-0.5">
                            Reason: {payment.voidReason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatPaymentTime(payment.recordedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isVoided ? 'destructive' : 'taking'} className="text-[10px] py-0">
                          {isVoided ? 'Voided' : 'Recorded'}
                        </Badge>
                      </TableCell>
                      {role === 'superadmin' && (
                        <TableCell className="text-right">
                          {!isVoided && (
                            <Button
                              variant="ghost"
                              size="compact"
                              onClick={() => openVoidDialog(payment)}
                              className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              Void
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Record Payment Form Dialog */}
      <Dialog open={recordDialogOpen} onOpenChange={setRecordDialogOpen}>
        <DialogContent className="max-w-md w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              Record Room Fee Payment
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Record a verified payment received from a resident against their issued charge.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleOpenConfirm} className="space-y-4 pt-2">
            {formError && (
              <div className="p-2.5 rounded bg-red-50 text-red-700 text-xs border border-red-200">
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="payMember">Member *</Label>
              <Select
                id="payMember"
                value={memberId}
                onChange={(e) => handleMemberChange(e.target.value)}
              >
                {ROOMMATES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Charge status card */}
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Charge for {formatLogicalMonth(month)}:</span>
                <span className="font-semibold">
                  {selectedCharge ? (
                    <Badge variant={selectedCharge.status === 'cancelled' ? 'outline' : 'secondary'} className="text-[10px] py-0">
                      {selectedCharge.status === 'cancelled' ? 'Cancelled' : selectedCharge.paymentStatus}
                    </Badge>
                  ) : (
                    <span className="text-amber-600 font-medium">Not issued</span>
                  )}
                </span>
              </div>
              {selectedCharge && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Total Billed:</span>
                    <span className="font-bold">{formatPaise(selectedCharge.finalBillAmountPaise)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Already Paid:</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">{formatPaise(selectedCharge.paidAmountPaise)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t pt-1 border-slate-200 dark:border-slate-700 font-bold">
                    <span>Remaining Due:</span>
                    <span className={remainingAmountPaise > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                      {formatPaise(remainingAmountPaise)}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payAmount">Amount Received (₹) *</Label>
              <Input
                id="payAmount"
                type="number"
                min="10"
                step="10"
                placeholder="e.g. 1000"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                disabled={!isChargeEligible || isFullyPaid}
                required
              />
              {remainingAmountPaise > 0 && (
                <span className="text-[11px] text-slate-400 block">
                  Maximum payable: {formatPaise(remainingAmountPaise)}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payMethod">Payment Method *</Label>
              <Select
                id="payMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                disabled={!isChargeEligible || isFullyPaid}
              >
                <option value="upi">UPI (GPay / PhonePe / Paytm)</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer (IMPS / NEFT)</option>
                <option value="other">Other</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payRef">Transaction Reference / UTR (optional)</Label>
              <Input
                id="payRef"
                placeholder="e.g. UPI Ref / Cash receipt notes"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                disabled={!isChargeEligible || isFullyPaid}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRecordDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!isChargeEligible || isFullyPaid}>
                Next: Confirm Payment
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="max-w-md w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-teal-600" />
              <span>Confirm Payment Entry</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Record <strong>₹{amountRupees}</strong> for <strong>{selectedMemberName}</strong>'s {formatLogicalMonth(month)} room fee?
            </p>

            <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded border border-slate-200/80 dark:border-slate-800 text-xs space-y-1">
              <div>Method: <strong className="uppercase font-mono">{method}</strong></div>
              {reference && <div>Reference: <span className="font-mono">{reference}</span></div>}
              <div>Charge ID: <span className="font-mono text-[10px] text-slate-500">{selectedCharge?.chargeId}</span></div>
              <div>Month: <strong>{month}</strong></div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirmDialogOpen(false);
                  setRecordDialogOpen(true);
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirmRecord}
                disabled={recording}
              >
                {recording ? 'Recording...' : 'Record Payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Super Admin Void Payment Dialog */}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent className="max-w-md w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-red-600 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              <span>Void Room Payment (Super Admin)</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              The payment record will be marked void and preserved in the audit log.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleVoidPayment} className="space-y-4 pt-2">
            {voidError && (
              <div className="p-2.5 rounded bg-red-50 text-red-700 text-xs border border-red-200">
                {voidError}
              </div>
            )}

            {selectedPayment && (
              <div className="p-3 bg-slate-50 rounded border text-xs">
                <div>Resident: <strong>{ROOMMATES.find((m) => m.id === selectedPayment.memberId)?.name || selectedPayment.memberId}</strong></div>
                <div>Amount: <strong>{formatPaise(selectedPayment.amountPaise)}</strong></div>
                <div>Recorded: {formatPaymentTime(selectedPayment.recordedAt)}</div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="voidReasonInput">Mandatory Void Reason *</Label>
              <Input
                id="voidReasonInput"
                placeholder="e.g. Duplicate entry by administrator"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setVoidDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" size="sm" disabled={voiding}>
                {voiding ? 'Voiding...' : 'Void Payment'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
