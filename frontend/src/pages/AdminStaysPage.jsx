import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Ban,
  BedDouble,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileCheck,
  History,
  House,
  LogOut,
  PlusCircle,
  PencilLine,
  Receipt,
  Shield,
  ShieldAlert,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { CheckoutReviewWizard } from '../components/stays/CheckoutReviewWizard.jsx';
import { CancelStayDialog } from '../components/stays/CancelStayDialog.jsx';
import { CorrectAdmissionDialog } from '../components/stays/CorrectAdmissionDialog.jsx';
import { ConfigureDepositDialog } from '../components/stays/ConfigureDepositDialog.jsx';
import { DepositOverviewCard } from '../components/stays/DepositOverviewCard.jsx';
import { DepositTransactionDialog } from '../components/stays/DepositTransactionDialog.jsx';
import { DepositTransactionHistory } from '../components/stays/DepositTransactionHistory.jsx';
import { JoinStayDialog } from '../components/stays/JoinStayDialog.jsx';
import { RoomHistoryTimeline } from '../components/stays/RoomHistoryTimeline.jsx';
import { RoomTransferDialog } from '../components/stays/RoomTransferDialog.jsx';
import { RestoreResidentDialog } from '../components/stays/RestoreResidentDialog.jsx';
import { StayStatusBadge } from '../components/stays/StayStatusBadge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useMembers } from '../hooks/useMembers.js';
import {
  useAdminStays,
  useStayDetails,
  useStayFinancialReview,
} from '../hooks/useStays.js';
import { formatPaise } from '../lib/money.js';
import { getMemberRosterMetrics } from '../lib/memberContracts.js';
import { downloadClearancePdf, downloadLifetimeStatementPdf } from '../lib/stayDownload.js';

