import { Users } from 'lucide-react';
import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';
import { MemberAvatar } from '../ui/avatar.jsx';

export function DailyCostSummary({ summary, counts }) {
  const roomData = summary?.room ?? {
    morningAmountPaise: 0,
    nightAmountPaise: 0,
    totalAmountPaise: 0,
  };

  const totalPlates = counts?.totalPhysicalPlates ?? 0;

  return (
    <section
      aria-labelledby="daily-cost-summary-heading"
      className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80"
    >
      <div className="flex items-center justify-between mb-2">
        <h4
          id="daily-cost-summary-heading"
          className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
        >
          Daily Cost Summary
        </h4>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
          Authoritative allocation
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
        {ROOMMATES.map((member) => {
          const memberCost = summary?.members?.[member.id] ?? {
            morningAmountPaise: 0,
            nightAmountPaise: 0,
            totalAmountPaise: 0,
          };

          const isZero = memberCost.totalAmountPaise === 0;

          return (
            <div
              key={member.id}
              className="rounded-lg border border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-2.5 sm:p-3 flex flex-col justify-between"
              aria-label={`${member.name} daily total, ${formatPaise(memberCost.totalAmountPaise)}`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <MemberAvatar memberId={member.id} name={member.name} size="xs" />
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {member.name}
                </span>
              </div>

              <div>
                <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  {formatPaise(memberCost.totalAmountPaise)}
                </div>
                <div className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {isZero ? (
                    <span>No meal</span>
                  ) : (
                    <>
                      <span>M {formatPaise(memberCost.morningAmountPaise)}</span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                        ·
                      </span>
                      <span>N {formatPaise(memberCost.nightAmountPaise)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Household Tile */}
        <div
          className="rounded-lg border border-teal-200/90 dark:border-teal-800/70 bg-teal-50/60 dark:bg-teal-950/30 p-2.5 sm:p-3 flex flex-col justify-between"
          aria-label={`Household daily total, ${formatPaise(roomData.totalAmountPaise)}`}
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <div className="flex items-center gap-1.5">
              <Users
                className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400 shrink-0"
                aria-hidden="true"
              />
              <span className="text-xs font-bold text-teal-900 dark:text-teal-200 truncate">
                Household
              </span>
            </div>
            {totalPlates > 0 && (
              <span className="text-[10px] font-medium text-teal-700/80 dark:text-teal-300/80">
                {totalPlates} {totalPlates === 1 ? 'plate' : 'plates'}
              </span>
            )}
          </div>

          <div>
            <div className="text-base sm:text-lg font-bold text-teal-950 dark:text-teal-100 tracking-tight">
              {formatPaise(roomData.totalAmountPaise)}
            </div>
            <div className="text-[10px] sm:text-[11px] text-teal-700/80 dark:text-teal-300/80 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>M {formatPaise(roomData.morningAmountPaise)}</span>
              <span aria-hidden="true" className="text-teal-300 dark:text-teal-700">
                ·
              </span>
              <span>N {formatPaise(roomData.nightAmountPaise)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
