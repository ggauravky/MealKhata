# MealKhata 3.0 meal API additions

New `schemaVersion: 3` meal days persist `participantOrder` when first saved. Statuses, plate shares, costs, and calendar counts use those IDs. Unsaved days use students eligible on the requested date. `MEAL_MAX_PHYSICAL_PLATES` optionally sets an integer cap from 1 to 100; the default is the participant count, with a minimum of three and a maximum of 100.

`PUT /api/meals/:date/:mealType/allocation` also accepts an optional `expectedRevision` integer in its allocation body. When supplied, a stale revision returns 409 without changing the day. Older clients can omit it.

Saved legacy days use the verified immutable `legacy-v2` snapshot. Their response adds `calculationVersion: "legacy-v2"` and disables ordinary edit permissions. A missing or mismatched snapshot returns an error. Normal PATCH, allocation, and price routes cannot change these days.

Super Admin may correct an open saved legacy day with `POST /api/meals/:date/corrections` using the normal authenticated same-origin request. The body requires `expectedRevision`, `operation`, `mealType`, and a 3–200 character `reason`. Operations are `status` (`memberId`, `status`), `allocation` (`allocation`), `clearAllocation`, `price` (`pricePaise`), and `clearPrice`. The endpoint checks the current revision and month closure, applies checkout and Stay financial guards, and appends an audited `legacy-correction-v1` cost authority in `meal_history_corrections`. It never edits the original `meal_days` document or `legacy-v2` snapshot. Reads verify the correction chain and return the latest authority with `permissions.canCorrectHistorical` for Super Admin.
