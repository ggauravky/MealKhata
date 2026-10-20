import { Badge } from '../ui/badge.jsx';

export const STAY_STATUS_CONFIG = {
  ACTIVE: {
    label: 'Active',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
  },
  CHECKOUT_REQUESTED: {
    label: 'Checkout Requested',
    className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
  },
  CHECKOUT_PENDING: {
    label: 'Checkout Pending',
    className: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800',
  },
  CHECKED_OUT: {
    label: 'Checked Out',
    className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
  CANCELLED: {
    label: 'Cancelled',
    className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800',
  },
};

export const CLEARANCE_STATUS_CONFIG = {
  NO_DUES: {
    label: 'No Dues Cleared',
    className: 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800',
  },
  OUTSTANDING_DUES: {
    label: 'Departed with Dues',
    className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800',
  },
};

export function StayStatusBadge({ status, className = '' }) {
  const config = STAY_STATUS_CONFIG[status] || {
    label: status || 'Unknown',
    className: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400',
  };

  return (
    <Badge variant="outline" className={`font-medium text-xs px-2.5 py-0.5 rounded-full ${config.className} ${className}`}>
      {config.label}
    </Badge>
  );
}

export function ClearanceStatusBadge({ status, className = '' }) {
  const config = CLEARANCE_STATUS_CONFIG[status] || {
    label: status || 'Pending',
    className: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400',
  };

  return (
    <Badge variant="outline" className={`font-semibold text-xs px-2.5 py-0.5 rounded-full ${config.className} ${className}`}>
      {config.label}
    </Badge>
  );
}
