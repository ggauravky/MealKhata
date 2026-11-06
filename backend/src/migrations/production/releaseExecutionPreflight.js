import { checksumValue } from '../sourceInventory.service.js';
import { verifyProductionActionApproval } from '../v3ProductionGate.service.js';

const READ_ONLY = ['find', 'listCollections', 'listIndexes'];

/** Standalone inventory authority. It grants no archive, restore, migration or switch action. */
export function verifyReadOnlyInventoryAuthorization({ approval, planDigest, trustedSigners,
  principal, expectedPrincipal, observedPrivileges, now = new Date() }) {
  verifyProductionActionApproval({ approval, planDigest,
    action: 'read-source-inventory', trustedSigners, now });
  if (new Date(approval.expiresAt).getTime() - now.getTime() > 5 * 60_000) {
    throw new Error('Read-only inventory approval exceeds five minutes');
  }
  if (typeof principal !== 'string' || !principal || principal !== expectedPrincipal
    || !Array.isArray(observedPrivileges)
    || new Set(observedPrivileges).size !== READ_ONLY.length
    || checksumValue([...observedPrivileges].sort()) !== checksumValue(READ_ONLY)) {
    throw new Error('Read-only inventory principal or privilege scope is invalid');
  }
  return Object.freeze({ action: 'read-source-inventory',
    planDigest, principalSha256: checksumValue(principal),
    privilegeScopeSha256: checksumValue(READ_ONLY) });
}
