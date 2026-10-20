import { ArrowRight, BedDouble, Calendar, History, ShieldCheck } from 'lucide-react';
import { formatPaise } from '../../lib/money.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';

export function RoomHistoryTimeline({ roomHistory = [], joinedOn = '' }) {
  if (!roomHistory || roomHistory.length === 0) {
    return (
      <Card className="border-slate-200 dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <History className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Room History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No room assignment records found for this stay.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Reverse so latest is on top
  const sorted = [...roomHistory].reverse();

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
          <History className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          Room History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
          {sorted.map((item, idx) => {
            const isLatest = idx === 0;
            return (
              <div key={`${item.roomNumber}-${item.startMonth}-${idx}`} className="relative">
                {/* Node dot */}
                <div
                  className={`absolute -left-6 top-1 h-3 w-3 rounded-full border-2 ${
                    item.isCurrent
                      ? 'border-teal-600 bg-teal-500 ring-4 ring-teal-100 dark:ring-teal-950/60'
                      : 'border-slate-400 bg-slate-300 dark:border-slate-600 dark:bg-slate-700'
                  }`}
                />

                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <BedDouble className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                      Room {item.roomNumber}
                    </span>

                    {item.isCurrent ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800">
                        Current Room
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                        Previous Room
                      </span>
                    )}

                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      ({item.occupancy || 'Standard'} Occupancy)
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-slate-400" />
                      {item.startMonth}
                      {item.endMonth ? ` to ${item.endMonth}` : ' – Present'}
                    </span>
                    {item.monthlyRentPaise > 0 && (
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {formatPaise(item.monthlyRentPaise)} / mo
                      </span>
                    )}
                  </div>

                  {item.reason && (
                    <p className="text-xs italic text-slate-500 dark:text-slate-400 mt-1">
                      Note: {item.reason}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
