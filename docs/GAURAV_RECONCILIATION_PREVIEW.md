# Gaurav production reconciliation preview

Status: **read-only proposal — not executed**  
Last refreshed: 2026-10-26 19:43 IST (`2026-10-26T14:13:39.478Z`)  
Database inspected: `mealkhata` on Atlas

No Atlas document was inserted, updated, deleted, or migrated while preparing this report. Credentials, account secrets, and unrelated resident data are intentionally omitted.

## Verified current state

- Active Stay `96e51535-d6f6-42a4-be93-f37410157f8f`: member `gaurav`, status `ACTIVE`, joined `2026-10-01`, Room lower `0ad83e5f-16bd-40aa-ae24-b4de3765aeb6`, revision `0`, financial revision `2`. It references admission assignment `15f37501-7d6d-4788-b3ce-3a2629d659b3` and has no current assignment reference.
- Historical Stay `e4990c21-9b2d-4c1b-85e9-d0a6d89162a0`: status `CHECKED_OUT`, joined `2026-10-20`, left `2026-10-21`, revision `1`.
- Room lower capacity is `1`.
- Assignment `15f37501-7d6d-4788-b3ce-3a2629d659b3` covers `2026-10-01` through `2026-10-19`.
- Assignment `7ff8d6a8-d642-4fd9-b6f9-a3c38a6e6c91` covers `2026-10-20` through `2026-10-21`.
- Current nonsuperseded fee plan `edddd98a-88d2-453d-a920-b305fd127d53` is INR 4,800/month.
- October charge `a6c6a195-a27a-4eed-ad08-7ef36ddcebce` is INR 4,800 and is fully covered by verified room payment `9d7078ea-9cc6-4724-aa82-c7aa813cfaf9`. The issued charge intentionally retains its historical fee-plan reference.
- Deposit account `a6174521-680d-452e-9489-6233d54eefa1`: expected deposit `0`, status `OPEN`, revision `1`.
- Source receipt `2bb5ca7b-1db7-4edd-ac85-13bd2af22e31`: `RECEIVED`, `recorded`, INR 48,000 (`4,800,000` paise), method `upi`, recorded `2026-10-20T17:51:08.171Z`, recorded by Super Admin. No external bank/UPI reference is stored.
- No INR 48,000 match exists in room payments, mess payments, or expense reimbursements. October rent is already paid separately. The legitimate final business destination is therefore still unknown.
- Clearance `4f0ac50a-e4bc-4985-9ac1-dc90bedbdd53` is an `OUTSTANDING_DUES` snapshot for the historical Stay. Its snapshot contents must remain immutable.
- Nikhil and Devansh each retain their valid active Stay and open Room Assignment. They are outside every proposed write set below.

## Preview 1 — active Room Assignment repair

| Collection | Document | Current state | Proposed state | Audit and revision effect |
|---|---|---|---|---|
| `room_assignments` | `7ff8d6a8-d642-4fd9-b6f9-a3c38a6e6c91` | From `2026-10-20` through `2026-10-21` | Preserve the original start; set end date/month to `null` | Room occupancy revision increments inside the same transaction. |
| `hostel_stays` | `96e51535-d6f6-42a4-be93-f37410157f8f` | Active; no current assignment reference; revision `0` | Keep the same Stay, member, join date, and room; set `currentAssignmentId` to `7ff8d6a8-d642-4fd9-b6f9-a3c38a6e6c91` | Revision `0 -> 1`; append `ROOM_ASSIGNMENT_REPAIRED` with before/after assignment data and Super Admin reason. |

Business justification: the two historical intervals are contiguous. Extending the later assignment preserves both genuine starts and avoids rewriting the first assignment or creating another Stay. The live preview must still recheck capacity, all member/room intervals, and expected revisions before Apply.

The October charge, payment, fee plans, historical assignment `15f37501-7d6d-4788-b3ce-3a2629d659b3`, historical Stay, Nikhil, and Devansh are not changed by this operation.

## Preview 2 — INR 48,000 payment reclassification

This correction is deliberately separate from the room repair. Because no verified room, mess, or expense obligation matches the receipt, the only safe current destination is an auditable unallocated credit pending final classification.

