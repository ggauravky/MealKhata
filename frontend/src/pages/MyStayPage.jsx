import { BedDouble, ChevronDown, History, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { ROOMMATES } from '../lib/constants.js';
import { getMyStayLifecycleState } from '../lib/stayContracts.js';

export function MyStayPage() {
  useDocumentTitle('My Hostel Stay');
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [selectedStayId, setSelectedStayId] = useState(null);

  const isMember = auth.role === 'member';
  const selectedMemberId = isMember ? null : searchParams.get('memberId');
  const hasValidSelection = isMember || ROOMMATES.some((member) => member.id === selectedMemberId);
  const myStayQuery = useMyStay(selectedMemberId, { enabled: hasValidSelection });
  const historyQuery = useMyStayHistory(selectedMemberId, { enabled: hasValidSelection });

  const overviewStay = myStayQuery.data?.stay;
  const lifecycleState = getMyStayLifecycleState(myStayQuery.data || {});
  const currentStayId = selectedStayId || overviewStay?.stayId || historyQuery.data?.[0]?.stayId || null;
  const stayDetails = useStayDetails(currentStayId);
  const lifetimeSummary = useStayLifetimeSummary(currentStayId);

  const handleMemberSelection = (memberId) => {
    setSelectedStayId(null);
    setSearchParams(memberId ? { memberId } : {});
  };

  if (!auth.authenticated || auth.role === 'viewer') {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <PageHeader
          eyebrow="Hostel Lifecycle"
          title="My Hostel Stay"
          description="Sign in to view your private room assignment and Stay record."
        />
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <BedDouble className="mx-auto h-8 w-8 text-teal-600" />
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Hostel accommodation details are available to authenticated residents and administrators.</p>
          <Link to="/login?next=/my-stay" className="mt-4 inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            <LogIn className="h-4 w-4" />
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        eyebrow="Hostel Lifecycle"
        title="My Hostel Stay"
        description={isMember
          ? 'Your current room and Stay status, with detailed records available when needed.'
          : 'Preview one resident at a time. Select a member explicitly to avoid showing the wrong account.'}
      />

      {!isMember && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="space-y-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
              Resident preview
              <select
                value={hasValidSelection ? selectedMemberId : ''}
                onChange={(event) => handleMemberSelection(event.target.value)}
                className="block min-w-56 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">Select a member</option>
                {ROOMMATES.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
            <Link to="/admin/stays" className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-300">
              Manage hostel stays
            </Link>
          </div>
        </div>
      )}

      {!hasValidSelection && (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          Select a resident to view their room assignment and Stay record.
        </div>
      )}

      {hasValidSelection && myStayQuery.loading && !overviewStay && (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      )}

      {hasValidSelection && myStayQuery.error && !overviewStay && (
        <ErrorState
          title="Stay information unavailable"
          message={myStayQuery.error}
          actionLabel="Try again"
          onAction={myStayQuery.refresh}
        />
      )}

      {hasValidSelection && !myStayQuery.loading && !myStayQuery.error && lifecycleState === 'assignment_only' && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-5 dark:border-teal-900 dark:bg-teal-950/30">
          <div className="flex items-start gap-3">
            <BedDouble className="mt-0.5 h-5 w-5 shrink-0 text-teal-700 dark:text-teal-300" />
            <div className="space-y-2">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                  Room {myStayQuery.data?.currentRoom?.roomNumber || myStayQuery.data?.currentAssignment?.roomId}
                </h2>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Room assigned · Stay not registered.</p>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Assignment starts {myStayQuery.data?.currentAssignment?.effectiveFromDate
                  || `${myStayQuery.data?.currentAssignment?.effectiveFromMonth}-01`}.
                {' '}An admin can link this existing assignment when registering the Stay.
              </p>
            </div>
          </div>
        </div>
      )}

      {hasValidSelection
        && !myStayQuery.loading
        && !historyQuery.loading
        && !myStayQuery.error
        && !historyQuery.error
        && lifecycleState === 'empty'
        && historyQuery.data?.length === 0 && (
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

      {historyQuery.data?.length > 1 && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
          <History className="h-4 w-4 text-teal-600 shrink-0" />
          <span className="font-medium text-slate-700 dark:text-slate-300">Select Stay Record:</span>
          <select
            value={currentStayId || ''}
            onChange={(event) => setSelectedStayId(event.target.value)}
            className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
          >
            {historyQuery.data.map((stay, index) => (
              <option key={stay.stayId} value={stay.stayId}>
                Stay {index + 1}: {stay.joinedOn} – {stay.actualLeftOn || 'Present'} ({stay.status})
              </option>
            ))}
          </select>
        </div>
      )}

      {stayDetails.stay && (
        <div className="space-y-6">
          <StayOverviewCard
            stay={stayDetails.stay}
            currentRoom={myStayQuery.data?.currentRoom}
            isMember={isMember}
            onRequestCheckout={() => setCheckoutDialogOpen(true)}
            onCancelRequest={myStayQuery.cancelCheckoutRequest}
          />

          <details className="group rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
              Detailed stay and financial records
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-6 border-t border-slate-100 p-4 dark:border-slate-800">
              <RoomHistoryTimeline roomHistory={stayDetails.roomHistory} joinedOn={stayDetails.stay.joinedOn} />
              <DepositOverviewCard depositSummary={stayDetails.deposit} canManage={false} />

              {lifetimeSummary.data && (
                <LifetimeFinancialOverview
                  stayId={stayDetails.stay.stayId}
                  memberId={stayDetails.stay.memberId}
                  lifetimeSummary={lifetimeSummary.data}
                />
              )}

              {stayDetails.clearances?.length > 0 && (
                <ClearanceStatusCard
                  stayId={stayDetails.stay.stayId}
                  memberId={stayDetails.stay.memberId}
                  clearances={stayDetails.clearances}
                />
              )}
            </div>
          </details>
        </div>
      )}

      {currentStayId && stayDetails.error && (
        <ErrorState title="Stay details unavailable" message={stayDetails.error} actionLabel="Try again" onAction={stayDetails.refresh} />
      )}

      {currentStayId && lifetimeSummary.error && (
        <ErrorState title="Lifetime summary unavailable" message={lifetimeSummary.error} actionLabel="Try again" onAction={lifetimeSummary.refresh} />
      )}

      <CheckoutRequestDialog
        open={checkoutDialogOpen}
        onOpenChange={setCheckoutDialogOpen}
        onSubmitRequest={myStayQuery.requestCheckout}
      />
    </div>
  );
}
