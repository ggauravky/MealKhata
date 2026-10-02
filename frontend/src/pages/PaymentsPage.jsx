import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  History,
  WalletCards,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { PaymentFlowDialog } from '../components/payments/PaymentFlowDialog.jsx';
import { PaymentSettingsPanel } from '../components/payments/PaymentSettingsPanel.jsx';
import { VoidPaymentDialog } from '../components/payments/VoidPaymentDialog.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { MemberAvatar } from '../components/ui/avatar.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { usePaymentHistory } from '../hooks/usePaymentHistory.js';
import { usePaymentSummary } from '../hooks/usePaymentSummary.js';
import { usePwa } from '../hooks/usePwa.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { useSettlement } from '../hooks/useSettlement.js';
import { ROOMMATES } from '../lib/constants.js';
import { addLogicalMonths, formatLogicalMonth, isValidLogicalMonth } from '../lib/logicalMonth.js';
import { formatPaise } from '../lib/money.js';
import { canInitiatePayment, PAYMENT_STATUS_LABELS } from '../lib/paymentFlow.js';

const periodLabels = {
  past: 'Completed month',
  current: 'Current total to date',
  future: 'Future month',
};

function formatPaymentTime(value) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function MemberPaymentCard({
  roommate,
  member,
  periodType,
  role,
  currentMemberId,
  isOnline = true,
  isClosed = false,
  onPay,
}) {
  const isSelf = roommate.id === currentMemberId;
  const canPay = canInitiatePayment({ role, member, currentMemberId });
  const billLabel =
    member.billAmountPaise === null
      ? PAYMENT_STATUS_LABELS[member.status]
      : formatPaise(member.billAmountPaise);

  const statusVariant =
    member.status === 'paid'
      ? 'taking'
      : member.status === 'partial' || member.status === 'due'
        ? 'warning'
        : 'secondary';

  const hasRemaining =
    Number.isSafeInteger(member.remainingAmountPaise) && member.remainingAmountPaise > 0;

  return (
    <Card
      className={`transition-all ${
        isSelf
          ? 'border-teal-600/80 bg-teal-50/20 dark:border-teal-700/60 dark:bg-teal-950/20 ring-1 ring-teal-500/20'
          : 'border-slate-200/90 dark:border-slate-800'
      }`}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2.5">
          <MemberAvatar memberId={roommate.id} name={roommate.name} size="sm" />
          <div>
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {roommate.name}
              </CardTitle>
              {isSelf && (
                <span className="rounded-full bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300 text-[10px] font-semibold px-1.5 py-0.2">
                  You
                </span>
              )}
            </div>
          </div>
        </div>
        <Badge variant={statusVariant} className="text-xs">
          {PAYMENT_STATUS_LABELS[member.status]}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-3.5">
        {/* Figures strip */}
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
          <div>
            <span className="block text-slate-400 text-[11px]">Bill</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
              {billLabel}
            </span>
          </div>
          <div>
            <span className="block text-slate-400 text-[11px]">Paid</span>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400 text-sm">
              {formatPaise(member.paidAmountPaise)}
            </span>
          </div>
          <div>
            <span className="block text-slate-400 text-[11px]">Remaining</span>
            <span
              className={`font-semibold text-sm ${
                hasRemaining
                  ? 'text-orange-700 dark:text-orange-400 font-bold'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {member.billAmountPaise === null ? '—' : formatPaise(member.remainingAmountPaise)}
            </span>
          </div>
        </div>

        {member.overpaidAmountPaise > 0 && (
          <p className="text-xs text-purple-700 dark:text-purple-300">
            Overpaid: {formatPaise(member.overpaidAmountPaise)}
          </p>
        )}

        {periodType === 'current' && Number.isSafeInteger(member.projectedBillAmountPaise) && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Projected month total: {formatPaise(member.projectedBillAmountPaise)}
          </p>
        )}

        {canPay && (
          <Button
            variant={isClosed ? 'secondary' : 'default'}
            size="default"
            className="w-full gap-2 text-xs font-semibold"
            disabled={!isOnline || isClosed}
            onClick={() => isOnline && !isClosed && onPay({ ...roommate, ...member })}
          >
            <CreditCard className="h-4 w-4" />
            <span>
              {isClosed
                ? 'Month closed'
                : isOnline
                  ? `Pay ${formatPaise(member.remainingAmountPaise)}`
                  : 'Offline — payment unavailable'}
            </span>
          </Button>
        )}

        {isClosed && (
          <p className="text-[11px] text-slate-400 text-center">
            Month closed. Statements frozen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function PaymentsPage() {
  useDocumentTitle('Payments');
  const auth = useAuth();
  const serverToday = useServerToday();
  const { isOnline } = usePwa();
  const [searchParams] = useSearchParams();
  const queryMonth = searchParams.get('month');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [payingMember, setPayingMember] = useState(null);
  const [voidingPayment, setVoidingPayment] = useState(null);
  const [message, setMessage] = useState('');

  const month =
    selectedMonth ||
    (isValidLogicalMonth(queryMonth) ? queryMonth : serverToday.date.slice(0, 7));
  const summary = usePaymentSummary(month);
  const history = usePaymentHistory(month);
  const settlement = useSettlement(month);
  const isClosed = settlement.isClosed;
  const data = summary.data;

  const refreshPayments = () => {
    summary.refresh();
    history.refresh();
  };

  const handleRecorded = () => {
    setPayingMember(null);
    setMessage('Payment recorded. Recorded by user confirmation; not verified by a bank.');
    refreshPayments();
  };

  const handleVoided = () => {
    setVoidingPayment(null);
    setMessage('Payment voided. The financial record remains in audit history.');
    refreshPayments();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Payments"
        description="Monthly room bills, peer-to-peer UPI payments, and auditable history."
      />

      {serverToday.error && (
        <ErrorState title="Payments unavailable" message={serverToday.error} />
      )}

      {/* Month Toolbar Card */}
      {month && (
        <Card className="border-slate-200/90 dark:border-slate-800">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {formatLogicalMonth(month)}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {data ? periodLabels[data.periodType] : 'Loading payments...'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setSelectedMonth(addLogicalMonths(month, -1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs font-medium"
                onClick={() => setSelectedMonth(serverToday.date.slice(0, 7))}
              >
                Current
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setSelectedMonth(addLogicalMonths(month, 1))}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <input
                type="month"
                value={month}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="h-8 rounded-sm border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ml-1 cursor-pointer"
                aria-label="Jump to payment month"
              />
            </div>
          </CardHeader>
        </Card>
      )}

      {message && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs text-teal-800 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-300"
        >
          {message}
        </div>
      )}

      {/* Super Admin Payment Receiver Configuration */}
      {auth.role === 'superadmin' && <PaymentSettingsPanel />}

      {summary.error && (
        <ErrorState
          title="Payment summary unavailable"
          message={summary.error}
          actionLabel="Try again"
          onAction={summary.refresh}
        />
      )}

      {summary.loading && !data && (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      )}

      {data && (
        <>
          {/* Room Total Card */}
          <Card className="border-slate-200/90 dark:border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300">
                  <WalletCards className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Room Total
                  </CardTitle>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {periodLabels[data.periodType]}
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <div className="grid grid-cols-3 gap-2.5 rounded-lg bg-slate-50 p-3.5 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
                <div>
                  <span className="block text-slate-500 dark:text-slate-400 text-xs">Total Bill</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {data.room.billAmountPaise === null
                      ? PAYMENT_STATUS_LABELS[data.room.status]
                      : formatPaise(data.room.billAmountPaise)}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500 dark:text-slate-400 text-xs">Total Collected</span>
                  <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                    {formatPaise(data.room.paidAmountPaise)}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500 dark:text-slate-400 text-xs">Outstanding</span>
                  <span
                    className={`text-lg font-bold ${
                      data.room.remainingAmountPaise > 0
                        ? 'text-orange-700 dark:text-orange-400'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {data.room.billAmountPaise === null
                      ? '—'
                      : formatPaise(data.room.remainingAmountPaise)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {isClosed && (
            <div
              role="status"
              className="settlement-banner rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-2.5"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <strong className="block font-semibold">{formatLogicalMonth(month)} is closed.</strong>
                <span>All meal records, bills, and payments are frozen. Reopen this month before making financial changes.</span>
              </div>
            </div>
          )}

          {/* Member Payment Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {ROOMMATES.map((roommate) => (
              <MemberPaymentCard
                key={roommate.id}
                roommate={roommate}
                member={data.members[roommate.id]}
                periodType={data.periodType}
                role={auth.role}
                currentMemberId={auth.memberId}
                isOnline={isOnline}
                isClosed={isClosed}
                onPay={setPayingMember}
              />
            ))}
          </div>
        </>
      )}

      {/* Payment History Card */}
      <Card className="border-slate-200/90 dark:border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-500" />
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Payment history
            </CardTitle>
          </div>
          <span className="text-xs text-slate-400">Auditable ledger</span>
        </CardHeader>

        <CardContent>
          {history.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-md" />
              <Skeleton className="h-12 w-full rounded-md" />
            </div>
          ) : history.error ? (
            <ErrorState
              compact
              title="History unavailable"
              message={
                !isOnline ? 'Payment history is unavailable while offline.' : history.error
              }
              actionLabel="Try again"
              onAction={history.refresh}
            />
          ) : history.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center rounded-lg border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
              <CircleDollarSign className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No payments recorded yet
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                Payments recorded for {formatLogicalMonth(month)} will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.items.map((payment) => {
                const roommate = ROOMMATES.find(({ id }) => id === payment.memberId);
                const isVoided = payment.status === 'voided';

                return (
                  <div
                    key={payment.paymentId}
                    className={`flex items-center justify-between py-3 ${
                      isVoided ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                          isVoided
                            ? 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}
                      >
                        <CircleDollarSign className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {roommate?.name ?? payment.memberId}
                          </span>
                          <Badge
                            variant={isVoided ? 'destructive' : 'taking'}
                            className="text-[10px] py-0 px-1.5"
                          >
                            {isVoided ? 'Voided' : 'Recorded'}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          <time dateTime={payment.recordedAt}>
                            {formatPaymentTime(payment.recordedAt)}
                          </time>
                          {payment.upiReference && (
                            <span className="ml-2 font-mono text-[11px]">
                              Ref: {payment.upiReference}
                            </span>
                          )}
                          {isVoided && payment.voidReason && (
                            <span className="ml-2 text-red-600 dark:text-red-400">
                              Reason: {payment.voidReason}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={`text-sm font-bold ${
                          isVoided
                            ? 'line-through text-slate-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {formatPaise(payment.amountPaise)}
                      </span>

                      {auth.role === 'superadmin' && payment.status === 'recorded' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!isOnline || isClosed}
                          title={
                            isClosed
                              ? 'This month is closed. Reopen the month before voiding payments.'
                              : undefined
                          }
                          onClick={() => isOnline && !isClosed && setVoidingPayment(payment)}
                          className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          Void
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {payingMember && (
        <PaymentFlowDialog
          member={payingMember}
          month={month}
          onClose={() => setPayingMember(null)}
          onRecorded={handleRecorded}
        />
      )}

      {voidingPayment && (
        <VoidPaymentDialog
          payment={voidingPayment}
          onClose={() => setVoidingPayment(null)}
          onVoided={handleVoided}
        />
      )}
    </div>
  );
}
