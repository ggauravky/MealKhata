import { ArrowRight, Ban, CheckCircle2, History, Plus, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '../ui/card.jsx';
import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';

function getMemberName(id) {
  const found = ROOMMATES.find((m) => m.id === id);
  return found ? found.name : id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Unknown';
}

export function AdminExpenseHistory({ expenses = [], reimbursements = [] }) {
  // Combine all events: expenses recorded, expenses voided, reimbursements recorded, reimbursements voided
  const events = [];

  for (const exp of expenses) {
    events.push({
      id: `exp-created-${exp.expenseId}`,
      type: 'expense_created',
      title: `Expense recorded: ${exp.title}`,
      subtitle: `${formatPaise(exp.amountPaise)} · Paid by ${getMemberName(exp.paidByMemberId)}`,
      timestamp: exp.createdAt || exp.date,
      role: exp.createdByRole,
    });

    if (exp.status === 'voided') {
      events.push({
        id: `exp-voided-${exp.expenseId}`,
        type: 'expense_voided',
        title: `Expense voided: ${exp.title}`,
        subtitle: `Reason: ${exp.voidReason || 'None provided'}`,
        timestamp: exp.voidedAt,
        role: exp.voidedByRole,
      });
    }
  }

  for (const r of reimbursements) {
    const fromName = getMemberName(r.fromMemberId);
    const toName = getMemberName(r.toMemberId);

    events.push({
      id: `reimb-recorded-${r.reimbursementId}`,
      type: 'reimbursement_recorded',
      title: `Reimbursement recorded: ${fromName} → ${toName}`,
      subtitle: `${formatPaise(r.amountPaise)} via ${(r.method || 'upi').toUpperCase()}${r.reference ? ` (Ref: ${r.reference})` : ''}`,
      timestamp: r.recordedAt,
      role: r.recordedByRole,
    });

    if (r.status === 'voided') {
      events.push({
        id: `reimb-voided-${r.reimbursementId}`,
        type: 'reimbursement_voided',
        title: `Reimbursement voided: ${fromName} → ${toName} (${formatPaise(r.amountPaise)})`,
        subtitle: `Reason: ${r.voidReason || 'None provided'}`,
        timestamp: r.voidedAt,
        role: r.voidedByRole,
      });
    }
  }

  // Sort descending by timestamp
  events.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  if (events.length === 0) {
    return (
      <div className="py-12 text-center text-xs text-slate-400 italic">
        No audit events recorded for this month.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((ev) => {
        let Icon = Plus;
        let iconBg = 'bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400';

        if (ev.type === 'expense_voided') {
          Icon = Ban;
          iconBg = 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400';
        } else if (ev.type === 'reimbursement_recorded') {
          Icon = CheckCircle2;
          iconBg = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400';
        } else if (ev.type === 'reimbursement_voided') {
          Icon = RotateCcw;
          iconBg = 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400';
        }

        const dateStr = ev.timestamp
          ? new Date(ev.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          : '';

        return (
          <Card
            key={ev.id}
            className="p-3 border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 text-xs shadow-xs"
          >
            <div className="flex items-start gap-3">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
                <Icon className="h-4 w-4" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {ev.title}
                  </h5>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {dateStr}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {ev.subtitle}
                </p>
                {ev.role && (
                  <span className="inline-block text-[9px] uppercase tracking-wider font-semibold text-slate-400 mt-1">
                    By {ev.role}
                  </span>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
