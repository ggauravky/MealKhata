import { AlertCircle, BedDouble, CheckCircle2, CircleDollarSign, Clock, Users, Wallet } from 'lucide-react';
import { Badge } from '../../ui/badge.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.jsx';
import { ROOMMATES } from '../../../lib/constants.js';
import { formatLogicalMonth } from '../../../lib/logicalMonth.js';
import { formatPaise } from '../../../lib/money.js';

export function AdminOverviewTab({ summary, month, onSwitchTab }) {
  if (!summary) {
    return (
      <Card className="border-slate-200 dark:border-slate-800 p-8 text-center">
        <p className="text-xs text-slate-400">Loading monthly overview...</p>
      </Card>
    );
  }

  const { household = {}, members = {} } = summary;
  const billedPaise = household.billedPaise || 0;
  const collectedPaise = household.collectedPaise || 0;
  const outstandingPaise = household.outstandingPaise || 0;
  const billedCount = household.billedCount || 0;

  return (
    <div className="space-y-6">
      {/* Top 3 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2 p-4">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total Room Charges
            </span>
            <CircleDollarSign className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {formatPaise(billedPaise)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {billedCount} member{billedCount === 1 ? '' : 's'} billed in {formatLogicalMonth(month)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2 p-4">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total Collected
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {formatPaise(collectedPaise)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Verified manual payments
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2 p-4">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total Outstanding
            </span>
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div
              className={`text-2xl font-bold ${
                outstandingPaise > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {formatPaise(outstandingPaise)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Pending dues across all rooms
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Member Breakdown Table */}
      <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <span>Member Room Statement Breakdown — {formatLogicalMonth(month)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Charge</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROOMMATES.map((roommate) => {
                const memberData = members[roommate.id];
                const hasCharge = Boolean(memberData?.charge);
                const roomInfo = memberData?.room;
                const status = memberData?.status || 'not_issued';

                return (
                  <TableRow key={roommate.id}>
                    <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                      {roommate.name}
                    </TableCell>
                    <TableCell>
                      {roomInfo ? `Room ${roomInfo.roomNumber}` : (
                        <span className="text-slate-400 italic">No room</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {hasCharge ? formatPaise(memberData.effectiveChargePaise) : (
                        <span className="text-slate-400 italic">Not issued</span>
                      )}
                    </TableCell>
                    <TableCell className="text-emerald-700 dark:text-emerald-400 font-medium">
                      {formatPaise(memberData?.paidPaise || 0)}
                    </TableCell>
                    <TableCell
                      className={
                        (memberData?.remainingPaise || 0) > 0
                          ? 'font-bold text-amber-700 dark:text-amber-400'
                          : 'text-slate-600 dark:text-slate-400'
                      }
                    >
                      {hasCharge ? formatPaise(memberData.remainingPaise || 0) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          status === 'paid' || status === 'overpaid'
                            ? 'taking'
                            : status === 'partial'
                              ? 'warning'
                              : status === 'overdue'
                                ? 'destructive'
                                : 'secondary'
                        }
                        className="text-[11px] py-0 px-2"
                      >
                        {status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
