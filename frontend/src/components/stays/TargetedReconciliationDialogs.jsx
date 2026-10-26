import { AlertTriangle, ShieldCheck, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatPaise } from '../../lib/money.js';
import { Button } from '../ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.jsx';
import { Input } from '../ui/input.jsx';
import { Label } from '../ui/label.jsx';

function PreviewPanel({ preview }) {
  if (!preview) return null;
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center gap-2 font-semibold">
        {preview.canApply
          ? <ShieldCheck className="h-4 w-4 text-teal-600" />
          : <AlertTriangle className="h-4 w-4 text-rose-600" />}
        {preview.canApply ? 'Preview ready for confirmation' : 'Conflicts must be resolved'}
      </div>
      {preview.conflicts?.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-rose-700 dark:text-rose-300">
          {preview.conflicts.map((conflict, index) => <li key={`${conflict.code}-${index}`}>{conflict.message}</li>)}
        </ul>
      )}
      {preview.affectedRecords?.length > 0 && (
        <div className="mt-2 text-slate-500">
          <p className="font-medium text-slate-700 dark:text-slate-300">Affected records</p>
          {preview.affectedRecords.map((record) => (
            <p key={`${record.collection}-${record.documentId}`}>{record.collection}: {record.documentId}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function AuditResult({ result }) {
  if (!result) return null;
  const auditId = result.reclassificationId
    || result.reconciliationId
    || result.assignment?.assignmentId
    || result.stay?.stayId;
  return (
    <section className="rounded-md border border-teal-200 bg-teal-50 p-3 text-xs text-teal-900 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200">
      <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" />Audit result recorded</div>
      <p className="mt-1 font-mono break-all">{auditId || 'Completed with an immutable audit record'}</p>
      {result.credits?.map((credit) => (
        <p key={credit.creditId} className="mt-1">Credit {credit.creditId}: {formatPaise(credit.amountPaise)}</p>
      ))}
    </section>
  );
}

export function RoomAssignmentRepairDialog({ open, onOpenChange, stay, onPreview, onApply, onCompleted }) {
  const [rooms, setRooms] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [roomId, setRoomId] = useState('');
  const [assignmentAction, setAssignmentAction] = useState('EXTEND_EXISTING_ASSIGNMENT');
  const [assignmentId, setAssignmentId] = useState('');
  const [occupancyFromDate, setOccupancyFromDate] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !stay) return;
    setRoomId(stay.currentRoomId || stay.initialRoomId || '');
    setReason('');
    setPreview(null);
    setResult(null);
    setError('');
    Promise.all([api.get('/api/rooms'), api.get(`/api/room-fees/assignments/${stay.memberId}`)])
      .then(([roomResponse, assignmentResponse]) => {
        const nextAssignments = Array.isArray(assignmentResponse.data) ? assignmentResponse.data : [];
        setRooms(Array.isArray(roomResponse.data) ? roomResponse.data : []);
        setAssignments(nextAssignments);
        const latest = [...nextAssignments]
          .filter((assignment) => !assignment.cancelledAt && assignment.roomId === (stay.currentRoomId || stay.initialRoomId))
          .sort((left, right) => String(right.effectiveFromDate || right.effectiveFromMonth).localeCompare(String(left.effectiveFromDate || left.effectiveFromMonth)))[0];
        setAssignmentId(latest?.assignmentId || '');
      })
      .catch((requestError) => setError(requestError?.message || 'Unable to load Room Assignment history.'));
  }, [open, stay]);

  const eligibleAssignments = useMemo(
    () => assignments.filter((assignment) => !assignment.cancelledAt && assignment.roomId === roomId),
    [assignments, roomId],
  );
  const payload = {
    roomId,
    assignmentAction,
    assignmentId: assignmentAction === 'CREATE_NEW_ASSIGNMENT' ? null : assignmentId,
    occupancyFromDate: assignmentAction === 'CREATE_NEW_ASSIGNMENT' ? occupancyFromDate : null,
    expectedRevision: stay?.revision,
    reason: reason.trim(),
  };

  const handlePreview = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setPreview(await onPreview(stay.stayId, payload));
    } catch (requestError) {
      setPreview(null);
      setError(requestError?.message || 'Unable to preview the repair.');
    } finally {
      setBusy(false);
    }
  };
  const handleApply = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await onApply(stay.stayId, { ...payload, previewToken: preview.previewToken }));
      onCompleted?.();
    } catch (requestError) {
      setPreview(null);
      setError(requestError?.message || 'Unable to apply the Room Assignment repair.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wrench className="h-4 w-4 text-amber-600" /> Repair Room Assignment</DialogTitle>
          <DialogDescription>Keep the active Stay and preserve every historical assignment, charge, and payment.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handlePreview} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="repairRoom">Room</Label>
              <select id="repairRoom" value={roomId} onChange={(event) => { setRoomId(event.target.value); setPreview(null); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm" required>
                <option value="">Select room</option>
                {rooms.map((room) => <option key={room.roomId} value={room.roomId}>Room {room.roomNumber}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repairAction">Repair action</Label>
              <select id="repairAction" value={assignmentAction} onChange={(event) => { setAssignmentAction(event.target.value); setPreview(null); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                <option value="EXTEND_EXISTING_ASSIGNMENT">Extend existing assignment</option>
                <option value="LINK_VALID_ASSIGNMENT">Link valid assignment</option>
                <option value="CREATE_NEW_ASSIGNMENT">Create new assignment</option>
              </select>
            </div>
          </div>
          {assignmentAction !== 'CREATE_NEW_ASSIGNMENT' ? (
            <div className="space-y-1.5">
              <Label htmlFor="repairAssignment">Exact historical assignment</Label>
              <select id="repairAssignment" value={assignmentId} onChange={(event) => { setAssignmentId(event.target.value); setPreview(null); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm" required>
                <option value="">Select assignment</option>
                {eligibleAssignments.map((assignment) => (
                  <option key={assignment.assignmentId} value={assignment.assignmentId}>
                    {assignment.assignmentId.slice(0, 8)}: {assignment.effectiveFromDate || assignment.effectiveFromMonth} to {assignment.effectiveUntilDate || assignment.effectiveUntilMonth || 'present'}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5"><Label htmlFor="repairFrom">Occupancy from</Label><Input id="repairFrom" type="date" value={occupancyFromDate} onChange={(event) => { setOccupancyFromDate(event.target.value); setPreview(null); }} required /></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="repairReason">Mandatory audit reason</Label><Input id="repairReason" value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} maxLength={500} required /></div>
          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          {result ? <AuditResult result={result} /> : <PreviewPanel preview={preview} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{result ? 'Close' : 'Cancel'}</Button>
            {!result && (!preview ? <Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Preview'}</Button> : <Button type="button" onClick={handleApply} disabled={busy || !preview.canApply}>{busy ? 'Applying…' : 'Confirm repair'}</Button>)}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HistoricalStayReconciliationDialog({ open, onOpenChange, stay, activeStays, onPreview, onApply, onCompleted }) {
  const replacement = activeStays.find((candidate) => candidate.memberId === stay?.memberId);
  const [reason, setReason] = useState('');
  const [confirmFinancialAttribution, setConfirmFinancialAttribution] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setConfirmFinancialAttribution(false); setPreview(null); setResult(null); setError(''); } }, [open]);
  const payload = { supersededByStayId: replacement?.stayId, expectedRevision: stay?.revision, reason: reason.trim(), confirmFinancialAttribution };
  const execute = async (apply) => {
    setBusy(true); setError('');
    try {
      if (apply) {
        setResult(await onApply(stay.stayId, { ...payload, previewToken: preview.previewToken }));
        onCompleted?.();
      } else setPreview(await onPreview(stay.stayId, payload));
    } catch (requestError) { setPreview(null); setError(requestError?.message || 'Unable to reconcile historical Stay.'); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Reconcile Incorrect Historical Stay</DialogTitle><DialogDescription>The checked-out document and its clearance snapshots remain preserved; only lifecycle validity changes.</DialogDescription></DialogHeader>
        <div className="space-y-4 text-xs">
          <p>Historical Stay: {stay?.stayId}<br />Active replacement: {replacement?.stayId || 'No matching active Stay'}</p>
          <div className="space-y-1.5"><Label htmlFor="historicalReason">Mandatory audit reason</Label><Input id="historicalReason" value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} maxLength={500} required /></div>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmFinancialAttribution} onChange={(event) => { setConfirmFinancialAttribution(event.target.checked); setPreview(null); }} /><span>I reviewed the overlapping monthly records and confirm they belong to the continuing active Stay.</span></label>
          {error && <p role="alert" className="text-rose-600">{error}</p>}
          {result ? <AuditResult result={result} /> : <PreviewPanel preview={preview} />}
          <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{result ? 'Close' : 'Cancel'}</Button>{!result && (!preview ? <Button onClick={() => execute(false)} disabled={busy || !replacement || reason.trim().length < 3}>Preview</Button> : <Button onClick={() => execute(true)} disabled={busy || !preview.canApply}>Confirm reconciliation</Button>)}</DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentReclassificationDialog({ open, onOpenChange, stay, deposit, onPreview, onApply, onOpenClearanceReview, onCompleted }) {
  const receipts = useMemo(
    () => (deposit?.transactions || []).filter(
      (transaction) => transaction.type === 'RECEIVED' && transaction.status === 'recorded',
    ),
    [deposit?.transactions],
  );
  const [sourceId, setSourceId] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSourceId(receipts[0]?.depositTransactionId || receipts[0]?.transactionId || '');
    setReason(''); setPreview(null); setResult(null); setError('');
    setIdempotencyKey(globalThis.crypto?.randomUUID?.() || `${Date.now()}-payment-reclassification`);
  }, [open, receipts]);
  const source = receipts.find((receipt) => (receipt.depositTransactionId || receipt.transactionId) === sourceId);
  const payload = {
    sourceDepositTransactionId: sourceId,
    expectedAccountRevision: deposit?.account?.revision,
    allocations: [{ category: 'UNALLOCATED_CREDIT', memberId: stay?.memberId, targetAccount: 'PENDING_CLASSIFICATION', amountPaise: source?.amountPaise }],
    reason: reason.trim(),
    idempotencyKey,
  };
  const execute = async (apply) => {
    setBusy(true); setError('');
    try {
      if (apply) {
        setResult(await onApply(stay.stayId, { ...payload, previewToken: preview.previewToken }));
        onCompleted?.();
      } else setPreview(await onPreview(stay.stayId, payload));
    } catch (requestError) { setPreview(null); setError(requestError?.message || 'Unable to correct the payment category.'); } finally { setBusy(false); }
  };
  const requiresReview = preview?.conflicts?.some((conflict) => conflict.code === 'CLEARANCE_REVIEW_REQUIRED');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Correct Payment Category</DialogTitle><DialogDescription>Move the ledger effect without creating a second cash receipt. Unknown purpose remains an auditable unallocated credit.</DialogDescription></DialogHeader>
        <div className="space-y-4 text-xs">
          <div className="space-y-1.5"><Label htmlFor="sourceReceipt">Original receipt</Label><select id="sourceReceipt" value={sourceId} onChange={(event) => { setSourceId(event.target.value); setPreview(null); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm" required><option value="">Select receipt</option>{receipts.map((receipt) => <option key={receipt.depositTransactionId || receipt.transactionId} value={receipt.depositTransactionId || receipt.transactionId}>{formatPaise(receipt.amountPaise)} · {String(receipt.recordedAt || '').slice(0, 10)} · {receipt.method}</option>)}</select></div>
          {source && <div className="grid grid-cols-2 gap-2 rounded-md border p-3"><span>Amount: {formatPaise(source.amountPaise)}</span><span>Method: {source.method}</span><span>Date: {String(source.recordedAt || '').slice(0, 10)}</span><span>Reference: {source.reference || 'Not recorded'}</span></div>}
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><strong>Correct category:</strong> Other recognized receipt / unallocated credit. Room, mess, and expense allocation remain blocked until a real outstanding target is verified.</div>
          <div className="space-y-1.5"><Label htmlFor="paymentCorrectionReason">Mandatory audit reason</Label><Input id="paymentCorrectionReason" value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} maxLength={500} required /></div>
          {error && <p role="alert" className="text-rose-600">{error}</p>}
          {result ? <AuditResult result={result} /> : <PreviewPanel preview={preview} />}
          {requiresReview && <Button variant="outline" onClick={async () => { await onOpenClearanceReview(stay.stayId, reason); setPreview(null); }}>Open required clearance review</Button>}
          <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{result ? 'Close' : 'Cancel'}</Button>{!result && (!preview ? <Button onClick={() => execute(false)} disabled={busy || !source || reason.trim().length < 3}>Preview</Button> : <Button onClick={() => execute(true)} disabled={busy || !preview.canApply}>Confirm category correction</Button>)}</DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
