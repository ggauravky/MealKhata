import { HostelStay } from '../stays/stay.model.js';
import { STAY_STATUSES } from '../stays/stay.constants.js';
import { lastDateOfMonth } from '../utils/month.js';

function transactionRequiredError() {
  const error = new Error('Database transaction support is required. No records were changed.');
  error.statusCode = 503;
  error.details = { code: 'TRANSACTION_REQUIRED' };
  return error;
}

function clearanceConflictError() {
  const error = new Error(
    'This financial record belongs to a completed Stay. A Super Admin must open an audited clearance review before changing the record.',
  );
  error.statusCode = 409;
  error.details = { code: 'CLEARANCE_REVIEW_REQUIRED' };
  return error;
}

function dateRange({ effectiveDate = null, effectiveMonth = null }) {
  if (effectiveDate) return { start: effectiveDate, end: effectiveDate };
  if (effectiveMonth) return { start: `${effectiveMonth}-01`, end: lastDateOfMonth(effectiveMonth) };
  return null;
}

export async function guardFinancialMutation({
  memberId = null,
  memberIds = [],
  effectiveDate = null,
  effectiveMonth = null,
  stayId = null,
  actorRole = null,
  session,
}) {
  if (!session) throw transactionRequiredError();

  const affectedMemberIds = [...new Set([memberId, ...memberIds].filter(Boolean))];
  const query = stayId ? { stayId } : { memberId: { $in: affectedMemberIds } };
  const stays = await HostelStay.find(query).session(session).lean();
  if (stayId && stays.some((stay) => stay.status === STAY_STATUSES.SUPERSEDED)) {
    const error = new Error('This Stay has been superseded and its financial history is immutable.');
    error.statusCode = 409;
    error.details = { code: 'HISTORICAL_STAY_SUPERSEDED' };
    throw error;
  }
  const range = dateRange({ effectiveDate, effectiveMonth });
  const matching = stays.filter((stay) => {
    if ([STAY_STATUSES.CANCELLED, STAY_STATUSES.SUPERSEDED].includes(stay.status)) return false;
    if (!range) return true;
    const end = stay.actualLeftOn || '9999-12-31';
    return stay.joinedOn <= range.end && end >= range.start;
  });

  const completedStays = matching.filter((stay) => stay.status === STAY_STATUSES.CHECKED_OUT);
  if (completedStays.some((stay) => !stay.clearanceReviewOpenedAt || actorRole !== 'superadmin')) {
    throw clearanceConflictError();
  }
  if (matching.length === 0) return;

  await HostelStay.updateMany(
    { stayId: { $in: matching.map((stay) => stay.stayId) } },
    { $inc: { financialRevision: 1 } },
    { session },
  );
}

export async function guardCheckoutFinancialSnapshot({
  stayId,
  expectedFinancialRevision = null,
  session,
}) {
  if (!session) throw transactionRequiredError();
  const query = { stayId, status: { $ne: STAY_STATUSES.CANCELLED } };
  if (Number.isInteger(expectedFinancialRevision)) {
    query.financialRevision = expectedFinancialRevision;
  }
  const result = await HostelStay.updateOne(
    query,
    { $inc: { financialRevision: 1 } },
    { session },
  );
  if (result.matchedCount !== 1) {
    const error = new Error('Stay changed while checkout finances were being reviewed. Refresh and retry.');
    error.statusCode = 409;
    throw error;
  }
}

