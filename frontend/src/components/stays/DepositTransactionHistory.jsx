import { AlertCircle, Ban, CheckCircle2, History, Receipt } from 'lucide-react';
import { useState } from 'react';
import { formatPaise } from '../../lib/money.js';
import { Button } from '../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.jsx';
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

const TYPE_CONFIG = {
  RECEIVED: {
    label: 'Received',
    className: 'text-teal-700 bg-teal-50 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800',
  },
  REFUNDED: {
    label: 'Refunded',
    className: 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
  },
  DEDUCTED: {
    label: 'Deducted',
    className: 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  },
};

export function DepositTransactionHistory({
  transactions = [],
  isSuperAdmin = false,
  onVoidTransaction = null,
}) {
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirmVoid = async () => {
    if (!voidReason.trim() || !voidTarget || !onVoidTransaction) return;
    setSubmitting(true);
    setError('');
    try {
      await onVoidTransaction(voidTarget.depositTransactionId, { reason: voidReason.trim() });
      setVoidTarget(null);
      setVoidReason('');
    } catch (err) {
      setError(err?.message || 'Failed to void transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card className="border-slate-200 dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <Receipt className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Deposit Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-3 text-center">
              No deposit receipts, deductions, or refunds recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px] text-slate-500 uppercase tracking-wider">
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method & Ref</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    {isSuperAdmin && onVoidTransaction && <TableHead className="text-right">Action</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
                  {transactions.map((tx) => {
                    const isVoid = tx.status === 'VOIDED';
                    const typeCfg = TYPE_CONFIG[tx.type] || {
                      label: tx.type,
                      className: 'text-slate-600 bg-slate-50',
                    };

                    return (
                      <TableRow
                        key={tx.depositTransactionId}
                        className={isVoid ? 'opacity-50 line-through bg-slate-50/50 dark:bg-slate-900/30' : ''}
                      >
                        <TableCell className="whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                          {tx.recordedAt?.slice(0, 10)}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${typeCfg.className}`}
                          >
                            {typeCfg.label}
                          </span>
                        </TableCell>
                        <TableCell className="font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatPaise(tx.amountPaise)}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <span className="capitalize">{tx.method}</span>
                          {tx.reference && <span className="block text-[11px] text-slate-400 font-mono">{tx.reference}</span>}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400 max-w-[200px] truncate" title={tx.reason}>
                          {tx.reason || '—'}
                          {isVoid && tx.voidReason && (
                            <span className="block text-[10px] text-red-500 not-italic">
                              Voided: {tx.voidReason}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isVoid ? (
                            <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
                              Voided
                            </span>
                          ) : (
                            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                              Valid
                            </span>
                          )}
                        </TableCell>
                        {isSuperAdmin && onVoidTransaction && (
                          <TableCell className="text-right">
                            {!isVoid && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setVoidTarget(tx);
                                  setVoidReason('');
                                  setError('');
                                }}
                                className="h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                              >
                                <Ban className="h-3 w-3 mr-1" />
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Super Admin Void Confirmation Dialog */}
      <Dialog open={Boolean(voidTarget)} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Ban className="h-5 w-5" />
              Void Deposit Transaction
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Voiding reverses this {voidTarget?.type} transaction of{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {voidTarget && formatPaise(voidTarget.amountPaise)}
              </strong>
              . The balance will be recalculated accordingly.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="p-2.5 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="voidReason" className="text-xs">
                Mandatory Audit Reason
              </Label>
              <Input
                id="voidReason"
                placeholder="e.g. Mistaken duplicate receipt entry"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVoidTarget(null)}
              disabled={submitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmVoid}
              disabled={!voidReason.trim() || submitting}
              className="text-xs"
            >
              {submitting ? 'Voiding...' : 'Confirm Void'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
