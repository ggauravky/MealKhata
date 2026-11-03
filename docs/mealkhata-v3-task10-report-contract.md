# MealKhata 3.0 Task 10 report contract

Monthly report, payment summary, dashboard, and finance responses retain their existing `members`, `room`, `toDate`, `projection`, `rates`, `periodType`, and `status` fields. `members` is now keyed by every student ID relevant to the requested month. A student added later does not add an empty row to a past report. Member report rows and payment summaries may include `displayName`; the value is a public student label, never account information.

Saved legacy meal days are read through the verified `legacy-v2` snapshot and latest verified `legacy-correction-v1` authority. Billing and exports aggregate those daily integer-paise amounts. A missing or mismatched historical authority fails the entire monthly report with the affected date. New version 3 days use their saved participant order and dynamic allocation with the month's effective rates. Room and student paise must reconcile.

New monthly settlements use `snapshotVersion: 3`, with `snapshot.studentIds` and a Mongo-key-safe `snapshot.members` map. Member rows store participation, share units, bill, paid, remaining, and a display-name snapshot. The room row stores physical plates and totals; rates and price adjustments remain frozen in the snapshot. Versions 1 and 2 remain readable without migration or writeback. The existing partial unique index allows one active closed settlement per month; a unique month/sequence index also protects concurrent history creation.

Task 11 must introduce and enforce `financialStartDate` before operational financial issuance in a migration target. Task 10 does not classify old costs as new liabilities, reset ledgers, or select a cutover date. Existing pre-boundary payment and settlement behavior remains an explicit Task 11 migration concern.
