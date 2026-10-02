import { ChevronLeft, ChevronRight, Moon, SunMedium } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { ReportSummary } from '../components/reports/ReportSummary.jsx';
import { SettlementPanel } from '../components/reports/SettlementPanel.jsx';
import { Card, CardHeader } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useMonthlyReport } from '../hooks/useMonthlyReport.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { useSettlement } from '../hooks/useSettlement.js';
import { formatLogicalDate } from '../lib/logicalDate.js';
import { addLogicalMonths, formatLogicalMonth, isValidLogicalMonth } from '../lib/logicalMonth.js';
import { formatPaise } from '../lib/money.js';
import { MORNING_PRICE_PAISE, NIGHT_PRICE_PAISE } from '../lib/plates.js';

const periodLabels = {
  past: 'Past month',
  current: 'Current month',
  future: 'Future month',
};

export function ReportsPage() {
  useDocumentTitle('Reports');
  const auth = useAuth();
  const serverToday = useServerToday();
  const [searchParams] = useSearchParams();
  const queryMonth = searchParams.get('month');
  const [selectedMonth, setSelectedMonth] = useState('');
  const month =
    selectedMonth ||
    (isValidLogicalMonth(queryMonth) ? queryMonth : serverToday.date.slice(0, 7));
  const report = useMonthlyReport(month);
  const settlement = useSettlement(month);

  const moveMonth = (amount) => {
    if (month) {
      setSelectedMonth(addLogicalMonths(month, amount));
    }
  };

  const data = report.data;
  const monthLabel = formatLogicalMonth(month);

  const getPastSummary = () => {
    if (!settlement.isClosed || !settlement.status?.activeSettlement) {
      return data.toDate;
    }

    const snapshot = settlement.status.activeSettlement.snapshot;
    if (snapshot.snapshotVersion === 2) {
      return {
        members: snapshot.members,
        room: snapshot.room,
      };
    }

    // Legacy Snapshot v1
    return {
      members: Object.fromEntries(
        Object.entries(snapshot.members).map(([id, m]) => [
          id,
          {
            morningCount: m.morningCount,
            nightCount: m.nightCount,
            totalMeals: m.totalPlates,
            amountPaise: m.billAmountPaise,
          },
        ]),
      ),
      room: {
        morningCount: snapshot.room.morningCount,
        nightCount: snapshot.room.nightCount,
        totalMeals: snapshot.room.totalPlates,
        amountPaise: snapshot.room.billAmountPaise,
      },
    };
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Monthly Report"
        description="Person-wise meal counts, plate shares, and room bills calculated from daily physical plate allocations."
      />

      {serverToday.error && (
        <ErrorState title="Report unavailable" message={serverToday.error} />
      )}

      {/* Month Toolbar Card */}
      {month && (
        <Card className="border-slate-200/90 dark:border-slate-800">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {monthLabel}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {data ? periodLabels[data.periodType] : 'Loading report...'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => moveMonth(-1)}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs font-medium"
                onClick={() => setSelectedMonth(serverToday.date.slice(0, 7))}
              >
                Current
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => moveMonth(1)}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <input
                type="month"
                value={month}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="h-8 rounded-sm border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ml-1 cursor-pointer"
                aria-label="Jump to report month"
              />
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Fixed Price Reference Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-slate-50/70 p-3.5 text-xs dark:border-slate-800/80 dark:bg-slate-900/40">
        <span className="text-slate-600 dark:text-slate-400">
          Fixed prices per physical plate:
        </span>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
            <SunMedium className="h-3.5 w-3.5" />
            <span>Morning: {formatPaise(MORNING_PRICE_PAISE)}</span>
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <span className="inline-flex items-center gap-1 font-semibold text-indigo-800 dark:text-indigo-300">
            <Moon className="h-3.5 w-3.5" />
            <span>Night: {formatPaise(NIGHT_PRICE_PAISE)}</span>
          </span>
        </div>
        {settlement.isClosed && (
          <p className="card-note w-full text-xs text-amber-800 dark:text-amber-300 pt-1">
            This month is closed. Reopen the month before changing meal rates.
          </p>
        )}
      </div>

      {report.error && (
        <ErrorState
          title="Report unavailable"
          message={report.error}
          actionLabel="Try again"
          onAction={report.refresh}
        />
      )}

      {report.loading && !data && (
        <div className="space-y-4">
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      )}

      {data && (
        <>
          {data.periodType === 'past' && (
            <SettlementPanel
              month={month}
              settlement={settlement}
              role={auth.role}
              onCloseMonth={async () => {
                await settlement.closeMonth();
                report.refresh();
              }}
              onReopenMonth={async (reason) => {
                await settlement.reopenMonth(reason);
                report.refresh();
              }}
            />
          )}

          {data.periodType === 'past' && (
            <ReportSummary
              title={`${monthLabel} total`}
              description={
                settlement.isClosed
                  ? 'Frozen accounting statement'
                  : 'Completed calendar month'
              }
              summary={getPastSummary()}
              isClosed={settlement.isClosed}
            />
          )}

          {data.periodType === 'current' && (
            <div className="space-y-6">
              <ReportSummary
                title={`Total through ${formatLogicalDate(data.today, { day: 'numeric', month: 'short' })}`}
                description="Future dates are excluded from this recorded total"
                summary={data.toDate}
              />
              <ReportSummary
                title={`Projected ${monthLabel} total`}
                description="Full calendar month estimate using current schedule"
                summary={data.projection}
              />
            </div>
          )}

          {data.periodType === 'future' && (
            <ReportSummary
              title={`Projected ${monthLabel} total`}
              description="Projection only — not an amount due"
              summary={data.projection}
            />
          )}
        </>
      )}
    </div>
  );
}
