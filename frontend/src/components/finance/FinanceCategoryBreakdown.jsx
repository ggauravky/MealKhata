import { BedDouble, CookingPot, ShoppingBag } from 'lucide-react';
import { formatPaise } from '../../lib/money.js';

export function FinanceCategoryBreakdown({ mess, room, expenses }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* 1. Mess Domain */}
      <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-slate-800/80 dark:bg-slate-900/40">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <CookingPot className="h-4 w-4 text-teal-600" />
            <span>Hostel Mess</span>
          </div>
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              mess?.remainingPaise === 0
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
            }`}
          >
            {mess?.isClosed ? 'Closed' : mess?.remainingPaise === 0 ? 'Paid' : 'Pending'}
          </span>
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-slate-500">
            <span>Bill:</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{formatPaise(mess?.billPaise || 0)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>Paid:</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{formatPaise(mess?.paidPaise || 0)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200/60 dark:border-slate-800/60 pt-1 font-semibold">
            <span>Remaining:</span>
            <span className={mess?.remainingPaise > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}>
              {formatPaise(mess?.remainingPaise || 0)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Room Fees Domain */}
      <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-slate-800/80 dark:bg-slate-900/40">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <BedDouble className="h-4 w-4 text-indigo-600" />
            <span>Room Fees</span>
          </div>
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              !room?.chargeIssued
                ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                : room?.remainingPaise === 0
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
            }`}
          >
            {!room?.chargeIssued ? 'Not issued' : room?.remainingPaise === 0 ? 'Paid' : 'Pending'}
          </span>
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-slate-500">
            <span>Charge:</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {room?.chargeIssued ? formatPaise(room?.issuedChargePaise || 0) : '—'}
            </span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>Paid:</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{formatPaise(room?.paidPaise || 0)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200/60 dark:border-slate-800/60 pt-1 font-semibold">
            <span>Remaining:</span>
            <span className={room?.remainingPaise > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}>
              {room?.chargeIssued ? formatPaise(room?.remainingPaise || 0) : '₹0.00'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Other Expenses Domain */}
      <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-slate-800/80 dark:bg-slate-900/40">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <ShoppingBag className="h-4 w-4 text-amber-600" />
            <span>Other Expenses</span>
          </div>
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              expenses?.owedToOthersPaise === 0
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
            }`}
          >
            {expenses?.owedToOthersPaise === 0 ? 'Settled' : 'Debt due'}
          </span>
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-slate-500">
            <span>My share:</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{formatPaise(expenses?.spendingSharePaise || 0)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>I paid shop:</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{formatPaise(expenses?.merchantSpendingPaise || 0)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200/60 dark:border-slate-800/60 pt-1 font-semibold">
            <span>I owe others:</span>
            <span className={expenses?.owedToOthersPaise > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}>
              {formatPaise(expenses?.owedToOthersPaise || 0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
