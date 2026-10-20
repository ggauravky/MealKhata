import { Progress } from '../ui/progress.jsx';
import { formatPaise } from '../../lib/money.js';

export function RoomFeeProgress({ paidPaise = 0, billPaise = 0, status = 'due', className = '' }) {
  const safePaid = Math.max(0, Number(paidPaise) || 0);
  const safeBill = Math.max(0, Number(billPaise) || 0);

  let percent = 0;
  if (safeBill > 0) {
    percent = Math.min(100, Math.round((safePaid / safeBill) * 100));
  } else if (safePaid > 0) {
    percent = 100;
  }

  const variant =
    status === 'paid' || status === 'overpaid'
      ? 'emerald'
      : status === 'partial'
        ? 'amber'
        : status === 'overdue'
          ? 'red'
          : 'default';

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500 dark:text-slate-400">
          Paid: {formatPaise(safePaid)} / {safeBill > 0 ? formatPaise(safeBill) : '₹0'}
        </span>
        <span className="font-semibold text-slate-700 dark:text-slate-300">
          {percent}%
        </span>
      </div>
      <Progress value={percent} variant={variant} className="h-2" />
    </div>
  );
}
