import { ChevronLeft, ChevronRight, CookingPot, Download, Loader2, Moon, SunMedium } from 'lucide-react';
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
import { downloadMonthlyReport } from '../lib/reportDownload.js';

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
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
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

  const handleDownloadPdf = async () => {
    if (!month || isDownloading) return;
    if (!auth.authenticated) {
      setDownloadError('Please sign in to download monthly reports.');
      return;
    }
    setDownloadError(null);
    setIsDownloading(true);
    try {
      await downloadMonthlyReport(month);
    } catch (err) {
      setDownloadError(err.message || 'Failed to download monthly report.');
    } finally {
      setIsDownloading(false);
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
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs font-medium gap-1.5 border-teal-600/30 text-teal-800 hover:bg-teal-50 dark:border-teal-500/30 dark:text-teal-300 dark:hover:bg-teal-950/40 ml-auto sm:ml-1"
                onClick={handleDownloadPdf}
                disabled={isDownloading || !navigator.onLine}
                aria-label={`Download ${monthLabel} monthly report as PDF`}
                aria-busy={isDownloading}
                title={!auth.authenticated ? 'Sign in to download monthly report as PDF' : `Download ${monthLabel} report as PDF`}
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="hidden sm:inline">Preparing PDF…</span>
                    <span className="sm:hidden">Preparing…</span>
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Download PDF</span>
                    <span className="sm:hidden">PDF</span>
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {downloadError && (
        <div
          role="status"
          className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <span>{downloadError}</span>
          <button
            type="button"
            onClick={() => setDownloadError(null)}
            className="ml-2 font-semibold text-rose-900 hover:underline dark:text-rose-200 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
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
            (() => {
              const pastSummary = getPastSummary();
              const hasActivity =
                settlement.isClosed ||
                Boolean(data.hasMealActivity) ||
                Boolean(data.hasRecordedMeals) ||
                (pastSummary?.room?.totalPhysicalPlates > 0) ||
                (pastSummary?.room?.totalPlates > 0) ||
                (pastSummary?.room?.amountPaise > 0);

              if (!hasActivity) {
                return (
                  <Card className="border-slate-200/90 dark:border-slate-800 p-8 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-2">
                      <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 mb-2">
                        <CookingPot className="h-6 w-6" />
                      </div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        No meal activity recorded
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        No meals were recorded for {monthLabel}.
                      </p>
                      <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400 pt-3 border-t border-slate-100 dark:border-slate-800 w-full justify-center font-medium">
                        <span>Morning plates <strong>0</strong></span>
                        <span>·</span>
                        <span>Night plates <strong>0</strong></span>
                        <span>·</span>
                        <span>Room bill <strong>₹0</strong></span>
                      </div>
                    </div>
                  </Card>
                );
              }

              return (
                <ReportSummary
                  title={`${monthLabel} total`}
                  description={
                    settlement.isClosed
                      ? 'Frozen accounting statement'
                      : 'Completed calendar month'
                  }
                  summary={pastSummary}
                  isClosed={settlement.isClosed}
                />
              );
            })()
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
