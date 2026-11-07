import {
  BedDouble,
  Calendar,
  Clock,
  Download,
  FileSpreadsheet,
  House,
  LogOut,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { formatPaise } from '../../lib/money.js';
import { downloadLifetimeStatementPdf } from '../../lib/stayDownload.js';
import { Button } from '../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { StayStatusBadge } from './StayStatusBadge.jsx';

export function StayOverviewCard({
  stay,
  currentRoom = null,
  isMember = false,
  onRequestCheckout = null,
  onCancelRequest = null,
}) {
  const [downloading, setDownloading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');

  if (!stay) return null;

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadLifetimeStatementPdf(stay.stayId, stay.memberId);
    } catch (err) {
      setError(err?.message || 'Failed to download statement.');
    } finally {
      setDownloading(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!onCancelRequest) return;
    setCancelling(true);
    setError('');
    try {
      await onCancelRequest();
    } catch (err) {
      setError(err?.message || 'Failed to cancel checkout request.');
    } finally {
      setCancelling(false);
    }
  };

  const isActive = stay.status === 'ACTIVE';
  const isRequested = stay.status === 'CHECKOUT_REQUESTED';
  const isPending = stay.status === 'CHECKOUT_PENDING';
  const isCheckedOut = stay.status === 'CHECKED_OUT';

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div className="space-y-0.5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <House className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Hostel Stay Overview
          </CardTitle>
          <span className="text-xs text-slate-500 capitalize">
            Resident: {stay.memberId}
          </span>
        </div>
        <StayStatusBadge status={stay.status} />
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="p-2.5 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* Stay Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-slate-400 block text-[11px]">Admission Date</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm mt-0.5 block">
              {stay.joinedOn}
            </span>
          </div>

          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-slate-400 block text-[11px]">
              {isCheckedOut ? 'Actual Left Date' : 'Current Room'}
            </span>
            <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm mt-0.5 block">
              {isCheckedOut
                ? stay.actualLeftOn
                : currentRoom?.roomNumber
                  ? `Room ${currentRoom.roomNumber}`
                  : `Room ${stay.initialRoomId || '—'}`}
            </span>
          </div>

          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-slate-400 block text-[11px]">
              {isCheckedOut ? 'Stay Concluded' : 'Expected Departure'}
            </span>
            <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm mt-0.5 block">
              {isCheckedOut
                ? 'Departed'
                : stay.expectedLeaveOn || 'Not Scheduled'}
            </span>
          </div>

          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-slate-400 block text-[11px]">Departure Status</span>
            <span className="font-medium text-slate-700 dark:text-slate-300 text-xs mt-1 block">
              {isActive
                ? 'Active Resident'
                : isRequested
                ? `Requested for ${stay.checkoutRequestedFor}`
                : isPending
                ? 'Review in Progress'
                : 'Checked Out'}
            </span>
          </div>
        </div>

        {/* Departure Request Alert Banner if requested */}
        {isRequested && (
          <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Checkout requested for <strong>{stay.checkoutRequestedFor}</strong>.
                {stay.checkoutRequestNote && ` ("${stay.checkoutRequestNote}")`}
              </span>
            </div>
            {isMember && onCancelRequest && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelRequest}
                disabled={cancelling}
                className="h-7 text-xs border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 self-end sm:self-auto"
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                {cancelling ? 'Cancelling...' : 'Cancel Request'}
              </Button>
            )}
          </div>
        )}

        {/* Pending Review Banner */}
        {isPending && (
          <div className="p-3 rounded-md bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/50 flex items-center gap-2 text-xs text-indigo-900 dark:text-indigo-200">
            <Clock className="h-4 w-4 shrink-0 text-indigo-600" />
            <span>
              Admin checkout and financial obligation verification is currently pending.
            </span>
          </div>
        )}

        {/* Action Row */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
            className="text-xs"
          >
            <Download className="h-3.5 w-3.5 mr-1.5 text-teal-600 dark:text-teal-400" />
            {downloading ? 'Preparing...' : 'Download Lifetime Statement'}
          </Button>

          {isMember && isActive && onRequestCheckout && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRequestCheckout}
              className="text-xs text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            >
              <LogOut className="h-3.5 w-3.5 mr-1.5" />
              Request Checkout
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
