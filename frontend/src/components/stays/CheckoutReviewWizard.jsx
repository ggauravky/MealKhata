import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BedDouble,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  LogOut,
  Receipt,
  Shield,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { useState } from 'react';
import { formatPaise } from '../../lib/money.js';
import { Button } from '../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Input } from '../ui/input.jsx';
import { Label } from '../ui/label.jsx';

export function CheckoutReviewWizard({
  stay,
  financialReview,
  depositSummary,
  isSuperAdmin = false,
  onFinalize,
  onCancel,
}) {
  const [step, setStep] = useState(1);
  const [actualLeftOn, setActualLeftOn] = useState(
    stay?.checkoutRequestedFor || new Date().toISOString().slice(0, 10)
  );
  const [allowWithDues, setAllowWithDues] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const messDuePaise = financialReview?.messSummary?.outstandingPaise || 0;
  const roomDuePaise = financialReview?.roomFeeSummary?.outstandingPaise || 0;
  const expenseOwedPaise = financialReview?.expenseSummary?.reimbursementsOwedPaise || 0;
  const expenseReceivablePaise = financialReview?.expenseSummary?.reimbursementsReceivablePaise || 0;
  const depositHeldPaise = depositSummary?.depositHeldPaise || 0;

  const totalOwedPaise = messDuePaise + roomDuePaise + expenseOwedPaise;
  const hasUnresolvedObligations = totalOwedPaise > 0 || depositHeldPaise > 0;
  const isEligibleForNoDues = !hasUnresolvedObligations;

  const handleFinalize = async () => {
    setError('');
    if (!actualLeftOn) {
      setError('Actual departure date is required.');
      return;
    }

    if (hasUnresolvedObligations && !allowWithDues) {
      setError('Member has outstanding dues or held deposit. A No-Dues clearance cannot be granted.');
      return;
    }

    if (hasUnresolvedObligations && allowWithDues && !isSuperAdmin) {
      setError('Only a Super Admin can approve departure with outstanding obligations.');
      return;
    }

    if (hasUnresolvedObligations && allowWithDues && !exceptionReason.trim()) {
      setError('Mandatory exception reason is required for departure with outstanding dues.');
      return;
    }

    setSubmitting(true);
    try {
      await onFinalize({
        actualLeftOn,
        allowWithDues: hasUnresolvedObligations ? allowWithDues : false,
        exceptionReason: hasUnresolvedObligations && allowWithDues ? exceptionReason.trim() : undefined,
      });
    } catch (err) {
      setError(err?.message || 'Failed to finalize checkout.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800/80 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <LogOut className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              Checkout Review — Resident {stay.memberId?.toUpperCase()}
            </CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Guided 5-step checkout and financial clearance verification
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <span>Step {step} of 5</span>
          </div>
        </div>

        {/* Wizard step tabs */}
        <div className="grid grid-cols-5 gap-1.5 pt-3">
          {['Stay', 'Room', 'Dues', 'Deposit', 'Clearance'].map((name, idx) => (
            <div
              key={name}
              className={`h-1.5 rounded-full transition-colors ${
                step >= idx + 1
                  ? 'bg-teal-600 dark:bg-teal-500'
                  : 'bg-slate-200 dark:bg-slate-800'
              }`}
            />
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {error && (
          <div className="p-3 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: Verify Stay Details */}
        {step === 1 && (
          <div className="space-y-4">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-teal-600" />
              Step 1: Verify Stay Details
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800">
                <span className="text-slate-400 block text-[11px]">Resident</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm capitalize">
                  {stay.memberId}
                </span>
              </div>
              <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800">
                <span className="text-slate-400 block text-[11px]">Admission Date</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  {stay.joinedOn}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 pt-2">
              <Label htmlFor="actualLeft" className="text-xs">
                Actual Departure Date (YYYY-MM-DD)
              </Label>
              <Input
                id="actualLeft"
                type="date"
                value={actualLeftOn}
                onChange={(e) => setActualLeftOn(e.target.value)}
                className="text-xs max-w-sm"
              />
              {stay.checkoutRequestedFor && (
                <p className="text-[11px] text-slate-500">
                  Requested departure date was {stay.checkoutRequestedFor}.
                  {stay.checkoutRequestNote && ` Note: "${stay.checkoutRequestNote}"`}
                </p>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: Verify Room Assignment */}
        {step === 2 && (
          <div className="space-y-4">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <BedDouble className="h-4 w-4 text-teal-600" />
              Step 2: Room Assignment & Capacity Release
            </h4>
            <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Occupied Room:</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  Room {stay.initialRoomId || 'Assigned'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Scheduled Departure:</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {actualLeftOn}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Capacity Action on Finalization:</span>
                <span className="font-medium text-teal-700 dark:text-teal-400">
                  Assignment will close as of {actualLeftOn.slice(0, 7)} and release bed capacity.
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Historical room records will remain preserved and auditable in the stay timeline.
            </p>
          </div>
        )}

        {/* STEP 3: Financial Obligations Review */}
        {step === 3 && (
          <div className="space-y-4">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-teal-600" />
              Step 3: Review Financial Obligations Across All 3 Domains
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block text-[11px]">Mess Outstanding Dues</span>
                <span className={`text-base font-bold mt-1 block ${messDuePaise > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatPaise(messDuePaise)}
                </span>
              </div>
              <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block text-[11px]">Room Fees Outstanding Dues</span>
                <span className={`text-base font-bold mt-1 block ${roomDuePaise > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatPaise(roomDuePaise)}
                </span>
              </div>
              <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block text-[11px]">Expense Reimbursements Owed</span>
                <span className={`text-base font-bold mt-1 block ${expenseOwedPaise > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatPaise(expenseOwedPaise)}
                </span>
              </div>
            </div>

            {expenseReceivablePaise > 0 && (
              <div className="p-2.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 text-blue-800 dark:text-blue-300 text-xs flex justify-between items-center">
                <span>Roommates Owe This Resident (Receivable):</span>
                <span className="font-bold">{formatPaise(expenseReceivablePaise)}</span>
              </div>
            )}

            <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/60 flex justify-between items-center text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">Total Resident Payables:</span>
              <span className={`text-base font-bold ${totalOwedPaise > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {formatPaise(totalOwedPaise)}
              </span>
            </div>
          </div>
        )}

        {/* STEP 4: Review Security Deposit */}
        {step === 4 && (
          <div className="space-y-4">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Shield className="h-4 w-4 text-teal-600" />
              Step 4: Review Security Deposit Position
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block text-[11px]">Received</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatPaise(depositSummary?.depositReceivedPaise || 0)}
                </span>
              </div>
              <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block text-[11px]">Deducted</span>
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {formatPaise(depositSummary?.depositDeductedPaise || 0)}
                </span>
              </div>
              <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block text-[11px]">Refunded</span>
                <span className="font-semibold text-indigo-700 dark:text-indigo-400">
                  {formatPaise(depositSummary?.depositRefundedPaise || 0)}
                </span>
              </div>
              <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block text-[11px]">Held Balance</span>
                <span className="font-semibold text-teal-700 dark:text-teal-400">
                  {formatPaise(depositHeldPaise)}
                </span>
              </div>
            </div>

            {depositHeldPaise > 0 ? (
              <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-300 text-xs space-y-1">
                <p className="font-medium flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  Deposit held balance is {formatPaise(depositHeldPaise)}.
                </p>
                <p className="text-[11px] text-amber-800 dark:text-amber-400">
                  Before issuing final No-Dues clearance, deposit refund or approved deductions should be recorded in the Security Deposit ledger.
                </p>
              </div>
            ) : (
              <div className="p-2.5 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>Security deposit is fully settled (Held balance is ₹0).</span>
              </div>
            )}
          </div>
        )}

        {/* STEP 5: Final Clearance Approval */}
        {step === 5 && (
          <div className="space-y-4">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="h-4 w-4 text-teal-600" />
              Step 5: Finalize Clearance & Immutable Snapshot
            </h4>

            {isEligibleForNoDues ? (
              <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200 text-xs space-y-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  Eligible for No-Dues Clearance
                </div>
                <p className="text-[12px] text-emerald-800 dark:text-emerald-300">
                  All Mess bills, Room Fees, and Other Expenses are fully settled, and the Security Deposit held balance is ₹0. Finalizing checkout will generate an immutable No-Dues clearance certificate.
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-900 dark:text-rose-200 text-xs space-y-3">
                <div className="flex items-center gap-2 font-semibold text-sm text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="h-5 w-5 text-rose-600" />
                  Unresolved Obligations Remain (Cannot Issue No-Dues Clearance)
                </div>
                <ul className="list-disc pl-5 space-y-1 text-rose-800 dark:text-rose-300">
                  {messDuePaise > 0 && <li>Mess outstanding dues: {formatPaise(messDuePaise)}</li>}
                  {roomDuePaise > 0 && <li>Room fees outstanding dues: {formatPaise(roomDuePaise)}</li>}
                  {expenseOwedPaise > 0 && <li>Expense reimbursements owed: {formatPaise(expenseOwedPaise)}</li>}
                  {depositHeldPaise > 0 && <li>Deposit held balance: {formatPaise(depositHeldPaise)}</li>}
                </ul>

                {isSuperAdmin ? (
                  <div className="pt-2 border-t border-rose-200/80 dark:border-rose-900/60 space-y-2.5">
                    <label className="flex items-start gap-2 cursor-pointer font-medium text-slate-900 dark:text-slate-100">
                      <input
                        type="checkbox"
                        checked={allowWithDues}
                        onChange={(e) => setAllowWithDues(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span>Super Admin Exception: Finalize physical departure with outstanding dues</span>
                    </label>

                    {allowWithDues && (
                      <div className="space-y-1 pt-1">
                        <Label htmlFor="excReason" className="text-xs text-slate-700 dark:text-slate-300">
                          Mandatory Exception Reason
                        </Label>
                        <Input
                          id="excReason"
                          placeholder="e.g. Resident relocating urgently, remaining ₹500 will be paid next week via UPI"
                          value={exceptionReason}
                          onChange={(e) => setExceptionReason(e.target.value)}
                          className="text-xs"
                          required
                        />
                        <p className="text-[11px] text-slate-500">
                          Status will be recorded as CHECKED_OUT with clearance OUTSTANDING_DUES. Debts are not erased.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-rose-700 dark:text-rose-400 font-medium">
                    Only a Super Admin can approve exceptional departure while obligations remain unresolved.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Wizard Footer Controls */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={step === 1 ? onCancel : () => setStep((s) => s - 1)}
            disabled={submitting}
            className="text-xs"
          >
            {step === 1 ? 'Cancel' : <><ChevronLeft className="h-4 w-4 mr-1" /> Previous</>}
          </Button>

          {step < 5 ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setStep((s) => s + 1)}
              className="text-xs bg-teal-600 hover:bg-teal-700 text-white"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleFinalize}
              disabled={submitting || (hasUnresolvedObligations && (!allowWithDues || !exceptionReason.trim()))}
              className={`text-xs text-white ${
                hasUnresolvedObligations ? 'bg-rose-600 hover:bg-rose-700' : 'bg-teal-600 hover:bg-teal-700'
              }`}
            >
              {submitting
                ? 'Finalizing...'
                : hasUnresolvedObligations
                ? 'Finalize Departure with Dues'
                : 'Finalize No-Dues Checkout'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
