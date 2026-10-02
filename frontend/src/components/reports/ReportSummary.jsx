import { CookingPot } from 'lucide-react';
import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';
import { formatPlateFraction } from '../../lib/plates.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { MemberAvatar } from '../ui/avatar.jsx';
import { Badge } from '../ui/badge.jsx';

export function ReportSummary({ title, description, summary, isClosed = false }) {
  const sectionId = `report-${title.replaceAll(' ', '-').toLowerCase()}`;

  return (
    <div className="space-y-4" aria-labelledby={sectionId}>
      <div>
        <div className="flex items-center gap-2">
          <h2 id={sectionId} className="text-base font-bold text-slate-900 dark:text-slate-100">
            {title}
          </h2>
          {isClosed && (
            <Badge variant="secondary" className="text-[11px] font-semibold">
              Final
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
        )}
      </div>

      {/* Member Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {ROOMMATES.map((member) => {
          const memberSummary = summary?.members?.[member.id] || { amountPaise: 0 };
          const hasShareUnits = memberSummary.morningShareUnits !== undefined;

          const morningMeals = hasShareUnits
            ? memberSummary.morningParticipationCount
            : (memberSummary.morningCount ?? 0);
          const nightMeals = hasShareUnits
            ? memberSummary.nightParticipationCount
            : (memberSummary.nightCount ?? 0);

          const morningEquiv = hasShareUnits ? formatPlateFraction(memberSummary.morningShareUnits) : '';
          const nightEquiv = hasShareUnits ? formatPlateFraction(memberSummary.nightShareUnits) : '';
          const totalEquiv = hasShareUnits
            ? formatPlateFraction(memberSummary.totalShareUnits)
            : (memberSummary.totalPlates ?? memberSummary.totalMeals ?? 0);

          return (
            <Card key={member.id} className="border-slate-200/90 dark:border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div className="flex items-center gap-2.5">
                  <MemberAvatar memberId={member.id} name={member.name} size="sm" />
                  <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {member.name}
                  </CardTitle>
                </div>
                {isClosed && (
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">Closed</span>
                )}
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between">
                    <span>Morning meals:</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {morningMeals} {hasShareUnits && `(${morningEquiv} plates)`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Night meals:</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {nightMeals} {hasShareUnits && `(${nightEquiv} plates)`}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 dark:border-slate-800/80 pt-1.5 font-semibold text-slate-900 dark:text-slate-100">
                    <span>Plate share:</span>
                    <span>{totalEquiv} plates</span>
                  </div>
                </div>

                <div className="rounded-md bg-slate-50 p-2.5 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80 flex items-baseline justify-between">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Bill amount</span>
                  <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {formatPaise(memberSummary.amountPaise)}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Room Total Card */}
      {summary?.room && (
        <Card className="border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
          <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-teal-50 dark:bg-teal-950/60 border border-teal-200/80 dark:border-teal-800/60 flex items-center justify-center text-teal-700 dark:text-teal-300 shrink-0">
                <CookingPot className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400 block">
                  Household Room Total {isClosed && '(Final statement)'}
                </span>
                <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {formatPaise(summary.room.amountPaise)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4 sm:gap-6 text-xs text-slate-600 dark:text-slate-400 border-t sm:border-t-0 sm:border-l border-slate-200/80 dark:border-slate-800/80 pt-3 sm:pt-0 sm:pl-6">
              {summary.room.morningPhysicalPlates !== undefined ? (
                <>
                  <div>
                    <span className="block text-slate-400 text-[11px]">Morning</span>
                    <strong className="font-semibold text-slate-800 dark:text-slate-200">
                      {summary.room.morningPhysicalPlates} plates
                    </strong>
                  </div>
                  <div>
                    <span className="block text-slate-400 text-[11px]">Night</span>
                    <strong className="font-semibold text-slate-800 dark:text-slate-200">
                      {summary.room.nightPhysicalPlates} plates
                    </strong>
                  </div>
                  <div>
                    <span className="block text-slate-400 text-[11px]">Physical Total</span>
                    <strong className="font-semibold text-slate-900 dark:text-slate-100">
                      {summary.room.totalPhysicalPlates} ordered
                    </strong>
                  </div>
                </>
              ) : (
                <div>
                  <span className="block text-slate-400 text-[11px]">Total Plates</span>
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">
                    {summary.room.totalPlates ?? summary.room.totalMeals ?? 0}
                  </strong>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
