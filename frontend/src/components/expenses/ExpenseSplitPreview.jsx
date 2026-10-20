import { ArrowRight, CheckCircle2, Users } from 'lucide-react';
import { formatPaise } from '../../lib/money.js';
import { ROOMMATES } from '../../lib/constants.js';

export function ExpenseSplitPreview({ preview, paidByMemberId }) {
  if (!preview) return null;

  const { amountPaise, allocations = [], reimbursementObligations = [] } = preview;

  const getMemberName = (id) => {
    const found = ROOMMATES.find((m) => m.id === id);
    return found ? found.name : id.charAt(0).toUpperCase() + id.slice(1);
  };

  const payerName = getMemberName(paidByMemberId);

  return (
    <div className="rounded-xl border border-teal-100 dark:border-teal-900/40 bg-teal-50/40 dark:bg-teal-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-teal-800 dark:text-teal-300 flex items-center gap-1.5">
          <Users className="h-4 w-4" />
          Split Preview
        </span>
        <span className="text-xs font-bold text-teal-950 dark:text-teal-100">
          Total: {formatPaise(amountPaise)}
        </span>
      </div>

      {/* Member Shares */}
      <div className="grid grid-cols-3 gap-2">
        {allocations.map((alloc) => {
          const isPayer = alloc.memberId === paidByMemberId;
          return (
            <div
              key={alloc.memberId}
              className={[
                'p-2.5 rounded-lg border text-center',
                isPayer
                  ? 'bg-white dark:bg-slate-900 border-teal-200 dark:border-teal-800'
                  : 'bg-white/80 dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800',
              ].join(' ')}
            >
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                {getMemberName(alloc.memberId)}
                {isPayer && (
                  <span className="block text-[10px] text-teal-700 dark:text-teal-400 font-semibold">
                    (Payer)
                  </span>
                )}
              </p>
              <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {formatPaise(alloc.amountPaise)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Reimbursement Obligations */}
      {reimbursementObligations.length > 0 ? (
        <div className="pt-2 border-t border-teal-100/80 dark:border-teal-900/40">
          <p className="text-[11px] font-semibold text-teal-800 dark:text-teal-300 mb-1.5">
            Reimbursement required:
          </p>
          <div className="space-y-1">
            {reimbursementObligations.map((ob, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 bg-white/70 dark:bg-slate-900/40 px-2.5 py-1.5 rounded-md border border-teal-100/60 dark:border-teal-900/30"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <span>{getMemberName(ob.fromMemberId)}</span>
                  <ArrowRight className="h-3 w-3 text-teal-600 dark:text-teal-400" />
                  <span>{getMemberName(ob.toMemberId)}</span>
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {formatPaise(ob.amountPaise)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="pt-2 border-t border-teal-100/80 dark:border-teal-900/40 flex items-center gap-1.5 text-xs text-teal-700 dark:text-teal-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>No reimbursement needed (personal purchase by payer).</span>
        </div>
      )}
    </div>
  );
}
