import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';
import { formatPlateFraction, formatPlateFractionAccessible } from '../../lib/plates.js';

function MemberMealCounts({ summary }) {
  const hasShareUnits = summary?.morningShareUnits !== undefined;

  if (hasShareUnits) {
    const morningEquiv = formatPlateFraction(summary.morningShareUnits);
    const nightEquiv = formatPlateFraction(summary.nightShareUnits);
    const totalEquiv = formatPlateFraction(summary.totalShareUnits);

    return (
      <dl className="report-counts">
        <div>
          <dt>Morning</dt>
          <dd>
            <span>{summary.morningParticipationCount} meals</span>
            <small className="report-share-equiv" aria-label={formatPlateFractionAccessible(summary.morningShareUnits)}>
              ({morningEquiv} {summary.morningShareUnits === 6 ? 'plate' : 'plates'})
            </small>
          </dd>
        </div>
        <div>
          <dt>Night</dt>
          <dd>
            <span>{summary.nightParticipationCount} meals</span>
            <small className="report-share-equiv" aria-label={formatPlateFractionAccessible(summary.nightShareUnits)}>
              ({nightEquiv} {summary.nightShareUnits === 6 ? 'plate' : 'plates'})
            </small>
          </dd>
        </div>
        <div className="report-counts__total">
          <dt>Plate Share</dt>
          <dd>
            <strong>{totalEquiv}</strong>
            <small> plates</small>
          </dd>
        </div>
      </dl>
    );
  }

  // Fallback for legacy v1 snapshots
  return (
    <dl className="report-counts">
      <div><dt>Morning meals</dt><dd>{summary?.morningCount ?? 0}</dd></div>
      <div><dt>Night meals</dt><dd>{summary?.nightCount ?? 0}</dd></div>
      <div><dt>Total plates</dt><dd>{summary?.totalPlates ?? summary?.totalMeals ?? 0}</dd></div>
    </dl>
  );
}

function RoomMealCounts({ summary }) {
  const hasPhysical = summary?.morningPhysicalPlates !== undefined;

  if (hasPhysical) {
    return (
      <dl className="report-counts report-counts--room">
        <div>
          <dt>Morning Plates</dt>
          <dd>
            <strong>{summary.morningPhysicalPlates}</strong>
            <small> ({summary.morningParticipants} eating)</small>
          </dd>
        </div>
        <div>
          <dt>Night Plates</dt>
          <dd>
            <strong>{summary.nightPhysicalPlates}</strong>
            <small> ({summary.nightParticipants} eating)</small>
          </dd>
        </div>
        <div className="report-counts__total">
          <dt>Total Physical</dt>
          <dd>
            <strong>{summary.totalPhysicalPlates}</strong>
            <small> plates ordered</small>
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <dl className="report-counts report-counts--room">
      <div><dt>Morning meals</dt><dd>{summary?.morningCount ?? 0}</dd></div>
      <div><dt>Night meals</dt><dd>{summary?.nightCount ?? 0}</dd></div>
      <div><dt>Total plates</dt><dd>{summary?.totalPlates ?? summary?.totalMeals ?? 0}</dd></div>
    </dl>
  );
}

export function ReportSummary({ title, description, summary, isClosed = false }) {
  const sectionId = `report-${title.replaceAll(' ', '-').toLowerCase()}`;

  return (
    <section className={`report-period${isClosed ? ' report-period--closed' : ''}`} aria-labelledby={sectionId}>
      <header>
        <div className="report-period__title-row">
          <h2 id={sectionId}>{title}</h2>
          {isClosed && <span className="final-tag">FINAL</span>}
        </div>
        <p>{description}</p>
      </header>

      <div className="member-report-grid">
        {ROOMMATES.map((member) => {
          const memberSummary = summary?.members?.[member.id] || { amountPaise: 0 };
          return (
            <article className="member-report-card" key={member.id}>
              <div className="member-report-card__heading">
                <span className="roommate__avatar" aria-hidden="true">{member.initial}</span>
                <div>
                  <h3>{member.name}</h3>
                  {isClosed && <span className="member-card__final-label">Closed statement</span>}
                </div>
              </div>
              <MemberMealCounts summary={memberSummary} />
              <strong className="report-amount">{formatPaise(memberSummary.amountPaise)}</strong>
            </article>
          );
        })}
      </div>

      {summary?.room && (
        <article className="room-report-card">
          <div className="room-report-card__total-col">
            <p>Room total {isClosed && <span className="room-card__final-label">(Final)</span>}</p>
            <strong className="report-amount report-amount--room">{formatPaise(summary.room.amountPaise)}</strong>
          </div>
          <RoomMealCounts summary={summary.room} />
        </article>
      )}
    </section>
  );
}