export function AdminStaysPage() {
  useDocumentTitle('Hostel Lifecycle Admin');
  const auth = useAuth();
  const isSuperAdmin = auth.role === 'superadmin';

  const {
    loading,
    error,
    stays = [],
    refresh,
    createStay,
    cancelStay,
    correctAdmission,
    transferRoom,
    recordDepositTransaction,
    voidDepositTransaction,
    finalizeCheckout,
  } = useAdminStays();
  const memberRoster = useMembers();

  const [activeTab, setActiveTab] = useState('overview');
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinMemberId, setJoinMemberId] = useState(null);
  const [cancelTargetStay, setCancelTargetStay] = useState(null);
  const [correctionTargetStay, setCorrectionTargetStay] = useState(null);
  const [transferTargetStay, setTransferTargetStay] = useState(null);
  const [depositTargetStay, setDepositTargetStay] = useState(null);
  const [depositActionType, setDepositActionType] = useState('RECEIVED');
  const [depositConfigTargetStay, setDepositConfigTargetStay] = useState(null);
  const [restoreTargetStay, setRestoreTargetStay] = useState(null);
  const [reviewingStayId, setReviewingStayId] = useState(null);
  const [selectedStayIdForDetails, setSelectedStayIdForDetails] = useState(null);

  // Queries for reviewing stay (checkout review)
  const reviewingStayDetails = useStayDetails(reviewingStayId);
  const reviewingFinancialReview = useStayFinancialReview(reviewingStayId);

  // Queries for detailed stay view
  const detailedStay = useStayDetails(selectedStayIdForDetails);

  // Derived metrics
  const activeStays = stays.filter((s) => s.status === 'ACTIVE');
  const checkoutRequestedStays = stays.filter((s) => s.status === 'CHECKOUT_REQUESTED' || s.status === 'CHECKOUT_PENDING');
  const checkedOutStays = stays.filter((s) => s.status === 'CHECKED_OUT');
  const rosterMetrics = getMemberRosterMetrics(memberRoster.data);

  const handleOpenDepositModal = (stay, type) => {
    setDepositTargetStay(stay);
    setDepositActionType(type);
  };

  const handleCheckoutFinalize = async (payload) => {
    if (!reviewingStayId) return;
    await finalizeCheckout(reviewingStayId, payload);
    setReviewingStayId(null);
    refresh();
  };

  const handleCreateStay = async (payload) => {
    const created = await createStay(payload);
    memberRoster.refresh();
    return created;
  };

  const handleCancelStay = async (payload) => {
    if (!cancelTargetStay) return;
    await cancelStay(cancelTargetStay.stayId, payload);
    setCancelTargetStay(null);
    memberRoster.refresh();
  };

  const handleCorrectAdmission = async (payload) => {
    if (!correctionTargetStay) return;
    await correctAdmission(correctionTargetStay.stayId, payload);
    setCorrectionTargetStay(null);
    memberRoster.refresh();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800/80 pb-4">
        <PageHeader
          eyebrow="Admin Management"
          title="Hostel Resident Lifecycle"
          description="Manage admissions, room assignments, transfers, security deposits, and departure clearances."
        />
        <Button
          size="sm"
          onClick={() => {
            setJoinMemberId(null);
            setJoinModalOpen(true);
          }}
          className="text-xs bg-teal-600 hover:bg-teal-700 text-white self-start sm:self-center"
        >
          <PlusCircle className="h-4 w-4 mr-1.5" />
          Register Resident Stay
        </Button>
      </div>

      {loading && stays.length === 0 && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      )}

      {error && stays.length === 0 && (
        <div className="p-4 rounded-lg bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* Inline 5-Step Checkout Review Wizard when reviewing a stay */}
      {reviewingStayId && reviewingStayDetails.stay && (
        <div className="mb-6">
          <CheckoutReviewWizard
            stay={reviewingStayDetails.stay}
            financialReview={reviewingFinancialReview.data}
            depositSummary={reviewingStayDetails.deposit}
            isSuperAdmin={isSuperAdmin}
            onFinalize={handleCheckoutFinalize}
            onCancel={() => setReviewingStayId(null)}
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 sm:grid-cols-6 h-auto p-1 gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="residents">Residents</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
          <TabsTrigger value="deposits">Deposits</TabsTrigger>
          <TabsTrigger value="checkouts">
            Checkouts
            {checkoutRequestedStays.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px]">
                {checkoutRequestedStays.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* TAB 1: OVERVIEW */}
        <TabsContent value="overview" className="space-y-6 pt-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Currently Assigned Residents
                </span>
                <div className="text-2xl font-bold text-teal-700 dark:text-teal-400">
                  {rosterMetrics.currentlyAssignedResidents}
                </div>
                <p className="text-[11px] text-slate-400">From current Room Assignments</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Active Registered Hostel Stays
                </span>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {rosterMetrics.activeRegisteredStays}
                </div>
                <p className="text-[11px] text-slate-400">Registered lifecycle records</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Members
                </span>
                <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">
                  {rosterMetrics.members}
                </div>
                <p className="text-[11px] text-slate-400">Canonical configured identities</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Assigned Rooms
                </span>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {rosterMetrics.assignedRooms}
                </div>
                <p className="text-[11px] text-slate-400">Distinct occupied rooms</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Need Stay Registration
                </span>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {rosterMetrics.membersNeedingStayRegistration}
                </div>
                <p className="text-[11px] text-slate-400">Assigned, not yet registered</p>
              </CardContent>
            </Card>
          </div>

          {/* Quick Active Residents Summary */}
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <UserCheck className="h-4 w-4 text-teal-600" />
                Current Assigned Resident Roster
              </CardTitle>
            </CardHeader>
            <CardContent>
              {memberRoster.loading && memberRoster.data.length === 0 ? (
                <Skeleton className="h-32 w-full rounded-lg" />
              ) : memberRoster.error ? (
                <ErrorState compact title="Resident roster unavailable" message={memberRoster.error} actionLabel="Try again" onAction={memberRoster.refresh} />
              ) : rosterMetrics.currentlyAssignedResidents === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">
                  No current Room Assignments are configured.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {memberRoster.data.filter((member) => member.assignment && member.room).map((member) => (
                    <div
                      key={member.memberId}
                      className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 capitalize text-sm">
                            {member.name}
                          </span>
                          {member.stay
                            ? <StayStatusBadge status={member.stay.status} />
                            : <span className="text-[11px] text-amber-700 dark:text-amber-400">Stay not registered</span>}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 flex items-center gap-3 text-[11px]">
                          <span>Room {member.room.roomNumber}</span>
                          <span>
                            Assigned: {member.assignment.effectiveFromDate}
                            {member.assignment.effectiveUntilDate ? ` to ${member.assignment.effectiveUntilDate}` : ' onward'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {member.stay ? (
                          <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTransferTargetStay(member.stay)}
                          className="h-7 text-xs border-slate-200 dark:border-slate-700"
                        >
                          <ArrowLeftRight className="h-3 w-3 mr-1" />
                          Transfer
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenDepositModal(member.stay, 'RECEIVED')}
                          className="h-7 text-xs border-slate-200 dark:border-slate-700"
                        >
                          <Wallet className="h-3 w-3 mr-1 text-teal-600" />
                          Deposit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReviewingStayId(member.stay.stayId)}
                          className="h-7 text-xs border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
                        >
                          <LogOut className="h-3 w-3 mr-1" />
                          Checkout
                        </Button>
                        {isSuperAdmin && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDepositConfigTargetStay(member.stay)}
                              className="h-7 text-xs text-slate-600 dark:text-slate-300"
                            >
                              <Shield className="h-3 w-3 mr-1" />
                              Requirement
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setCorrectionTargetStay(member.stay)}
                              className="h-7 text-xs text-teal-700 dark:text-teal-400"
                            >
                              <PencilLine className="h-3 w-3 mr-1" />
                              Correct Admission
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setCancelTargetStay(member.stay)}
                              className="h-7 text-xs text-rose-600 hover:text-rose-700"
                            >
                              <Ban className="h-3 w-3 mr-1" />
                              Cancel Incorrect Stay
                            </Button>
                          </>
                        )}
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setJoinMemberId(member.memberId); setJoinModalOpen(true); }}
                            className="h-7 text-xs text-teal-700 dark:text-teal-400"
                          >
                            Register Stay
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: RESIDENTS */}
        <TabsContent value="residents" className="space-y-6 pt-4">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <UserCheck className="h-4 w-4 text-teal-600" />
                Configured Members
              </CardTitle>
            </CardHeader>
            <CardContent>
              {memberRoster.loading && memberRoster.data.length === 0 && (
                <Skeleton className="h-32 w-full rounded-lg" />
              )}
              {memberRoster.error && (
                <ErrorState compact title="Member roster unavailable" message={memberRoster.error} actionLabel="Try again" onAction={memberRoster.refresh} />
              )}
              {!memberRoster.loading && !memberRoster.error && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[11px] text-slate-500 uppercase tracking-wider">
                        <TableHead>Member</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Room</TableHead>
                        <TableHead>Assignment Dates</TableHead>
                        <TableHead>Stay Status</TableHead>
                        <TableHead>Fee Plan</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
                      {memberRoster.data.map((member) => (
                        <TableRow key={member.memberId}>
                          <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                            <div>{member.name}</div>
                            <div className="text-[10px] font-normal text-slate-500">{member.memberId}</div>
                          </TableCell>
                          <TableCell>{member.account.exists ? (member.account.active ? 'Active' : 'Disabled') : 'Not configured'}</TableCell>
                          <TableCell>{member.room ? `Room ${member.room.roomNumber}` : 'Not assigned'}</TableCell>
                          <TableCell>
                            {member.assignment
                              ? `${member.assignment.effectiveFromDate}${member.assignment.effectiveUntilDate ? ` to ${member.assignment.effectiveUntilDate}` : ' onward'}`
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {member.stay
                              ? <StayStatusBadge status={member.stay.status} />
                              : member.assignment ? 'Room assigned · Stay not registered' : 'Not registered'}
                          </TableCell>
                          <TableCell>{member.feePlan ? formatPaise(member.feePlan.amountPaise) : 'Not configured'}</TableCell>
                          <TableCell className="text-right">
                            {member.stay ? (
                              <Button variant="ghost" size="sm" onClick={() => setSelectedStayIdForDetails(member.stay.stayId)} className="h-6 text-xs text-teal-600 hover:text-teal-700">
                                View
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setJoinMemberId(member.memberId);
                                  setJoinModalOpen(true);
                                }}
                                className="h-6 text-xs text-teal-600 hover:text-teal-700"
                              >
                                Register Stay
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Detailed View Modal or Drawer for Selected Stay */}
          {selectedStayIdForDetails && detailedStay.stay && (
            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
                <h4 className="font-semibold text-sm capitalize">
                  Stay Details — {detailedStay.stay.memberId} ({detailedStay.stay.joinedOn} to {detailedStay.stay.actualLeftOn || 'Present'})
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedStayIdForDetails(null)}
                  className="h-6 text-xs"
                >
                  Close
                </Button>
              </div>

              <RoomHistoryTimeline
                roomHistory={detailedStay.roomHistory}
                joinedOn={detailedStay.stay.joinedOn}
              />

              <DepositOverviewCard
                depositSummary={detailedStay.deposit}
                canManage={true}
                isSuperAdmin={isSuperAdmin}
                onOpenRecordDialog={(type) => handleOpenDepositModal(detailedStay.stay, type)}
              />

              <DepositTransactionHistory
                transactions={detailedStay.deposit?.transactions || []}
                isSuperAdmin={isSuperAdmin}
                onVoidTransaction={async (txId, payload) => {
                  await voidDepositTransaction(detailedStay.stay.stayId, txId, payload);
                  detailedStay.refresh();
                }}
              />
            </div>
          )}
        </TabsContent>

        {/* TAB 3: TRANSFERS */}
        <TabsContent value="transfers" className="space-y-6 pt-4">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <ArrowLeftRight className="h-4 w-4 text-teal-600" />
                Room Assignments & Transfers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Select an active resident below to transfer them to another room. Room capacity and date conflicts are enforced atomically.
                </p>

                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activeStays.map((s) => (
                    <div
                      key={s.stayId}
                      className="py-3 flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <span className="font-semibold capitalize text-slate-900 dark:text-slate-100">
                          {s.memberId}
                        </span>
                        <div className="text-slate-500 text-[11px]">
                          Current Room: <strong>Room {s.initialRoomId}</strong> • Joined: {s.joinedOn}
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTransferTargetStay(s)}
                        className="h-7 text-xs border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-400"
                      >
                        <ArrowLeftRight className="h-3 w-3 mr-1" />
                        Transfer Room
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: DEPOSITS */}
        <TabsContent value="deposits" className="space-y-6 pt-4">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <Shield className="h-4 w-4 text-teal-600" />
                Security Deposit Accounts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 mb-4">
                Security deposits are held in trust and do not count toward household mess revenue or spending.
              </p>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {stays.map((s) => (
                  <div key={s.stayId} className="py-3.5 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold capitalize text-slate-900 dark:text-slate-100 text-sm">
                            {s.memberId}
                          </span>
                          <StayStatusBadge status={s.status} />
                        </div>
                        <span className="text-[11px] text-slate-400">
                          Stay: {s.joinedOn} to {s.actualLeftOn || 'Present'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenDepositModal(s, 'RECEIVED')}
                          className="h-7 text-xs border-teal-200 text-teal-700 dark:text-teal-400"
                        >
                          <ArrowDownLeft className="h-3 w-3 mr-1" />
                          Receive
                        </Button>
                        {isSuperAdmin && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDepositConfigTargetStay(s)}
                              className="h-7 text-xs border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300"
                            >
                              <Shield className="h-3 w-3 mr-1" />
                              Requirement
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenDepositModal(s, 'DEDUCTED')}
                              className="h-7 text-xs border-amber-200 text-amber-700 dark:text-amber-400"
                            >
                              Deduct
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenDepositModal(s, 'REFUNDED')}
                              className="h-7 text-xs border-indigo-200 text-indigo-700 dark:text-indigo-400"
                            >
                              <ArrowUpRight className="h-3 w-3 mr-1" />
                              Refund
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 5: CHECKOUTS */}
        <TabsContent value="checkouts" className="space-y-6 pt-4">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <LogOut className="h-4 w-4 text-amber-600" />
                Departure Requests & Pending Checkouts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {checkoutRequestedStays.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">
                  No resident checkout requests pending.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {checkoutRequestedStays.map((s) => (
                    <div
                      key={s.stayId}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 capitalize text-sm">
                            {s.memberId}
                          </span>
                          <StayStatusBadge status={s.status} />
                        </div>
                        <div className="text-slate-600 dark:text-slate-400 text-xs">
                          Requested leaving date: <strong>{s.checkoutRequestedFor}</strong>
                          {s.checkoutRequestNote && ` • Reason: "${s.checkoutRequestNote}"`}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        onClick={() => setReviewingStayId(s.stayId)}
                        className="text-xs bg-amber-600 hover:bg-amber-700 text-white self-start sm:self-auto"
                      >
                        <LogOut className="h-3.5 w-3.5 mr-1" />
                        Review & Clear
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Finalized departures */}
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <CheckCircle2 className="h-4 w-4 text-teal-600" />
                Finalized Departures
              </CardTitle>
            </CardHeader>
            <CardContent>
              {checkedOutStays.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">
                  No finalized departures in archive.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {checkedOutStays.map((s) => (
                    <div
                      key={s.stayId}
                      className="py-2.5 flex items-center justify-between text-xs text-slate-700 dark:text-slate-300"
                    >
                      <div>
                        <span className="font-semibold capitalize text-slate-900 dark:text-slate-100">
                          {s.memberId}
                        </span>{' '}
                        — Left on {s.actualLeftOn} (Joined {s.joinedOn})
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => downloadLifetimeStatementPdf(s.stayId, s.memberId)}
                          className="h-7 text-xs text-teal-600"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Lifetime PDF
                        </Button>
                        {isSuperAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRestoreTargetStay(s)}
                            className="h-7 text-xs border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
                          >
                            Restore resident
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 6: HISTORY */}
        <TabsContent value="history" className="space-y-6 pt-4">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <History className="h-4 w-4 text-teal-600" />
                Hostel Lifecycle Audit & Clearance History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 mb-3">
                Immutable record of historical stays, room transfers, and clearance certificates.
              </p>

              <div className="space-y-3">
                {stays.map((s) => (
                  <div
                    key={s.stayId}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 capitalize">
                        {s.memberId} • Stay {s.stayId.slice(0, 8)}
                      </span>
                      <StayStatusBadge status={s.status} />
                    </div>
                    <div className="text-slate-500 text-[11px] flex flex-wrap gap-x-4">
                      <span>Joined: {s.joinedOn}</span>
                      {s.actualLeftOn && <span>Left: {s.actualLeftOn}</span>}
                      <span>Initial Room: Room {s.initialRoomId}</span>
                    </div>
                    {s.history && s.history.length > 0 && (
                      <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500 space-y-1">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          Audit Trail ({s.history.length} events):
                        </span>
                        {s.history.slice(-3).map((h, i) => (
                          <div key={i} className="pl-2 border-l border-teal-500/50">
                            {h.recordedAt?.slice(0, 10)}: {h.action} ({h.role || 'system'})
                            {h.reason && ` — ${h.reason}`}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Join/Admission Dialog */}
      <JoinStayDialog
        open={joinModalOpen}
        onOpenChange={setJoinModalOpen}
        onSubmitStay={handleCreateStay}
        isSuperAdmin={isSuperAdmin}
        initialMemberId={joinMemberId}
      />

      <CancelStayDialog
        open={Boolean(cancelTargetStay)}
        onOpenChange={(open) => !open && setCancelTargetStay(null)}
        stay={cancelTargetStay}
        onConfirm={handleCancelStay}
      />

      <CorrectAdmissionDialog
        open={Boolean(correctionTargetStay)}
        onOpenChange={(open) => !open && setCorrectionTargetStay(null)}
        stay={correctionTargetStay}
        onConfirm={handleCorrectAdmission}
      />

      {/* Room Transfer Dialog */}
      <RoomTransferDialog
        open={Boolean(transferTargetStay)}
        onOpenChange={(open) => !open && setTransferTargetStay(null)}
        stay={transferTargetStay}
        onSubmitTransfer={transferRoom}
      />

      {/* Deposit Transaction Dialog */}
      <DepositTransactionDialog
        open={Boolean(depositTargetStay)}
        onOpenChange={(open) => !open && setDepositTargetStay(null)}
        stayId={depositTargetStay?.stayId}
        type={depositActionType}
        depositHeldPaise={100_000_00} // dialog validates with stay details
        onSubmitTransaction={recordDepositTransaction}
      />

      <ConfigureDepositDialog
        open={Boolean(depositConfigTargetStay)}
        onOpenChange={(open) => !open && setDepositConfigTargetStay(null)}
        stay={depositConfigTargetStay}
        onConfigured={() => {
          refresh();
          detailedStay.refresh();
        }}
      />

      <RestoreResidentDialog
        open={Boolean(restoreTargetStay)}
        onOpenChange={(open) => !open && setRestoreTargetStay(null)}
        stay={restoreTargetStay}
        onRestored={() => {
          refresh();
          memberRoster.refresh();
        }}
      />
    </div>
  );
}
