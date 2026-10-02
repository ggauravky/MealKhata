import {
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  Coins,
  CreditCard,
  FileCheck,
  UtensilsCrossed,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';

const iconMap = {
  CalendarDays,
  ChartNoAxesCombined,
  CreditCard,
  UtensilsCrossed,
  Coins,
  FileCheck,
  Bell,
};

export function QuickActionsCard({ actions = [] }) {
  if (!actions || actions.length === 0) return null;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800">
      <CardHeader className="pb-2.5">
        <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Quick actions
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {actions.map((action) => {
            const Icon = iconMap[action.icon] || ChartNoAxesCombined;
            return (
              <Link
                key={action.id}
                to={action.to}
                className="quick-action-button flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/60 px-3.5 py-2.5 text-xs font-medium text-slate-700 transition-all hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 group"
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 text-teal-700 dark:text-teal-400 shrink-0" aria-hidden="true" />
                  <span className="truncate">{action.label}</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 group-hover:translate-x-0.5 transition-transform shrink-0" />
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
