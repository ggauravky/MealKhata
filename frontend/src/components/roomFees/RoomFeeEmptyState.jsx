import { AlertCircle, BedDouble, Calendar, CheckCircle2, CircleDollarSign } from 'lucide-react';
import { Button } from '../ui/button.jsx';
import { Card } from '../ui/card.jsx';

export function RoomFeeEmptyState({ type = 'no_assignment', message, actionLabel, onAction }) {
  const configs = {
    no_assignment: {
      icon: BedDouble,
      title: 'No room assigned yet',
      desc: message || 'Contact your hostel administrator to configure your room stay.',
    },
    no_plan: {
      icon: CircleDollarSign,
      title: 'Room fee not configured',
      desc: message || 'Your monthly room fee has not been configured by the administrator.',
    },
    no_charge: {
      icon: Calendar,
      title: 'Fee not issued for this month',
      desc: message || 'No room fee charge has been issued for this month yet.',
    },
    all_paid: {
      icon: CheckCircle2,
      title: 'All room fees paid',
      desc: message || 'You have no outstanding room fees for this period.',
    },
    no_history: {
      icon: CircleDollarSign,
      title: 'No payment records',
      desc: message || 'No room fee payments have been recorded yet.',
    },
    error: {
      icon: AlertCircle,
      title: 'Unable to load room data',
      desc: message || 'Please check your connection and try again.',
    },
  };

  const config = configs[type] || configs.no_assignment;
  const Icon = config.icon;

  return (
    <Card className="border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-8 text-center">
      <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
        <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-teal-700 dark:text-teal-400">
          <Icon className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
          {config.title}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {config.desc}
        </p>
        {actionLabel && onAction && (
          <Button variant="outline" size="sm" onClick={onAction} className="mt-2 text-xs">
            {actionLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}
