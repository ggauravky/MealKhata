import {
  Coffee,
  Layers,
  Pizza,
  Receipt,
  ShoppingBasket,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_CONFIG } from '../../lib/constants.js';

const CATEGORY_ICONS = {
  all: Layers,
  groceries: ShoppingBasket,
  snacks: Coffee,
  outside_food: Pizza,
  household_supplies: ShoppingCart,
  utilities: Receipt,
  other: Wallet,
};

export function ExpenseCategoryFilter({ activeCategory, onSelectCategory }) {
  const items = [
    { id: '', label: 'All' },
    ...EXPENSE_CATEGORIES.map((cat) => ({
      id: cat,
      label: EXPENSE_CATEGORY_CONFIG[cat]?.label || cat,
    })),
  ];

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
      {items.map((item) => {
        const isSelected = activeCategory === item.id;
        const Icon = CATEGORY_ICONS[item.id || 'all'] || Wallet;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectCategory(item.id)}
            className={[
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all select-none shrink-0 border cursor-pointer',
              isSelected
                ? 'bg-teal-700 text-white border-teal-700 shadow-xs dark:bg-teal-600 dark:border-teal-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800 dark:hover:bg-slate-800/60',
            ].join(' ')}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
