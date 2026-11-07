import { Building2, CheckCircle, Copy, ExternalLink, Info, UserCheck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';

export function RoomPaymentInstructionsCard({ settings, remainingPaise = 0, monthLabel = '' }) {
  const [copied, setCopied] = useState(false);

  if (!settings) {
    return (
      <Card className="border-slate-200/90 dark:border-slate-800">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-800 dark:text-slate-200">
            <Wallet className="h-4 w-4 text-teal-600" />
            <span>Payment Instructions</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Payment instructions have not been configured by the hostel administrator.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isOwner = settings.recipientMode === 'hostel_owner';
  const isAdminCollector = settings.recipientMode === 'admin_collector';
  const hasUpi = Boolean(settings.upiId);
  const upiId = settings.upiId || '';
  const recipientName = settings.recipientName || (isOwner ? 'Hostel Owner' : 'Admin Collector');

  const copyUpi = () => {
    if (!upiId) return;
    navigator.clipboard?.writeText(upiId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rupeesRemaining = Math.max(0, Math.floor(remainingPaise / 100));
  const upiLink = hasUpi
    ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(recipientName)}&am=${rupeesRemaining > 0 ? rupeesRemaining : ''}&cu=INR&tn=${encodeURIComponent(`Room Fee ${monthLabel}`)}`
    : null;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
        <div className="flex items-center gap-2">
          {isOwner ? (
            <Building2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          ) : (
            <UserCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          )}
          <CardTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isOwner ? 'Pay Hostel Owner Directly' : 'Pay Hostel Fee Collector'}
          </CardTitle>
        </div>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-semibold">
          {isOwner ? 'Hostel Owner' : 'Admin Collector'}
        </Badge>
      </CardHeader>

      <CardContent className="p-4 pt-1 space-y-3">
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Recipient:</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {recipientName}
            </span>
          </div>

          {hasUpi ? (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-slate-500 dark:text-slate-400">UPI ID:</span>
              <span className="font-mono font-medium text-slate-900 dark:text-slate-100 select-all">
                {upiId}
              </span>
              <Button
                variant="ghost"
                size="compact"
                onClick={copyUpi}
                className="h-6 px-1.5 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                title="Copy UPI ID"
              >
                {copied ? (
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span className="ml-1 text-[11px]">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">
              No UPI ID configured. Pay via bank transfer or cash as instructed.
            </p>
          )}

          {settings.paymentInstructions && (
            <div className="pt-2">
              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-0.5">
                Instructions:
              </span>
              <p className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950 p-2.5 rounded border border-slate-200 dark:border-slate-800 whitespace-pre-line">
                {settings.paymentInstructions}
              </p>
            </div>
          )}
        </div>

        {hasUpi && upiLink && rupeesRemaining > 0 && (
          <div className="pt-1">
            <a
              href={upiLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 w-full rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 shadow-xs transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Open UPI App to Pay ₹{rupeesRemaining.toLocaleString('en-IN')}</span>
            </a>
          </div>
        )}

        <div className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
          <span>
            Opening UPI initiates payment; your room payment is marked verified only after the administrator records confirmed receipt.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
