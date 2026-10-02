import { Check, CookingPot, Moon, SunMedium, Users, UtensilsCrossed } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatPlateCount, formatPlateFraction } from '../../lib/plates.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';
import { Badge } from '../ui/badge.jsx';
import { MemberAvatar } from '../ui/avatar.jsx';
import { Separator } from '../ui/separator.jsx';

export function HouseholdTodayCard({ household, today, role, isDefaultSchedule = false }) {
  if (!household) return null;

  const {
    morningPlates = 0,
    nightPlates = 0,
    totalPlates = 0,
    members = [],
  } = household;

  // Defensive fallback ensuring people eating count matches Taking members
  const effectiveMorningEating =
    household.morningEating !== undefined
      ? household.morningEating
      : members.filter((m) => m.morning === 'taking').length;

  const effectiveNightEating =
    household.nightEating !== undefined
      ? household.nightEating
      : members.filter((m) => m.night === 'taking').length;

  const canManage = role === 'admin' || role === 'superadmin';

  return (
    <Card className="overflow-hidden border-slate-200/90 dark:border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2.5">
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Today's kitchen
          </CardTitle>
          {isDefaultSchedule && (
            <Badge variant="secondary" className="text-[11px] font-normal py-0">
              Default schedule
            </Badge>
          )}
        </div>
        {canManage && (
          <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
            <Link to={`/admin?date=${today}`}>
              <UtensilsCrossed className="h-3.5 w-3.5" />
              <span>Manage Today</span>
            </Link>
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Morning, Night and Total Tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Morning Tile */}
          <div className="flex flex-col justify-between rounded-lg border border-amber-200/80 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                <SunMedium className="h-4 w-4" />
                <span>Morning</span>
              </span>
              <span className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                ₹50 / plate
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-amber-950 dark:text-amber-100">
                {formatPlateCount(morningPlates)}
              </span>
              <span className="text-xs text-amber-800/90 dark:text-amber-300/90 font-medium">
                {effectiveMorningEating} {effectiveMorningEating === 1 ? 'eating' : 'eating'}
              </span>
            </div>
          </div>

          {/* Night Tile */}
          <div className="flex flex-col justify-between rounded-lg border border-indigo-200/80 bg-indigo-50/60 p-4 dark:border-indigo-900/40 dark:bg-indigo-950/20">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-800 dark:text-indigo-300">
                <Moon className="h-4 w-4" />
                <span>Night</span>
              </span>
              <span className="text-[11px] text-indigo-700/80 dark:text-indigo-400/80">
                ₹70 / plate
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-indigo-950 dark:text-indigo-100">
                {formatPlateCount(nightPlates)}
              </span>
              <span className="text-xs text-indigo-800/90 dark:text-indigo-300/90 font-medium">
                {effectiveNightEating} {effectiveNightEating === 1 ? 'eating' : 'eating'}
              </span>
            </div>
          </div>
        </div>

        {/* Total Physical Plates Summary Strip */}
        <div className="flex items-center justify-between rounded-md bg-slate-50 px-3.5 py-2 text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-400">
          <span className="flex items-center gap-2">
            <CookingPot className="h-4 w-4 text-slate-500" />
            <span>Total physical plates today</span>
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
            {formatPlateCount(totalPlates)}
          </span>
        </div>

        {/* Member status list */}
        <div className="pt-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2">
            Roommates
          </span>
          <div className="space-y-0">
            {members.map((member, index) => {
              const isMorningShared =
                member.morningShareUnits !== undefined &&
                member.morningShareUnits < 6 &&
                member.morningShareUnits > 0;
              const isNightShared =
                member.nightShareUnits !== undefined &&
                member.nightShareUnits < 6 &&
                member.nightShareUnits > 0;

              const totalPlateDisplay =
                member.totalShareUnits !== undefined
                  ? `${formatPlateFraction(member.totalShareUnits)} ${member.totalShareUnits === 6 ? 'plate' : 'plates'}`
                  : formatPlateCount(member.plates ?? 0);

              return (
                <div key={member.memberId}>
                  {index > 0 && <Separator className="my-2.5" />}
                  <div className="flex items-center justify-between gap-3 py-0.5">
                    <div className="flex items-center gap-2.5 min-w-[90px]">
                      <MemberAvatar
                        memberId={member.memberId}
                        name={member.name}
                        size="sm"
                      />
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {member.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
                      {/* Morning status */}
                      {member.morning === 'taking' ? (
                        isMorningShared ? (
                          <Badge variant="shared" className="gap-1 text-[11px] py-0">
                            <Users className="h-3 w-3" />
                            <span>M: {formatPlateFraction(member.morningShareUnits)}</span>
                          </Badge>
                        ) : (
                          <Badge variant="taking" className="gap-1 text-[11px] py-0">
                            <Check className="h-3 w-3" />
                            <span>M: Taking</span>
                          </Badge>
                        )
                      ) : (
                        <Badge variant="skip" className="text-[11px] py-0">
                          M: Skip
                        </Badge>
                      )}

                      {/* Night status */}
                      {member.night === 'taking' ? (
                        isNightShared ? (
                          <Badge variant="shared" className="gap-1 text-[11px] py-0">
                            <Users className="h-3 w-3" />
                            <span>N: {formatPlateFraction(member.nightShareUnits)}</span>
                          </Badge>
                        ) : (
                          <Badge variant="taking" className="gap-1 text-[11px] py-0">
                            <Check className="h-3 w-3" />
                            <span>N: Taking</span>
                          </Badge>
                        )
                      ) : (
                        <Badge variant="skip" className="text-[11px] py-0">
                          N: Skip
                        </Badge>
                      )}

                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 pl-1 hidden sm:inline-block">
                        {totalPlateDisplay}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
