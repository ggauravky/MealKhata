import { ChevronRight, History } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.jsx';
import { RoomFeeMonthDetailsDialog } from './RoomFeeMonthDetailsDialog.jsx';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { formatPaise } from '../../lib/money.js';

const STATUS_LABELS = {
  paid: 'Paid',
  partial: 'Partial',
  due: 'Due',
  overdue: 'Overdue',
  overpaid: 'Overpaid',
  upcoming: 'Upcoming',
  not_issued: 'Not issued',
};

const STATUS_BADGE_VARIANTS = {
  paid: 'taking',
  partial: 'warning',
  due: 'secondary',
  overdue: 'destructive',
  overpaid: 'taking',
  upcoming: 'secondary',
  not_issued: 'outline',
};

export function RoomFeeMonthList({ historyItems = [], room }) {
  const [selectedStatement, setSelectedStatement] = useState(null);

  if (!historyItems || historyItems.length === 0) {
    return (
      <Card className="border-slate-200/90 dark:border-slate-800">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-teal-600" />
            <span>Monthly Fee History</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <p className="text-xs text-slate-400 dark:text-slate-500 italic text-center py-6">
            No fee history recorded yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          <CardTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Monthly Fee History
          </CardTitle>
        </div>
        <span className="text-[11px] text-slate-400">Click a month for details</span>
      </CardHeader>

      <CardContent className="p-0">
        {/* Desktop Table View */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Room Fee</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyItems.map((item) => {
                const isIssued = Boolean(item.charge);
                const status = item.status || 'not_issued';
                return (
                  <TableRow
                    key={item.month}
                    onClick={() => setSelectedStatement(item)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60"
                  >
                    <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatLogicalMonth(item.month)}
                    </TableCell>
                    <TableCell>
                      {isIssued ? formatPaise(item.effectiveChargePaise) : '—'}
                    </TableCell>
                    <TableCell className="text-emerald-700 dark:text-emerald-400 font-medium">
                      {formatPaise(item.paidPaise)}
                    </TableCell>
                    <TableCell
                      className={
                        item.remainingPaise > 0
                          ? 'font-bold text-amber-700 dark:text-amber-400'
                          : 'text-slate-600 dark:text-slate-400'
                      }
                    >
                      {isIssued ? formatPaise(item.remainingPaise) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_BADGE_VARIANTS[status] || 'secondary'}
                        className="text-[11px] py-0 px-2"
                      >
                        {STATUS_LABELS[status] || status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Mobile Stacked Rows View */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {historyItems.map((item) => {
            const isIssued = Boolean(item.charge);
            const status = item.status || 'not_issued';
            return (
              <div
                key={item.month}
                onClick={() => setSelectedStatement(item)}
                className="p-3.5 flex items-center justify-between active:bg-slate-50 dark:active:bg-slate-900/50 cursor-pointer"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {formatLogicalMonth(item.month)}
                    </span>
                    <Badge
                      variant={STATUS_BADGE_VARIANTS[status] || 'secondary'}
                      className="text-[10px] py-0 px-1.5"
                    >
                      {STATUS_LABELS[status] || status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>Fee: {isIssued ? formatPaise(item.effectiveChargePaise) : '—'}</span>
                    <span>·</span>
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Paid: {formatPaise(item.paidPaise)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <span className="block text-[10px] text-slate-400">Remaining</span>
                    <span
                      className={`text-xs font-bold ${
                        item.remainingPaise > 0
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {isIssued ? formatPaise(item.remainingPaise) : '—'}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      {selectedStatement && (
        <RoomFeeMonthDetailsDialog
          open={Boolean(selectedStatement)}
          onClose={() => setSelectedStatement(null)}
          statement={selectedStatement}
          room={room}
          month={selectedStatement.month}
        />
      )}
    </Card>
  );
}
