import { Bell, Clock } from 'lucide-react';
import { BrowserReminderControl } from '../reminders/BrowserReminderControl.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Badge } from '../ui/badge.jsx';

export function NextReminderCard({ reminders }) {
  const next = reminders?.nextReminder;
  const isPushConfigured = reminders?.isPushConfigured;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Meal reminders
        </CardTitle>
        <Bell className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </CardHeader>

      <CardContent className="space-y-3.5">
        {next ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
            <Clock className="h-4 w-4 text-teal-700 dark:text-teal-400 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">
                {next.label}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {next.timeFormatted || next.time}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No upcoming reminders scheduled for today.
          </p>
        )}

        <div className="flex items-center justify-between text-xs">
          <Badge variant="secondary" className="font-normal text-[11px]">
            {isPushConfigured ? 'Background push reminders enabled' : 'In-app reminders active'}
          </Badge>
        </div>

        <div className="pt-1">
          <BrowserReminderControl />
        </div>
      </CardContent>
    </Card>
  );
}
