import { Check, Minus, Moon, Settings2, SunMedium, Users } from 'lucide-react';
import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';
import {
  formatPlateCount,
  formatPlateFraction,
  formatPlateFractionAccessible,
  getMealPlateCount,
} from '../../lib/plates.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';
import { Badge } from '../ui/badge.jsx';
import { MemberAvatar } from '../ui/avatar.jsx';
import { Separator } from '../ui/separator.jsx';

const statusOptions = [
  { id: 'taking', label: 'Taking' },
  { id: 'skip', label: 'Skip' },
];

export function MealCard({
  mealType,
  title,
  meals = {},
  allocation = null,
  allocationDetails = null,
  editable = false,
  editableMemberIds = null,
  pendingRow,
  onChange,
  canConfigureSharing = false,
  onConfigureSharing = null,
}) {
  const isMorning = mealType === 'morning';
  const takingCount = getMealPlateCount(meals);

  // Derive physical plates and shared status
  let physicalPlates = takingCount;
  let isShared = false;

  if (allocationDetails) {
    physicalPlates = allocationDetails.physicalPlates ?? takingCount;
    isShared = Boolean(allocationDetails.isShared);
  } else if (allocation && allocation.mode === 'custom' && Array.isArray(allocation.plates)) {
    physicalPlates = allocation.plates.length;
    isShared = true;
  }

  // Calculate member share units if custom allocation
  const getMemberShareUnits = (memberId, status) => {
    if (status !== 'taking') {
      return 0;
    }
    if (allocationDetails?.members?.[memberId]) {
      return allocationDetails.members[memberId].shareUnits ?? 0;
    }
    if (allocation?.cost?.members?.[memberId]) {
      return allocation.cost.members[memberId].shareUnits ?? 0;
    }
    if (allocation && Array.isArray(allocation.plates)) {
      return allocation.plates.reduce((sum, p) => sum + (p.shares?.[memberId] ?? 0), 0);
    }
    return 6;
  };

  // Authoritative server-calculated cost or fallback to fixed price when taking
  const getMemberCostPaise = (memberId, status) => {
    if (status !== 'taking') {
      return 0;
    }
    if (allocation?.cost?.members?.[memberId]?.amountPaise !== undefined) {
      return allocation.cost.members[memberId].amountPaise;
    }
    if (allocationDetails?.members?.[memberId]?.amountPaise !== undefined) {
      return allocationDetails.members[memberId].amountPaise;
    }
    return isMorning ? 5000 : 7000;
  };

  const getShareText = (status, shareUnits, hasFractional) => {
    if (status === 'taking') {
      if (hasFractional) {
        return `${formatPlateFraction(shareUnits)} plate`;
      }
      return '1 plate';
    }
    if (status === 'skip') {
      return 'No plate';
    }
    return 'No meal set';
  };

  return (
    <Card className="border-slate-200/90 dark:border-slate-800">
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div>
          <div className="flex items-center gap-2">
            {isMorning ? (
              <SunMedium className="h-4 w-4 text-amber-500" />
            ) : (
              <Moon className="h-4 w-4 text-indigo-500" />
            )}
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </CardTitle>
            {isShared && (
              <Badge variant="shared" className="gap-1 text-[11px] py-0 px-1.5">
                <Users className="h-3 w-3" />
                <span>Shared</span>
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              {takingCount} taking
            </strong>
            <span aria-hidden="true"> · </span>
            <span>{formatPlateCount(physicalPlates)}</span>
            <span aria-hidden="true"> · </span>
            <span className="text-slate-400 dark:text-slate-500">
              {isMorning ? '₹50 / plate' : '₹70 / plate'}
            </span>
          </p>
        </div>

        {canConfigureSharing && onConfigureSharing && (
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={onConfigureSharing}
            className="h-8 gap-1.5 text-xs text-slate-700 dark:text-slate-300"
            aria-label={`Configure ${title} plate sharing`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>Sharing</span>
          </Button>
        )}
      </CardHeader>

      <CardContent>
        <div className="space-y-0">
          {ROOMMATES.map((member, index) => {
            const rawStatus = meals[member.id];
            const currentStatus = rawStatus === 'taking' || rawStatus === 'skip' ? rawStatus : 'not_set';
            const rowId = `${mealType}:${member.id}`;
            const pending = pendingRow === rowId;
            const isRowEditable = Boolean(
              onChange && (editableMemberIds ? editableMemberIds.includes(member.id) : editable),
            );

            const shareUnits = getMemberShareUnits(member.id, currentStatus);
            const hasFractionalShare = isShared && shareUnits > 0 && shareUnits < 6;
            const costPaise = getMemberCostPaise(member.id, currentStatus);
            const shareText = getShareText(currentStatus, shareUnits, hasFractionalShare);

            return (
              <div key={member.id}>
                {index > 0 && <Separator className="my-2" />}
                <div className="flex items-center justify-between gap-3 py-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <MemberAvatar
                      memberId={member.id}
                      name={member.name}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {member.name}
                        </span>
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-200">
                          {formatPaise(costPaise)}
                        </span>
                      </div>
                      <span
                        className={`text-[11px] block font-medium ${
                          hasFractionalShare
                            ? 'text-purple-700 dark:text-purple-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                        aria-label={hasFractionalShare ? formatPlateFractionAccessible(shareUnits) : undefined}
                      >
                        {shareText}
                      </span>
                    </div>
                  </div>

                  {isRowEditable ? (
                    <div
                      className="flex rounded-md bg-slate-100 p-0.5 dark:bg-slate-800/80 shrink-0"
                      role="group"
                      aria-label={`${member.name} ${title} status`}
                    >
                      {statusOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={currentStatus === option.id}
                          disabled={pending}
                          onClick={() => onChange(mealType, member.id, option.id)}
                          className={`flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium transition-all ${
                            currentStatus === option.id
                              ? option.id === 'taking'
                                ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                                : 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 shadow-xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                          }`}
                        >
                          {option.id === 'taking' ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Minus className="h-3 w-3" />
                          )}
                          <span>{pending && currentStatus !== option.id ? '...' : option.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="shrink-0">
                      {currentStatus === 'taking' ? (
                        <Badge variant="taking" className="gap-1 text-xs font-semibold">
                          <Check className="h-3 w-3" />
                          <span>Taking</span>
                        </Badge>
                      ) : currentStatus === 'skip' ? (
                        <Badge variant="skip" className="gap-1 text-xs">
                          <Minus className="h-3 w-3" />
                          <span>Skip</span>
                        </Badge>
                      ) : (
                        <Badge variant="not_set" className="text-xs">
                          <span>Not set</span>
                        </Badge>
                      )}
                    </div>
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