Before Apply, Super Admin must open an audited clearance review on historical Stay `e4990c21-9b2d-4c1b-85e9-d0a6d89162a0`. That action increments the Stay revision and financial revision; the correction preview must then be regenerated.

| Collection | Document | Current state | Proposed state | Audit and revision effect |
|---|---|---|---|---|
| `hostel_deposit_transactions` | `2bb5ca7b-1db7-4edd-ac85-13bd2af22e31` | Active recorded deposit receipt for `4,800,000` paise | Status `reclassified`; retain original amount/date/method/actor; add shared reclassification ID, timestamp, role, and reason | Original receipt remains traceable and no refund is fabricated. |
| `payment_reclassifications` | New UUID | Absent | Immutable correction journal for exactly `4,800,000` paise | Unique source receipt and idempotency key; exact allocations; shared reclassification ID. |
| `unallocated_credits` | New UUID | Absent | One open credit for `4,800,000` paise, member `gaurav`, source receipt linked | This represents the existing cash once; it is not a second physical receipt. |
| `hostel_deposit_accounts` | `a6174521-680d-452e-9489-6233d54eefa1` | Expected `0`, status `OPEN`, revision `1`, active held effect INR 48,000 | Expected `0`, status `NOT_REQUIRED`, revision `2`, held deposit effect `0` | Append `PAYMENT_RECLASSIFIED_FROM_DEPOSIT` with the shared ID and before/after status. |
| `hostel_clearances` | `4f0ac50a-e4bc-4985-9ac1-dc90bedbdd53` | Original outstanding-dues snapshot, currently valid | Preserve every snapshot field; set validity to `REVOKED` and link the correction ID/reason | No certificate contents are silently edited. |

The financial mutation guard also increments the historical Stay's then-current `financialRevision` inside the reclassification transaction so concurrent financial previews become stale.

Money conservation after the operation:

- Original cash received: INR 48,000.
- Active deposit effect: INR 48,000 to INR 0.
- Unallocated real-money credit: INR 0 to INR 48,000.
- Additional physical receipt created: INR 0.
- October rent allocation added: INR 0.

Apply must fail on a stale account revision, inactive source, prior reclassification, any ambiguous refund/deduction, duplicate external reference, nonconserving allocation, missing clearance review, or concurrent winner.

## Preview 3 — erroneous historical Stay reconciliation

Run only after the payment correction leaves no held deposit and no unresolved payable obligation. Generate a fresh preview because opening the clearance review changes the historical Stay revision.

| Collection | Document | Current state | Proposed state | Audit and revision effect |
|---|---|---|---|---|
| `hostel_stays` | `e4990c21-9b2d-4c1b-85e9-d0a6d89162a0` | `CHECKED_OUT`, dates `2026-10-20` to `2026-10-21` | `SUPERSEDED`; link active Stay `96e51535-d6f6-42a4-be93-f37410157f8f`; retain historical dates and history | Increment the then-current revision; add reconciliation ID, timestamp, role, reason, and `HISTORICAL_STAY_RECONCILED`. |
| `hostel_clearances` | `4f0ac50a-e4bc-4985-9ac1-dc90bedbdd53` | Snapshot retained; expected already revoked by payment correction | Remain revoked and unchanged if already invalidated | Reconciliation never overwrites the original financial snapshot. |

The active Stay is not activated again, duplicated, or date-shifted. Financial attribution warnings caused by the overlapping October records require explicit Super Admin confirmation, while real outstanding obligations remain blocking conflicts.

## Preview 4 — optional deposit settlement

No separate cash or refund transaction is proposed. The account transition to `NOT_REQUIRED` is part of the atomic reclassification only when expected deposit is zero and no other active deposit transaction remains. If any balance remains at Apply time, the transition is blocked.

## Authorization boundary and execution order

Recommended approved order:

1. Apply the independent active Room Assignment repair after a fresh preview.
2. Open the historical clearance review with a mandatory reason.
3. Reclassify the INR 48,000 receipt to unallocated credit after a fresh financial preview and explicit Super Admin confirmation.
4. Reconcile the erroneous historical Stay after a fresh lifecycle/financial preview and explicit attribution confirmation.
5. Run Atlas integrity verification read-only and inspect all four audit trails.

This document does not authorize any of those production writes. No raw Atlas update script should be used; the audited application operations and their transaction/revision guards are the intended correction mechanism.
