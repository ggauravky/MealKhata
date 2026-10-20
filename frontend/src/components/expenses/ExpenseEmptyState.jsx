import { CheckCircle2, Plus, Receipt } from 'lucide-react';
import { Button } from '../ui/button.jsx';

export function ExpenseEmptyState({
  type = 'no_expenses',
  canAdd = false,
  onAddClick,
  customMessage,
}) {
  let title = 'No expenses recorded yet';
  let description =
    'Groceries, snacks and other purchases will appear here when an Admin records them.';
  let Icon = Receipt;

  if (type === 'no_involving_member') {
    title = 'No expenses involving you';
    description = 'No expenses involving you have been recorded for this month.';
  } else if (type === 'all_settled') {
    title = 'All settled!';
    description = "You're all settled for the selected expenses. No reimbursements pending.";
    Icon = CheckCircle2;
  } else if (type === 'no_reimbursements') {
    title = 'No reimbursements recorded';
    description = 'Reimbursements made towards shared expenses will appear here.';
  }

  if (customMessage) {
    description = customMessage;
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
      <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-3">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
        {title}
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-4">
        {description}
      </p>

      {canAdd && onAddClick && (
        <Button
          size="sm"
          onClick={onAddClick}
          className="bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700 gap-1.5"
        >
          <Plus className="h-4 w-4" />
          <span>Add Expense</span>
        </Button>
      )}
    </div>
  );
}
