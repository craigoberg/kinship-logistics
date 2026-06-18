## Root cause

`GiveDoseModal` (the Medication Administration Verification dialog) already wires its submit handler to `useGiveDose` → writes to `compliance_audit_logs` (the table we agreed to reuse in place of `medication_administration_log`) and already invalidates the right query keys. The reason "Confirm & Sign Off" appears to do nothing is that the button is `disabled={!canSubmit}` — when either staff dropdown is empty (or the same person is picked twice, or refusal notes are too short) the click is silently swallowed with no visual feedback. Users see "nothing happens".

The fix is to stop silently disabling, surface explicit per-field errors on click, and harden the success/error toasts and invalidations.

## Scope

Single file: `src/components/medication/give-dose-modal.tsx`. No DB/schema changes, no other components touched.

## Changes

1. **Stop silent disable** — Replace `disabled={!canSubmit}` on the Confirm button with `disabled={giveDose.isPending}` only. Validation now runs inside `submit()` and reports errors visually.

2. **Click-time validation with field-level errors**
   - Add `errors` state: `{ administeredBy?: string; witnessedBy?: string; notes?: string; form?: string }`.
   - On submit, validate before calling the mutation:
     - `administeredById` empty → set `errors.administeredBy`.
     - `witnessedById` empty → set `errors.witnessedBy`.
     - Both filled but equal → set both to "Administering staff and witness must be different people."
     - Status = Refused but notes < 10 chars → set `errors.notes`.
   - If any error, set a top-of-form banner: **"Dual sign-off is mandatory. Please select a staff witness to verify medication delivery."** and `return` without calling the mutation.
   - Clear an individual field's error as soon as the user changes that field (`onValueChange` / `onChange` handlers).

3. **Visual error styling**
   - On `<SelectTrigger>` for each dropdown: when its error is set, add `border-destructive ring-1 ring-destructive/40` (red outline).
   - Below each dropdown with an error, render a small `text-xs text-muted-foreground` line with the message (low-contrast warning text as requested).
   - Top-of-form red banner div (`border-destructive/40 bg-destructive/10 text-destructive`) for the dual-sign-off warning when any error is present.

4. **Submission pipeline (verify, no behavior change)**
   - Continues to call `useGiveDose.mutateAsync({ scheduleId, participantId, medicationName, dosage, scheduledTime, administeredById, administeredByName, witnessedById, witnessedByName, status, notes })`. The hook persists to `compliance_audit_logs` with `action_performed: "MEDICATION_ADMIN_DUAL"` and metadata carrying `schedule_id`, `participant_id`, `administered_by_id`, `witnessed_by_id`, `status`, and `notes`.

5. **Success toast + closure**
   - On success: `toast.success("Medication administration logged successfully.", { description: "${medicationName} — ${status} for ${participantName}.", className: "!bg-green-600 !text-white !border-green-700" })`, then `onOpenChange(false)`.

6. **Cache invalidation on success** (extend existing hook invalidations to cover the dashboard widget key explicitly)
   - In `src/hooks/use-supabase-data.ts` `useGiveDose.onSuccess`, in addition to the existing `["compliance_audit_logs"]` and `["participants"]`, add:
     - `["compliance_audit_logs", "today"]` (dashboard's "Today's Care & Medication Schedule" — driven by `useTodaysComplianceLogs`)
     - `["medication_schedules"]` (Care Profile "Expected routines" row state)
   - This is the one tiny exception to the single-file scope; required so the red OVERDUE chip flips to green Administered without a refresh.

7. **Bare-metal error toast on DB failure** — keep modal open
   - Existing `catch` block stays but is upgraded to: `toast.error((err as Error).message || "Database rejected the sign-off.", { description: "Postgres rejected the insert. The form has been kept open so you can adjust and retry.", className: "!bg-red-600 !text-white !border-red-700", duration: 12_000 })`.
   - Do NOT close the modal on error.

## Out of scope

- No new `medication_administration_log` table (we agreed to reuse `compliance_audit_logs`).
- No changes to `MedicationAdminModal` (the older PIN-witness dialog) or `TodaysMedicationCard`.
- No staff-identity / current-user changes.

## Files touched

- `src/components/medication/give-dose-modal.tsx` (validation surface, error styling, toast polish)
- `src/hooks/use-supabase-data.ts` (extend `useGiveDose.onSuccess` invalidation list)
