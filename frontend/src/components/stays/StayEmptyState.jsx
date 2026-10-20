import { BedDouble, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '../ui/card.jsx';

export function StayEmptyState({ isMember = false }) {
  return (
    <Card className="border border-dashed border-slate-300 dark:border-slate-800 bg-white/50 dark:bg-slate-900/40">
      <CardContent className="flex flex-col items-center justify-center p-8 text-center space-y-3">
        <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
          <BedDouble className="h-6 w-6" />
        </div>
        <div className="space-y-1 max-w-sm">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base">
            Hostel Stay: Not configured
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isMember
              ? 'Your hostel admission record has not yet been registered by the hostel administrator. Once registered, your room allocation, security deposit, and stay timeline will appear here.'
              : 'This resident has no active hostel stay registered. An Admin or Super Admin can register an admission record to configure their room and security deposit.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
