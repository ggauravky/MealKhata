import { BedDouble, Calendar, CheckCircle2, CircleDollarSign, Clock, ShieldCheck, X } from 'lucide-react';
import { Badge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.jsx';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { formatPaise } from '../../lib/money.js';

function formatPaymentDate(dateStr) {
  if (!dateStr) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(dateStr));
}

export function RoomFeeMonthDetailsDialog({ open, onClose, statement, room, month }) {
  if (!statement) return null;

  const {
    charge,
    payments = [],
    effectiveChargePaise = 0,
    paidPaise = 0,
    remainingPaise = 0,
    overpaidPaise = 0,
    status,
  } = statement;

  const isIssued = Boolean(charge);
  const activePayments = payments.filter((p) => p.status !== 'voided');
  const voidedPayments = payments.filter((p) => p.status === 'voided');

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="max-w-md w-full p-6 space-y-4">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <BedDouble className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <span>{formatLogicalMonth(month)} Details</span>
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            {room?.roomNumber ? `Room ${room.roomNumber}` : 'Hostel Stay'} · Breakdown of charges and payments
          </DialogDescription>
        </DialogHeader>

        {/* Charge Overview Card */}
        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-4 border border-slate-200/80 dark:border-slate-800 space-y-2.5 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-slate-500 dark:text-slate-400">Status</span>
            <Badge variant={status === 'paid' ? 'taking' : status === 'partial' ? 'warning' : 'secondary'} className="text-[11px] py-0 px-2">
              {status}
            </Badge>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-500 dark:text-slate-400">Base Room Fee</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {charge ? formatPaise(charge.baseAmountPaise) : '—'}
            </span>
          </div>

          {charge?.adjustments && charge.adjustments.length > 0 && (
            <div className="border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Adjustments:</span>
              {charge.adjustments.map((adj, idx) => (
                <div key={idx} className="flex justify-between items-center pl-2 text-[11px]">
                  <span className="text-slate-600 dark:text-slate-400">{adj.reason}</span>
                  <span className={adj.amountPaise >= 0 ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'}>
                    {adj.amountPaise >= 0 ? `+${formatPaise(adj.amountPaise)}` : `-${formatPaise(Math.abs(adj.amountPaise))}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-800 pt-2">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Effective Bill</span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {isIssued ? formatPaise(effectiveChargePaise) : 'Not issued'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">Total Paid</span>
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
              {formatPaise(paidPaise)}
            </span>
          </div>

          <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-800 pt-2">
            <span className="font-bold text-slate-900 dark:text-slate-100">Remaining Due</span>
            <span className="text-base font-bold text-amber-600 dark:text-amber-400">
              {formatPaise(remainingPaise)}
            </span>
          </div>

          {overpaidPaise > 0 && (
            <div className="flex justify-between items-center text-purple-700 dark:text-purple-300 font-medium">
              <span>Overpaid Balance</span>
              <span>{formatPaise(overpaidPaise)}</span>
            </div>
          )}
        </div>

        {/* Payments List */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <CircleDollarSign className="h-4 w-4 text-teal-600" />
            <span>Recorded Payments ({activePayments.length})</span>
          </h4>

          {activePayments.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic p-3 text-center bg-slate-50 dark:bg-slate-900/40 rounded border border-slate-100 dark:border-slate-800">
              No payments recorded for this charge.
            </p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {activePayments.map((payment, idx) => (
                <div
                  key={payment.roomPaymentId || idx}
                  className="flex items-center justify-between p-2.5 rounded-md bg-white dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        Payment {idx + 1}
                      </span>
                      <span className="text-slate-400 text-[10px] uppercase font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">
                        {payment.method}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      <span>{formatPaymentDate(payment.recordedAt)}</span>
                      {payment.reference && (
                        <span className="ml-2 font-mono">Ref: {payment.reference}</span>
                      )}
                    </div>
                  </div>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    {formatPaise(payment.amountPaise)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {voidedPayments.length > 0 && (
            <div className="pt-2">
              <span className="text-[11px] font-medium text-slate-400">
                Voided Payments ({voidedPayments.length}):
              </span>
              <div className="space-y-1 mt-1">
                {voidedPayments.map((payment) => (
                  <div
                    key={payment.roomPaymentId}
                    className="flex justify-between items-center text-[11px] text-slate-400 line-through bg-slate-50 dark:bg-slate-900/40 p-1.5 rounded"
                  >
                    <span>
                      {formatPaymentDate(payment.recordedAt)} · {payment.voidReason || 'Voided'}
                    </span>
                    <span>{formatPaise(payment.amountPaise)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pt-2 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
