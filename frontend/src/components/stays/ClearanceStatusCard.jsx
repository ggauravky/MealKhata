import { AlertTriangle, CheckCircle2, Download, FileCheck, History, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { formatPaise } from '../../lib/money.js';
import { downloadClearancePdf } from '../../lib/stayDownload.js';
import { Button } from '../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { ClearanceStatusBadge } from './StayStatusBadge.jsx';

export function ClearanceStatusCard({
  stayId,
  memberId,
  clearances = [],
}) {
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadError, setDownloadError] = useState('');

  if (!clearances || clearances.length === 0) {
    return null;
  }

  // Display latest clearance prominently, and any historical ones below
  const latestClearance = clearances[clearances.length - 1];

  const handleDownload = async (clearance) => {
    setDownloadingId(clearance.clearanceId);
    setDownloadError('');
    try {
      await downloadClearancePdf(stayId, clearance.clearanceId, memberId);
    } catch (err) {
      setDownloadError(err?.message || 'Failed to download clearance certificate.');
    } finally {
      setDownloadingId(null);
    }
  };

  const isNoDues = latestClearance.clearanceStatus === 'NO_DUES';
  const isOutstandingDues = latestClearance.clearanceStatus === 'OUTSTANDING_DUES';

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
          <FileCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          Hostel Clearance Certificate
        </CardTitle>
        <ClearanceStatusBadge status={latestClearance.clearanceStatus} />
      </CardHeader>

      <CardContent className="space-y-4">
        {downloadError && (
          <div className="p-2.5 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs">
            {downloadError}
          </div>
        )}

        <div
          className={`p-4 rounded-lg border text-xs space-y-2.5 ${
            isNoDues
              ? 'bg-teal-50/60 border-teal-200/80 dark:bg-teal-950/30 dark:border-teal-900/50 text-teal-950 dark:text-teal-200'
              : 'bg-rose-50/60 border-rose-200/80 dark:bg-rose-950/30 dark:border-rose-900/50 text-rose-950 dark:text-rose-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">
              Clearance #{latestClearance.sequence || 1}
            </span>
            <span className="text-[11px] opacity-80">
              Finalized on {latestClearance.finalizedAt?.slice(0, 10)}
            </span>
          </div>

          <p className="text-[11px] leading-relaxed">
            {isNoDues
              ? 'This resident has completed departure with verified NO DUES across all mess, room fees, and expense accounts. Security deposit is settled.'
              : isOutstandingDues
              ? 'This resident departed with recorded outstanding dues (OUTSTANDING_DUES). The clearance certificate reflects unresolved financial obligations at departure.'
              : 'This resident departed with pending settlement.'}
          </p>

          {latestClearance.exceptionReason && (
            <div className="p-2 rounded bg-white/70 dark:bg-slate-900/60 border border-current/20 text-[11px]">
              <strong>Exception Reason:</strong> {latestClearance.exceptionReason}
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownload(latestClearance)}
              disabled={downloadingId === latestClearance.clearanceId}
              className="text-xs gap-1.5 border-current/30 hover:bg-current/10"
            >
              <Download className="h-3.5 w-3.5" />
              {downloadingId === latestClearance.clearanceId ? 'Downloading...' : 'Download Clearance PDF'}
            </Button>
          </div>
        </div>

        {/* Previous revisions if reissued */}
        {clearances.length > 1 && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
              Previous Clearance Versions
            </span>
            <div className="space-y-1.5">
              {clearances.slice(0, -1).map((c) => (
                <div
                  key={c.clearanceId}
                  className="flex items-center justify-between p-2 rounded border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400"
                >
                  <span>Clearance #{c.sequence} ({c.clearanceStatus}) — {c.finalizedAt?.slice(0, 10)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(c)}
                    className="h-6 text-[11px] px-2 text-slate-500 hover:text-slate-900"
                  >
                    <Download className="h-3 w-3 mr-1" />
                    PDF
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
