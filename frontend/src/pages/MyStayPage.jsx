import { History } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { CheckoutRequestDialog } from '../components/stays/CheckoutRequestDialog.jsx';
import { ClearanceStatusCard } from '../components/stays/ClearanceStatusCard.jsx';
import { DepositOverviewCard } from '../components/stays/DepositOverviewCard.jsx';
import { LifetimeFinancialOverview } from '../components/stays/LifetimeFinancialOverview.jsx';
import { RoomHistoryTimeline } from '../components/stays/RoomHistoryTimeline.jsx';
import { StayEmptyState } from '../components/stays/StayEmptyState.jsx';
import { StayOverviewCard } from '../components/stays/StayOverviewCard.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useMyStay, useMyStayHistory, useStayDetails, useStayLifetimeSummary } from '../hooks/useStays.js';

export function MyStayPage() {
  useDocumentTitle('My Hostel Stay');
  const auth = useAuth();
  const myStayQuery = useMyStay();
  const historyQuery = useMyStayHistory();

  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [selectedStayId, setSelectedStayId] = useState(null);

  const activeStay = myStayQuery.data?.stay;

  // Use either active stay or a selected historical stay
  const currentStayId = selectedStayId || activeStay?.stayId || historyQuery.data?.[0]?.stayId;
  const stayDetails = useStayDetails(currentStayId);
  const lifetimeSummary = useStayLifetimeSummary(currentStayId);

  const isMember = auth.role === 'member';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        eyebrow="Hostel Lifecycle"
        title="My Hostel Stay"
        description="Your admission record, room occupancy timeline, security deposit, and lifetime financial summary."
      />

      {myStayQuery.loading && !activeStay && (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-60 w-full rounded-lg" />
        </div>
      )}

      {myStayQuery.error && !activeStay && (
        <ErrorState
          title="Stay information unavailable"
          message={myStayQuery.error}
          actionLabel="Try again"
          onAction={myStayQuery.refresh}
        />
      )}

      {/* When no stay is registered at all */}
      {!myStayQuery.loading && !historyQuery.loading && !myStayQuery.error && !historyQuery.error && !activeStay && historyQuery.data?.length === 0 && (
        <StayEmptyState isMember={isMember} />
      )}

      {historyQuery.error && (
        <ErrorState
          title="Stay history unavailable"
          message={historyQuery.error}
          actionLabel="Try again"
          onAction={historyQuery.refresh}
        />
      )}

      {/* Historical Stays Selector if multiple stays exist */}
      {historyQuery.data?.length > 1 && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
          <History className="h-4 w-4 text-teal-600 shrink-0" />
          <span className="font-medium text-slate-700 dark:text-slate-300">Select Stay Record:</span>
          <select
            value={currentStayId || ''}
            onChange={(e) => setSelectedStayId(e.target.value)}
            className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
          >
            {historyQuery.data.map((s, idx) => (
              <option key={s.stayId} value={s.stayId}>
                Stay {idx + 1}: {s.joinedOn} – {s.actualLeftOn || 'Present'} ({s.status})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Active or Selected Stay Details */}
      {stayDetails.stay && (
        <div className="space-y-6">
          {/* Stay Overview Card */}
          <StayOverviewCard
            stay={stayDetails.stay}
            isMember={isMember}
            onRequestCheckout={() => setCheckoutDialogOpen(true)}
            onCancelRequest={myStayQuery.cancelCheckoutRequest}
          />

          {/* Room History Timeline */}
          <RoomHistoryTimeline
            roomHistory={stayDetails.roomHistory}
            joinedOn={stayDetails.stay.joinedOn}
          />

          {/* Security Deposit Overview */}
          <DepositOverviewCard
            depositSummary={stayDetails.deposit}
            canManage={false}
          />

          {/* Lifetime Financial Summary */}
          {lifetimeSummary.data && (
            <LifetimeFinancialOverview
              stayId={stayDetails.stay.stayId}
              memberId={stayDetails.stay.memberId}
              lifetimeSummary={lifetimeSummary.data}
            />
          )}

          {/* Final Clearance Certificate (if checked out) */}
          {stayDetails.clearances?.length > 0 && (
            <ClearanceStatusCard
              stayId={stayDetails.stay.stayId}
              memberId={stayDetails.stay.memberId}
              clearances={stayDetails.clearances}
            />
          )}
        </div>
      )}

      {currentStayId && stayDetails.error && (
        <ErrorState
          title="Stay details unavailable"
          message={stayDetails.error}
          actionLabel="Try again"
          onAction={stayDetails.refresh}
        />
      )}

      {currentStayId && lifetimeSummary.error && (
        <ErrorState
          title="Lifetime summary unavailable"
          message={lifetimeSummary.error}
          actionLabel="Try again"
          onAction={lifetimeSummary.refresh}
        />
      )}

      {/* Checkout Request Dialog */}
      <CheckoutRequestDialog
        open={checkoutDialogOpen}
        onOpenChange={setCheckoutDialogOpen}
        onSubmitRequest={myStayQuery.requestCheckout}
      />
    </div>
  );
}
