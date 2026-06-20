# Plan — Relax Date Picker, Keep Future-Expiry Invariant

## Scope

Two files only — no schema, ledger, or API changes:

- `src/components/dashboard/resolve-certification-modal.tsx`
- `src/components/dashboard/resolve-vehicle-maintenance-modal.tsx`

## Current behaviour

The "New Expiry" date picker on both modals hard-disables every day `<= today` via `disabledFn={(d) => d.getTime() <= today.getTime()}`. The user cannot click past or today's date at all — the picker silently swallows the interaction. This blocks legitimate back-dated data entry (e.g. manager finishing the receipt the day after the renewal certificate was issued, or batching a week of evidence on Monday morning).

## Target behaviour

Two-layer validation, with the strict check at submit-time rather than in the picker:

1. **Picker (input layer) — permissive.** Remove the past/today disable on the New Expiry field. All calendar days remain selectable so the manager can pick the actual document date as printed on the evidence.
2. **Form (submit layer) — strict, unchanged in intent.** `canSubmit` continues to require `newExpiry > today` when `resType === "renewed"`. If the manager selects a past/today date we show an inline error under the field ("Expiry must be after today — renewals with an already-expired date cannot resolve the flag") and keep the Submit button disabled. This is the existing `canSubmit` clause; we just make it visible to the user instead of hiding it behind a disabled calendar.

### What stays unchanged

- **Deferred-Until picker** keeps `today < d <= today + MAX_DEFER_DAYS`. A defer by definition projects into the future and is bounded by policy; back-dating it is meaningless.
- **Vehicle "Serviced" branch** still stamps `last_service_date = today` server-side (line 151). Service date is the act of recording, not a user-entered field, so no picker change applies.
- Justification, evidence rules, GPS attempt, manager role gate, and the `operational_ledger` write path are untouched.

## Operational-ledger integrity

`ARCHITECTURE.md` treats the ledger as an append-only receipt of *what the manager asserted and when*. This change strengthens, not weakens, that contract:

- The ledger row's `created_at` / `recorded_by` continue to capture **when the receipt was written** (server clock, immutable).
- The mirrored business state (`staff_certifications.expiry_date`, `transport_assets.registration_expiry`) is still gated by the future-expiry invariant, so we never persist an asset/cert into an already-expired state via a resolution flow.
- Allowing the picker to surface past dates does **not** introduce a new code path — submission of a past expiry is rejected by the same `canSubmit` logic that exists today. The system's set of valid persisted states is unchanged.
- Net effect: the ledger more accurately reflects the historical evidence the manager is holding (the certificate's printed issue date), while the live compliance state remains future-valid.

## Technical changes

`resolve-certification-modal.tsx`
- Line 209-210: drop `disabledFn` from the New Expiry `DateField`; change `helper` to `"Must result in a future expiry date."`.
- Add inline error rendering when `resType === "renewed" && newExpiry && newExpiry <= today` (reuses existing `canSubmit` clause; no new state).

`resolve-vehicle-maintenance-modal.tsx`
- Line 249-250: same treatment for the registration-expiry `DateField` (Renewed branch).
- Same inline error for `resType === "renewed" && newExpiry <= today`.

Defer pickers (lines 219-221 / 279-281) and all submit-time checks remain byte-identical.

## Out of scope

- Adding a separate "resolution date" / "evidence date" field.
- Changing `MAX_DEFER_DAYS` or defer semantics.
- Any ledger schema or `resolveCertification` / `resolveVehicleMaintenance` API change.
