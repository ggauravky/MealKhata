import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';

function MealCounts({ summary }) {
  return (
    <dl className="report-counts">
      <div><dt>Morning meals</dt><dd>{summary.morningCount}</dd></div>
      <div><dt>Night meals</dt><dd>{summary.nightCount}</dd></div>
      <div><dt>Total plates</dt><dd>{summary.totalMeals}</dd></div>
    </dl>
  );
}

export function ReportSummary({ title, description, summary }) {
  const sectionId = `report-${title.replaceAll(' ', '-').toLowerCase()}`;

  return (
    <section className="report-period" aria-labelledby={sectionId}>
      <header>
        <h2 id={sectionId}>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="member-report-grid">
        {ROOMMATES.map((member) => {
          const memberSummary = summary.members[member.id];
          return (
            <article className="member-report-card" key={member.id}>
              <div className="member-report-card__heading">
                <span className="roommate__avatar" aria-hidden="true">{member.initial}</span>
                <h3>{member.name}</h3>
              </div>
              <MealCounts summary={memberSummary} />
              <strong className="report-amount">{formatPaise(memberSummary.amountPaise)}</strong>
            </article>
          );
        })}
      </div>
      <article className="room-report-card">
        <div>
          <p>Room total</p>
          <strong>{formatPaise(summary.room.amountPaise)}</strong>
        </div>
        <MealCounts summary={summary.room} />
      </article>
    </section>
  );
}
