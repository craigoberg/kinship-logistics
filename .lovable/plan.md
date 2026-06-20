## Objective
Make the Evidence Reference field in `ResolveCertificationModal` conditionally required (Renewed only) while preserving a complete, immutable audit receipt in `operational_ledger`.

## Files Affected
- `src/components/dashboard/resolve-certification-modal.tsx`
- `src/lib/api/ledger.ts`

---

## Plan Details

### 1. Modal Validation (`resolve-certification-modal.tsx`)
- Change `evidenceTooShort` logic so it only blocks submit when `resType === "renewed"`. For `defer` and `revoke`, evidence length is ignored.
- When `resType` switches away from `"renewed"`, clear `evidenceRef` state so the field does not carry stale data into a non-renewal resolution.
- UI: keep the Evidence Reference input always visible but append `(Required)` label when `resType === "renewed"` and `(Optional)` when `defer` / `revoke`. Retain the existing inline helper showing remaining chars when the field is active.

### 2. Ledger API Type Update (`ledger.ts`)
- Update `ResolveCertificationInput.evidenceRef` from `string` to `string | null`.
- Update `resolveCertification()` to pass `evidenceRef ?? null` into the ledger metadata under `evidence_ref`.

### 3. Ledger Receipt Completeness (ARCHITECTURE.md Compliance)
- The `operational_ledger` receipt remains complete because:
  - `staff_id`, `category`, `severity`, `action_type`, `gps_lat`/`gps_lng`, and `metadata` are all still populated.
  - `metadata.evidence_ref` is written as `null` for defer/revoke, which is an explicit signal that no external document reference exists — itself an auditable fact.
  - `metadata.justification` remains mandatory (min 20 chars) across all resolution types, ensuring Manager intent is always captured.
  - The append-only immutability rule is untouched.

### 4. Submit Logic
- `canSubmit` condition: `!submitting && !notesTooShort && !(resType === "renewed" && evidenceTooShort) && !dateMissing && !dateInvalid`

---

## Verification
- Renewed resolution without evidence: Submit button disabled, inline helper visible.
- Defer resolution without evidence: Submit enabled once justification and date are valid.
- Ledger row after revoke/defer: `evidence_ref: null`, all other fields populated, `action_type: CERTIFICATION_RESOLVED`.