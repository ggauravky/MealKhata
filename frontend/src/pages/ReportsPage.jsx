import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { ReportSummary } from '../components/reports/ReportSummary.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useMonthlyReport } from '../hooks/useMonthlyReport.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { api } from '../lib/api.js';
import { formatLogicalDate } from '../lib/logicalDate.js';
import { addLogicalMonths, formatLogicalMonth } from '../lib/logicalMonth.js';
import { formatPaise, paiseToRupeeInput, rupeesToPaise } from '../lib/money.js';

const periodLabels = {
  past: 'Past month',
  current: 'Current month',
  future: 'Future month',
};

export function ReportsPage() {
  const auth = useAuth();
  const serverToday = useServerToday();
  const [selectedMonth, setSelectedMonth] = useState('');
  const [savingRates, setSavingRates] = useState(false);
  const [rateError, setRateError] = useState('');
  const [rateMessage, setRateMessage] = useState('');
  const month = selectedMonth || serverToday.date.slice(0, 7);
  const report = useMonthlyReport(month);

  const moveMonth = (amount) => {
    if (month) {
      setSelectedMonth(addLogicalMonths(month, amount));
    }
  };

  const handleRateSubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const morningPricePaise = rupeesToPaise(form.get('morningPrice'));
    const nightPricePaise = rupeesToPaise(form.get('nightPrice'));

    setRateError('');
    setRateMessage('');

    if (morningPricePaise === null || nightPricePaise === null) {
      setRateError('Enter valid rupee amounts with no more than two decimal places.');
      return;
    }

    setSavingRates(true);
    try {
      const response = await api.put(`/api/billing/rates/${month}`, {
        morningPricePaise,
        nightPricePaise,
      });
      setRateMessage(response.changed ? 'Meal rates saved.' : 'Meal rates are already up to date.');
      report.refresh();
    } catch {
      setRateError('Unable to save meal rates. Please try again.');
    } finally {
      setSavingRates(false);
    }
  };

  const data = report.data;
  const monthLabel = formatLogicalMonth(month);

  return (
    <div className="page-stack">
      <PageHeader
        title="Monthly Report"
        description="Person-wise meal counts and bills calculated from the authoritative daily schedule."
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
          <section className="panel rate-panel" aria-labelledby="meal-rates-title">
            <div className="rate-panel__summary">
              <div>
                <p className="page-heading__eyebrow">{periodLabels[data.periodType]}</p>
                <h2 id="meal-rates-title">Meal Rates</h2>
                {data.rates.configured ? (
                  <p>Morning {formatPaise(data.rates.morningPricePaise)} <span aria-hidden="true">•</span> Night {formatPaise(data.rates.nightPricePaise)}</p>
                ) : (
                  <p>Meal rates have not been configured for {monthLabel}. Amounts cannot be calculated yet.</p>
                )}
              </div>
            </div>

            {auth.role === 'superadmin' && (
              <form className="rate-form" key={`${month}-${data.rates.revision}`} onSubmit={handleRateSubmit}>
                <label>
                  <span>Morning meal price (₹)</span>
                  <input name="morningPrice" inputMode="decimal" defaultValue={paiseToRupeeInput(data.rates.morningPricePaise)} placeholder="50" required />
                </label>
                <label>
                  <span>Night meal price (₹)</span>
                  <input name="nightPrice" inputMode="decimal" defaultValue={paiseToRupeeInput(data.rates.nightPricePaise)} placeholder="60" required />
                </label>
                <button className="button button--primary" type="submit" disabled={savingRates}>{savingRates ? 'Saving' : 'Save rates'}</button>
              </form>
            )}
            {rateError && <ErrorState compact title="Rates not saved" message={rateError} />}
            <p className="save-feedback" role="status" aria-live="polite">{rateMessage}</p>
          </section>

          {data.periodType === 'past' && (
            <ReportSummary title={`${monthLabel} total`} description="Completed calendar month" summary={data.toDate} />
          )}
          {data.periodType === 'current' && (
            <>
              <ReportSummary
                title={`Current total through ${formatLogicalDate(data.today, { day: 'numeric', month: 'short' })}`}
                description="Future days are excluded from this total"
                summary={data.toDate}
              />
              <ReportSummary title={`Projected ${monthLabel} total`} description="Full calendar month using the current schedule" summary={data.projection} />
            </>
          )}
          {data.periodType === 'future' && (
            <ReportSummary title={`Projected ${monthLabel} total`} description="Projection only—not an amount due" summary={data.projection} />
          )}
        </>
      )}
    </div>
  );
}

