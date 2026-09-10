import { Link } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { LiveIndicator } from '../components/meals/LiveIndicator.jsx';
import { MealCard } from '../components/meals/MealCard.jsx';
import { PlateSummary } from '../components/meals/PlateSummary.jsx';
import { BrowserReminderControl } from '../components/reminders/BrowserReminderControl.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useMealDay } from '../hooks/useMealDay.js';
import { formatLogicalDate } from '../lib/logicalDate.js';

export function DashboardPage() {
  const auth = useAuth();
  const mealDay = useMealDay('today');
  return (
    <div className="page-stack">
      <div className="heading-with-status">
        <PageHeader
          eyebrow={mealDay.data ? formatLogicalDate(mealDay.data.date) : 'India time'}
          title="Today"
          description="Morning and night meals for the MealKhata household."
        />
        <LiveIndicator connected={mealDay.live} />
      </div>

      {mealDay.loading && !mealDay.data && <LoadingState label="Loading today's meals" />}

      {mealDay.error && (
        <ErrorState
          title="Meals unavailable"
          message={mealDay.error}
          actionLabel="Try again"
          onAction={mealDay.refresh}
        />
      )}

      {mealDay.data && (
        <>
          <section id="today-meals" className="meal-card-grid" aria-label="Today's meal schedule">
            <MealCard mealType="morning" title="Morning" meals={mealDay.data.meals.morning} />
            <MealCard mealType="night" title="Night" meals={mealDay.data.meals.night} />
          </section>

          <PlateSummary meals={mealDay.data.meals} label="Today's plate count" />

          <div className="meal-page-meta">
            <span>{mealDay.data.saved ? 'Saved meal schedule' : 'Default Taking schedule'}</span>
            {auth.authenticated && <Link className="text-link" to="/admin">Manage meals</Link>}
          </div>
          <BrowserReminderControl />
        </>
      )}
    </div>
  );
}
