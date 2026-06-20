# Plan: Resolve Action for Expired Staff Certifications

Per `ARCHITECTURE.md` + `PROJECT_CONTEXT.md`: RED states are Manager-only, every resolution is appended to `operational_ledger`, and double-flags for the same cert resolve as one logical unit.

## 1. UI — "Resolve" button on RED rows

In `src/components/dashboard/OperationsExceptionHub.tsx`, on the Staff Certifications tile rows where `severity === 'red'` (expired) — and `yellow` rows where the Manager wants to Defer — render a compact `Resolve` button on the right of the row.

- Visible only when the current user has the Manager role (reuse existing role check; staff sees the row but no button → no dead-end, no bypass).
- Clicking opens a new `<ResolveCertificationModal />` (new file: `src/components/dashboard/resolve-certification-modal.tsx`), pre-loaded with `{ staffId, staffName, certType, certName, expiryDate }`.

## 2. Modal — what it captures

The modal enforces the High-Trust / Competency-Verified contract. Fields:

- **Resolution type** (radio, required):
  - `renewed` — cert has been re-issued (new expiry date required, must be future-dated)
  - `deferred` — Manager grants a temporary deferral (`deferred_until` date required, max +30 days, written back to the staff JSONB `deferredUntil` per the 2026-06-29 migration)
  - `revoked` — staff no longer holds this cert / role changed (cert entry archived)
- **Evidence reference** (text, required, min 6 chars) — document ID, SharePoint link, or ticket #.
- **Manager justification notes** (textarea, required, min 20 chars) — same UX pattern as the Unground modal (prominent label, discreet character counter).
- **GPS attempt** — captured silently via existing `src/lib/geo.ts` helper; failure is logged but does not block (matches Ledger philosophy: mandatory attempt, not mandatory success).
- Submit button disabled until validation passes; confirms with a single toast.

## 3. Ledger write — append-only receipt

On submit, in a single transaction via a new `resolveCertification(...)` helper in `src/lib/api/ledger.ts`:

1. **Append** one row to `operational_ledger` (never update / never delete):
   ```
   entry_type:        'certification_resolution'
   severity_before:   'red' | 'yellow'
   severity_after:    'green' | 'yellow_deferred' | 'archived'
   subject_type:      'staff_certification'
   subject_id:        `${staffId}:${certType}:${certName}`   -- stable composite key
   actor_id:          auth.uid()
   actor_role:        'manager'                              -- verified server-side
   gps:               { lat, lng, accuracy } | { attempted: true, error }
   payload:           { resolutionType, evidenceRef, justification, newExpiry?, deferredUntil? }
   supersedes:        <id of latest open red/yellow ledger entry for same subject_id>
   created_at:        now()
   ```
2. **Mirror** the resolution back to `staff_registry` JSONB (update `expiryDate` for `renewed`, `deferredUntil` for `deferred`, soft-delete flag for `revoked`) so `useStaffCertificationExceptions` reflects it on next refresh.
3. **Double-flag rule**: the `supersedes` lookup grabs the *latest* open ledger entry for that composite `subject_id`, so multiple red flags on the same cert collapse into one resolution receipt — same pattern as the Unground supersede logic (`docs/sql/2026-06-28_escalations_supersede.sql`).
4. New migration `docs/sql/2026-06-30_certification_resolution.sql` adds the `subject_type='staff_certification'` index and a partial unique constraint guaranteeing only one open RED ledger entry per subject_id at a time.

## Files touched

- new: `src/components/dashboard/resolve-certification-modal.tsx`
- new: `src/lib/api/ledger.ts` → `resolveCertification()` helper
- new: `docs/sql/2026-06-30_certification_resolution.sql`
- edit: `src/components/dashboard/OperationsExceptionHub.tsx` (Resolve button + modal wiring, Manager-gated)
- edit: `src/hooks/use-exception-feed.ts` (expose `staffId` / `certType` / `certName` on each exception so the modal has a stable subject_id)

## Out of scope (will not touch)

- Staff form sheet (already supports `deferredUntil` from the previous task).
- Wall-View dashboard (read-only by contract).
- Any non-cert exception types in the hub.
