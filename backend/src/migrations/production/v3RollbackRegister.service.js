import { checksumValue } from '../sourceInventory.service.js';
import { normalizeExternalPaymentReference } from '../../finance/paymentReference.service.js';

const EXTERNAL_LEDGERS = new Set(['payments', 'room_payments',
  'expense_reimbursements', 'hostel_deposit_transactions', 'unallocated_credits']);
const idOf = row => row?._id?.toHexString?.() ?? String(row?._id ?? '');
const referenceOf = row => row?.upiReference ?? row?.reference ?? null;
const occurredAt = row => {
  const value = row?.recordedAt ?? row?.completedAt ?? row?.createdAt ?? row?.updatedAt;
  return value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;
};

/** Protected, offline target diff captured between the write-open and write-stop checkpoints. */
export function buildV3RollbackWriteRegister({ before, after, writesStopped }) {
  if (writesStopped !== true || !before?.databaseName || before.databaseName !== after?.databaseName
    || !Array.isArray(before.collectionOrder) || !Array.isArray(after.collectionOrder)
    || !before.documents || !after.documents) {
    throw new Error('Rollback write register requires the same target and verified stopped writes');
  }
  const entries = [];
  const referenceOwners = new Map();
  const names = [...new Set([...before.collectionOrder, ...after.collectionOrder])].sort();
  for (const collection of names) {
    const prior = new Map((before.documents[collection] ?? []).map(row => [idOf(row), row]));
    const current = new Map((after.documents[collection] ?? []).map(row => [idOf(row), row]));
    if ([...prior, ...current].some(([id]) => !id)
      || prior.size !== (before.documents[collection] ?? []).length
      || current.size !== (after.documents[collection] ?? []).length) {
      throw new Error('Rollback write register has missing or duplicate document identities');
    }
    for (const id of [...new Set([...prior.keys(), ...current.keys()])].sort()) {
      const old = prior.get(id);
      const next = current.get(id);
      if (old && next && checksumValue(old) === checksumValue(next)) continue;
      const row = next ?? old;
      const externalReference = EXTERNAL_LEDGERS.has(collection) ? referenceOf(row) : null;
      const item = { collection, documentId: id,
        change: !old ? 'ADDED' : !next ? 'REMOVED' : 'UPDATED',
        beforeSha256: old ? checksumValue(old) : null,
        afterSha256: next ? checksumValue(next) : null,
        memberId: typeof row.memberId === 'string' ? row.memberId
          : typeof row.fromMemberId === 'string' ? row.fromMemberId : null,
        occurredAt: occurredAt(row),
        amountPaise: Number.isSafeInteger(row.amountPaise) ? row.amountPaise : null,
        externalReference: typeof externalReference === 'string' ? externalReference : null,
        status: typeof row.status === 'string' ? row.status : null,
        actor: typeof row.actorId === 'string' ? row.actorId : null };
      entries.push(item);
      if (item.change === 'ADDED' && item.externalReference) {
        const normalized = normalizeExternalPaymentReference(item.externalReference);
        if (normalized) referenceOwners.set(normalized, (referenceOwners.get(normalized) ?? 0) + 1);
      }
    }
  }
  const duplicateExternalReferences = [...referenceOwners]
    .filter(([, count]) => count > 1).map(([reference]) => reference).sort();
  const body = { format: 'mealkhata-v3-rollback-write-register-v1',
    targetDatabase: before.databaseName, entries, duplicateExternalReferences };
  return { ...body, registerSha256: checksumValue(body) };
}
