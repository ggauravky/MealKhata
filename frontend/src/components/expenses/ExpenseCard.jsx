import {
  Ban,
  CheckCircle2,
  Clock,
  Coffee,
  IndianRupee,
  Pizza,
  Receipt,
  ShoppingBasket,
  ShoppingCart,
  Users,
  Wallet,
  Pencil,
  Trash2,
  History,
} from 'lucide-react';
import { Card } from '../ui/card.jsx';
import { Badge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';
import { EXPENSE_CATEGORY_CONFIG } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';

const CATEGORY_ICONS = {
  groceries: ShoppingBasket,
  snacks: Coffee,
  outside_food: Pizza,
  household_supplies: ShoppingCart,
  utilities: Receipt,
  other: Wallet,
};

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function ExpenseCard({
  expense,
  currentMemberId,
  onClick,
  onView,
  onEdit,
  onDelete,
  isSuperAdmin = false,
}) {
  if (!expense) return null;

  const config = EXPENSE_CATEGORY_CONFIG[expense.category] || EXPENSE_CATEGORY_CONFIG.other;
  const Icon = CATEGORY_ICONS[expense.category] || Wallet;

  const isVoided = expense.status === 'voided';
  const participantCount = expense.allocations?.length || 0;
  const isPayer = expense.paidByMemberId === currentMemberId;

  // Reimbursement status label & badge
  let statusBadge;
  if (isVoided) {
    statusBadge = (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800 px-2 py-0.5 rounded-full">
        <Ban className="h-3 w-3" />
        Voided
      </span>
    );
  } else if (expense.derivedStatus === 'no_reimbursement_needed') {
    statusBadge = (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 px-2 py-0.5 rounded-full">
        Personal
      </span>
    );
  } else if (expense.derivedStatus === 'fully_reimbursed') {
    statusBadge = (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="h-3 w-3" />
        Fully reimbursed
      </span>
    );
  } else if (expense.derivedStatus === 'partially_reimbursed') {
    statusBadge = (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800 px-2 py-0.5 rounded-full">
        <Clock className="h-3 w-3" />
        Partially reimbursed
      </span>
    );
  } else {
    statusBadge = (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-50/80 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/40 px-2 py-0.5 rounded-full">
        <Clock className="h-3 w-3" />
        Not reimbursed
      </span>
    );
  }

  // Capitalize payer name
  const payerName = expense.paidByMemberId
    ? expense.paidByMemberId.charAt(0).toUpperCase() + expense.paidByMemberId.slice(1)
    : 'Unknown';

  const splitLabel =
    expense.splitType === 'equal'
      ? `Equal split · ${participantCount} members`
      : expense.splitType === 'personal'
        ? 'Personal purchase'
        : `Custom split · ${participantCount} members`;

  return (
    <Card
      onClick={onClick}
      className={[
        'p-4 transition-all duration-150 border cursor-pointer select-none rounded-xl',
        isVoided
          ? 'opacity-60 bg-slate-50/70 border-slate-200 dark:bg-slate-900/30 dark:border-slate-800/60'
          : 'bg-white hover:border-slate-300 dark:bg-slate-900/60 dark:border-slate-800 dark:hover:border-slate-700 hover:shadow-xs',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: Category Icon & Details */}
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={[
              'h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border',
              config.badgeClass,
            ].join(' ')}
          >
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {expense.title}
              </h4>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80">
                {config.label}
              </span>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>{formatDisplayDate(expense.date)}</span>
              <span>·</span>
              <span>Paid by <strong className="font-semibold text-slate-700 dark:text-slate-300">{payerName}</strong></span>
              {isPayer && (
                <span className="text-[10px] text-teal-700 dark:text-teal-400 font-semibold bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.2 rounded">
                  You paid
                </span>
              )}
            </p>

            <div className="flex items-center gap-2 mt-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {splitLabel}
              </span>
              <span>·</span>
              {statusBadge}
            </div>
          </div>
        </div>

        {/* Right: Amount & Outstanding */}
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">
            {formatPaise(expense.amountPaise)}
          </p>

          {!isVoided && expense.totalOutstandingReceivablePaise > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-0.5">
              {formatPaise(expense.totalOutstandingReceivablePaise)} pending
            </p>
          )}
        </div>
      </div>

      {/* Super Admin Action Controls */}
      {isSuperAdmin && (
        <div className="flex items-center justify-end gap-1.5 mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80">
          {isVoided ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                if (onView) onView(expense);
                else if (onClick) onClick();
              }}
              className="h-7 px-2.5 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 cursor-pointer"
            >
              <History className="h-3.5 w-3.5 mr-1" />
              <span>View History</span>
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onView) onView(expense);
                  else if (onClick) onClick();
                }}
                className="h-7 px-2.5 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100 cursor-pointer"
              >
                <span>View</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onEdit) onEdit(expense);
                }}
                className="h-7 px-2.5 text-xs text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800/60 hover:bg-teal-50 dark:hover:bg-teal-950/40 cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                <span>Edit</span>
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onDelete) onDelete(expense);
                }}
                className="h-7 px-2.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                <span>Delete</span>
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
