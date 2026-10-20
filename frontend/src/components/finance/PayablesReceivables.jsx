import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatPaise } from '../../lib/money.js';

export function PayablesReceivables({ debtsOwed = [], receivables = [] }) {
  if (debtsOwed.length === 0 && receivables.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
      {/* Debts Owed */}
      {debtsOwed.length > 0 && (
        <div className="rounded-lg border border-amber-200/80 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">
            <ArrowUpRight className="h-4 w-4 text-amber-600" />
            <span>Reimbursements You Owe</span>
          </div>
          <div className="space-y-1.5">
            {debtsOwed.map((debt, idx) => (
              <div key={debt.expenseId || idx} className="flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400 truncate max-w-[170px]">
                  Pay to <strong className="capitalize text-slate-800 dark:text-slate-200">{debt.toMemberId}</strong>: {debt.title}
                </span>
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {formatPaise(debt.amountPaise)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Receivables */}
      {receivables.length > 0 && (
        <div className="rounded-lg border border-teal-200/80 bg-teal-50/60 p-3 dark:border-teal-900/40 dark:bg-teal-950/20">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300 mb-2">
            <ArrowDownLeft className="h-4 w-4 text-teal-600" />
            <span>Reimbursements Owed to You</span>
          </div>
          <div className="space-y-1.5">
            {receivables.map((recv, idx) => (
              <div key={recv.expenseId || idx} className="flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400 truncate max-w-[170px]">
                  From <strong className="capitalize text-slate-800 dark:text-slate-200">{recv.fromMemberId}</strong>: {recv.title}
                </span>
                <span className="font-semibold text-teal-700 dark:text-teal-400">
                  {formatPaise(recv.amountPaise)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
