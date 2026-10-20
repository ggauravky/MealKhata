import { Search } from 'lucide-react';
import { useState } from 'react';
import { ExpenseCard } from './ExpenseCard.jsx';
import { ExpenseEmptyState } from './ExpenseEmptyState.jsx';
import { Input } from '../ui/input.jsx';

export function ExpenseList({
  expenses = [],
  loading = false,
  error = '',
  currentMemberId,
  canAdd = false,
  onAddClick,
  onSelectExpense,
}) {
  const [searchQuery, setSearchQuery] = useState('');

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800/60 animate-pulse border border-slate-200/60 dark:border-slate-800"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400">
        {error}
      </div>
    );
  }

  const filtered = expenses.filter((exp) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const titleMatch = exp.title?.toLowerCase().includes(q);
    const categoryMatch = exp.category?.toLowerCase().includes(q);
    const payerMatch = exp.paidByMemberId?.toLowerCase().includes(q);
    return titleMatch || categoryMatch || payerMatch;
  });

  if (expenses.length === 0) {
    return (
      <ExpenseEmptyState
        type="no_expenses"
        canAdd={canAdd}
        onAddClick={onAddClick}
      />
    );
  }

  return (
    <div className="space-y-3">
      {expenses.length > 3 && (
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search expenses by title or payer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-lg"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500">
          No expenses match "{searchQuery}"
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((exp) => (
            <ExpenseCard
              key={exp.expenseId}
              expense={exp}
              currentMemberId={currentMemberId}
              onClick={() => onSelectExpense(exp)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
