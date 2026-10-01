import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { ReportSummary } from '../components/reports/ReportSummary.jsx';
import { SettlementPanel } from '../components/reports/SettlementPanel.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
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
  const month = selectedMonth || (isValidLogicalMonth(queryMonth) ? queryMonth : serverToday.date.slice(0, 7));
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
    <div className="page-stack">
      <PageHeader
        title="Monthly Report"
        description="Person-wise meal counts, plate shares, and bills calculated from daily physical plate allocations."
      />

      {serverToday.error && <ErrorState title="Report unavailable" message={serverToday.error} />}
      {serverToday.loading && !month && <LoadingState label="Loading current month" />}

      {month && (
        <section className="panel report-toolbar" aria-label="Report month controls">
          <button className="button button--quiet" type="button" onClick={() => moveMonth(-1)}>
            <ChevronLeft size={17} aria-hidden="true" /> Previous
          </button>
          <div>
            <strong>{monthLabel}</strong>
            <span>{data ? periodLabels[data.periodType] : 'Loading report'}</span>
          </div>
          <button className="button button--quiet" type="button" onClick={() => moveMonth(1)}>
            Next <ChevronRight size={17} aria-hidden="true" />
          </button>
          <button className="button button--quiet" type="button" onClick={() => setSelectedMonth(serverToday.date.slice(0, 7))}>
            Current month
          </button>
          <label className="month-input">
            <span className="sr-only">Choose report month</span>
            <input type="month" value={month} onChange={(event) => setSelectedMonth(event.target.value)} />
          </label>
        </section>
      )}

      {report.error && <ErrorState title="Report unavailable" message={report.error} actionLabel="Try again" onAction={report.refresh} />}
      {report.loading && !data && <LoadingState label="Calculating monthly report" />}

      {data && (
        <>
          {/* Permanent Fixed Meal Price Reference */}
          <section className="panel rate-panel rate-panel--fixed" aria-labelledby="meal-rates-title">
            <div className="rate-panel__summary">
              <div>
                <p className="page-heading__eyebrow">Product Pricing</p>
                <h2 id="meal-rates-title">Fixed Meal Prices</h2>
                <p>Prices are permanent product constants per physical plate.</p>
              </div>
            </div>

            <div className="fixed-rate-grid">
              <div className="fixed-rate-card fixed-rate-card--morning">
                <span className="fixed-rate-card__label">Morning Plate</span>
                <strong className="fixed-rate-card__price">{formatPaise(MORNING_PRICE_PAISE)}</strong>
                <span className="fixed-rate-card__note">per physical plate</span>
              </div>
              <div className="fixed-rate-card fixed-rate-card--night">
                <span className="fixed-rate-card__label">Night Plate</span>
                <strong className="fixed-rate-card__price">{formatPaise(NIGHT_PRICE_PAISE)}</strong>
                <span className="fixed-rate-card__note">per physical plate</span>
              </div>
            </div>
            {settlement.isClosed && (
              <p className="card-note">This month is closed. Reopen the month before changing meal rates.</p>
            )}
          </section>

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
              description={settlement.isClosed ? 'Frozen accounting statement' : 'Completed calendar month'}
              summary={getPastSummary()}
              isClosed={settlement.isClosed}
            />
          )}

          {data.periodType === 'current' && (
            <>
              <ReportSummary
                title={`Current total through ${formatLogicalDate(data.today, { day: 'numeric', month: 'short' })}`}
                description="Future days are excluded from this total"
                summary={data.toDate}
              />
              <ReportSummary
                title={`Projected ${monthLabel} total`}
                description="Full calendar month using the current schedule and shared plate plans"
                summary={data.projection}
              />
            </>
          )}

          {data.periodType === 'future' && (
            <ReportSummary
              title={`Projected ${monthLabel} total`}
              description="Projection only—not an amount due"
              summary={data.projection}
            />
          )}
        </>
      )}
    </div>
  );
}
