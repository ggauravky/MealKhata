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
      {(preview.currentRoom || preview.proposedRoom) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div><span className="font-medium">Current room:</span> {preview.currentRoom?.roomId || 'Missing'}</div>
          <div><span className="font-medium">Proposed room:</span> {preview.proposedRoom?.roomNumber || preview.proposedRoom?.roomId}</div>
          <div><span className="font-medium">Current assignment:</span> {preview.currentAssignment?.effectiveFromDate || preview.currentAssignment?.effectiveFromMonth || 'Missing'} to {preview.currentAssignment?.effectiveUntilDate || preview.currentAssignment?.effectiveUntilMonth || 'present'}</div>
          <div><span className="font-medium">Proposed assignment:</span> {preview.proposedAssignment?.effectiveFromDate || preview.proposedAssignment?.effectiveFromMonth} to {preview.proposedAssignment?.effectiveUntilDate || preview.proposedAssignment?.effectiveUntilMonth || 'present'}</div>
          <div><span className="font-medium">Capacity:</span> {preview.capacityValidation?.valid ? 'Validated' : 'Conflict'}</div>
          <div><span className="font-medium">Financial history:</span> {preview.financialRecordsPreserved?.policy || 'Preserved'}</div>
        </div>
      )}
      {preview.beforeState && preview.afterState && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div><span className="font-medium">Stay status:</span> {preview.beforeState.historicalStay?.status} â†’ {preview.afterState.historicalStay?.status}</div>
          <div><span className="font-medium">Clearance validity:</span> {preview.beforeState.activeClearanceIds?.length ? 'ACTIVE' : 'None'} â†’ {preview.afterState.clearanceValidityStatus}</div>
          <div><span className="font-medium">Attribution:</span> {preview.afterState.attributionStatus}</div>
          <div><span className="font-medium">Months:</span> {preview.affectedMonths?.join(', ') || 'None'}</div>
        </div>
      )}
      {preview.sourceReceipt && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div><span className="font-medium">Original receipt:</span> {formatPaise(preview.sourceReceipt.amountPaise)}</div>
          <div><span className="font-medium">Category:</span> {preview.originalCategory} â†’ {preview.proposedCategory}</div>
          <div><span className="font-medium">Deposit held:</span> {formatPaise(preview.securityDepositBeforePaise)} â†’ {formatPaise(preview.securityDepositAfterPaise)}</div>
          <div><span className="font-medium">Unallocated credit:</span> {formatPaise(preview.unallocatedCreditBeforePaise)} â†’ {formatPaise(preview.unallocatedCreditAfterPaise)}</div>
          <div><span className="font-medium">Cash receipts:</span> {preview.cashReceiptCountBefore} â†’ {preview.cashReceiptCountAfter}</div>
          <div><span className="font-medium">Reference check:</span> {preview.duplicateReferenceCheck?.passed ? 'Passed' : 'Conflict'}</div>
        </div>
      )}
      {preview.credit && preview.target && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div><span className="font-medium">Available credit:</span> {formatPaise(preview.creditRemainingBeforePaise)}</div>
          <div><span className="font-medium">Allocation:</span> {formatPaise(preview.allocationAmountPaise)}</div>
          <div><span className="font-medium">Target outstanding:</span> {preview.target.outstandingBeforePaise === null ? 'External settlement' : `${formatPaise(preview.target.outstandingBeforePaise)} â†’ ${formatPaise(preview.target.outstandingAfterPaise)}`}</div>
          <div><span className="font-medium">Credit remaining:</span> {formatPaise(preview.creditRemainingBeforePaise)} â†’ {formatPaise(preview.creditRemainingAfterPaise)}</div>
        </div>
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
    || result.allocation?.creditAllocationId
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
  const [correctionMode, setCorrectionMode] = useState('ASSIGNMENT_ONLY');
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
    setCorrectionMode('ASSIGNMENT_ONLY');
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
    correctionMode,
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
          <div className="space-y-1.5">
            <Label htmlFor="repairMode">Correction type</Label>
            <select id="repairMode" value={correctionMode} onChange={(event) => { setCorrectionMode(event.target.value); setPreview(null); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
              <option value="ASSIGNMENT_ONLY">Repair missing or ended assignment</option>
              <option value="CORRECT_STAY_ROOM_REFERENCE">Correct an incorrect Stay room reference</option>
            </select>
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

export function CreditAllocationDialog({ open, onOpenChange, credit, onPreview, onApply, onCompleted }) {
  const [destinationType, setDestinationType] = useState('ROOM_FEE');
  const [targetRecordId, setTargetRecordId] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [reason, setReason] = useState('');
  const [settlementReference, setSettlementReference] = useState('');
  const [settledAt, setSettledAt] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDestinationType('ROOM_FEE'); setTargetRecordId(''); setAmountRupees(''); setReason('');
    setSettlementReference(''); setSettledAt(''); setPreview(null); setResult(null); setError('');
    setIdempotencyKey(globalThis.crypto?.randomUUID?.() || `${Date.now()}-credit-allocation`);
  }, [open, credit]);
  const amountPaise = Math.round(Number(amountRupees || 0) * 100);
  const payload = {
    expectedRevision: credit?.revision || 0,
    destinationType,
    targetRecordId,
    amountPaise,
    reason: reason.trim(),
    settlementReference: destinationType === 'EXTERNAL_SETTLEMENT' ? settlementReference.trim() : null,
    settledAt: destinationType === 'EXTERNAL_SETTLEMENT' ? settledAt : null,
    idempotencyKey,
  };
  const execute = async (apply) => {
    setBusy(true); setError('');
    try {
      if (apply) {
        setResult(await onApply(credit.creditId, { ...payload, previewToken: preview.previewToken }));
        onCompleted?.();
      } else setPreview(await onPreview(credit.creditId, payload));
    } catch (requestError) { setPreview(null); setError(requestError?.message || 'Unable to allocate the credit.'); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Allocate or Settle Unallocated Credit</DialogTitle><DialogDescription>This applies existing money to a verified obligation without recording cash again.</DialogDescription></DialogHeader>
        <div className="space-y-4 text-xs">
          <p>Available: <strong>{formatPaise(credit?.remainingAmountPaise || 0)}</strong> Â· Credit {credit?.creditId}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="creditDestination">Destination</Label><select id="creditDestination" value={destinationType} onChange={(event) => { setDestinationType(event.target.value); setPreview(null); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="ROOM_FEE">Room Fee obligation</option><option value="MESS">Mess obligation</option><option value="EXPENSE_REIMBURSEMENT">Shared Expense reimbursement</option><option value="EXTERNAL_SETTLEMENT">Documented refund / external settlement</option></select></div>
            <div className="space-y-1.5"><Label htmlFor="creditTarget">Target {destinationType === 'MESS' ? 'month (YYYY-MM)' : 'record ID'}</Label><Input id="creditTarget" value={targetRecordId} onChange={(event) => { setTargetRecordId(event.target.value); setPreview(null); }} required /></div>
            <div className="space-y-1.5"><Label htmlFor="creditAmount">Amount (â‚¹)</Label><Input id="creditAmount" type="number" min="0.01" step="0.01" value={amountRupees} onChange={(event) => { setAmountRupees(event.target.value); setPreview(null); }} required /></div>
            <div className="space-y-1.5"><Label htmlFor="creditReason">Mandatory audit reason</Label><Input id="creditReason" value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} maxLength={500} required /></div>
          </div>
          {destinationType === 'EXTERNAL_SETTLEMENT' && <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="settlementReference">Settlement evidence reference</Label><Input id="settlementReference" value={settlementReference} onChange={(event) => { setSettlementReference(event.target.value); setPreview(null); }} required /></div><div className="space-y-1.5"><Label htmlFor="settledAt">Settled at</Label><Input id="settledAt" type="datetime-local" value={settledAt} onChange={(event) => { setSettledAt(event.target.value); setPreview(null); }} required /></div></div>}
          {error && <p role="alert" className="text-rose-600">{error}</p>}
          {result ? <AuditResult result={result} /> : <PreviewPanel preview={preview} />}
          <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{result ? 'Close' : 'Cancel'}</Button>{!result && (!preview ? <Button onClick={() => execute(false)} disabled={busy || !targetRecordId || amountPaise <= 0 || reason.trim().length < 3}>Preview</Button> : <Button onClick={() => execute(true)} disabled={busy || !preview.canApply}>Confirm allocation</Button>)}</DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
