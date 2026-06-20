## Goal

Capture **when the action actually happened** (Action Date — can be in the past) separately from **when the document expires next** (Expiry Date — must still be future-dated). Both flow into the operational ledger as distinct metadata fields.

## Scope

- `src/components/dashboard/resolve-certification-modal.tsx`
- `src/components/dashboard/resolve-vehicle-maintenance-modal.tsx`
- `src/lib/api/ledger.ts` (input types + metadata payload)

No schema changes — metadata is JSONB.

---

## 1. UI — Both modals

Add a new **"Actual Action Date"** date picker, shown alongside the existing "New Expiry Date" picker, only in the branches where an external transaction took place:

| Modal | Resolution Type | Action Date label | Expiry picker shown? |
|---|---|---|---|
| Certification | Renewed | "Renewal Date" | Yes (New Expiry Date) |
| Certification | Defer / Revoke | — (hidden) | No |
| Vehicle | Renewed Rego | "Payment / Renewal Date" | Yes (New Registration Expiry) |
| Vehicle | Serviced | "Service Date" | No (odometer instead) |
| Vehicle | Defer / Decommission | — (hidden) | No |

**Picker constraints (Action Date):**
- Permissive past dates allowed (e.g., the rego was paid last Tuesday).
- Future dates disabled (`disabledFn: d => d.getTime() > today`).
- Required when shown. Defaults to today.

**Expiry picker — unchanged from current behaviour:**
- Calendar permissive (back-dating selectable).
- Submit-layer invariant still requires `newExpiry > today` with the existing inline error message.

**Vehicle "Serviced" branch:** the existing hard-coded `newServiceDate = today` is replaced by the user-supplied Action Date. The helper text "Service date recorded as today" is removed.

## 2. Validation (`canSubmit`)

Add to both modals:
- `actionDateMissing = (branchRequiresActionDate && !actionDate)`
- `actionDateInvalid = actionDate && actionDate.getTime() > today.getTime()`
- Extend `canSubmit` with `&& !actionDateMissing && !actionDateInvalid`.

All existing invariants (justification ≥20, evidence ≥6 when required, expiry > today for renewals, defer ≤30 days, GPS attempt) remain untouched.

## 3. API — `src/lib/api/ledger.ts`

**`ResolveCertificationInput`**: add `actionDate?: string | null` (ISO yyyy-mm-dd). Required when `resolutionType === "renewed"`.

**`ResolveVehicleMaintenanceInput`**: add `actionDate?: string | null`. Required when `resolutionType === "renewed"` or `"serviced"`. For `serviced`, `actionDate` replaces the current `newServiceDate ?? today` default when mirroring to `transport_assets.last_service_date`.

**Ledger metadata** — add distinct fields, never collapsed:

```jsonc
// CERTIFICATION_RESOLVED
{
  "action_date": "2026-07-05",     // when the renewal actually occurred
  "new_expiry_date": "2027-07-05", // when the new cert expires (future)
  ...existing fields unchanged
}

// VEHICLE_MAINTENANCE_RESOLVED
{
  "action_date": "2026-07-05",     // payment / service date
  "new_expiry_date": "2027-07-05", // null for "serviced"
  ...existing fields unchanged
}
```

For backward compatibility, existing fields (`new_expiry`, `new_value`) are kept exactly as today — no readers break. The new keys (`action_date`, `new_expiry_date`) are additive.

## 4. Mirror behaviour

- Certification mirror to `staff_registry.certifications`: unchanged (uses `newExpiry`, which still represents the future expiry — not the action date).
- Vehicle "renewed" mirror to `transport_assets.registration_expiry`: unchanged.
- Vehicle "serviced" mirror to `transport_assets.last_service_date`: now uses the user-supplied `actionDate` instead of today. `last_service_odo` unchanged.

## 5. Audit-trail integrity

- Action Date = **historical fact** (when the transaction occurred). Stored in ledger metadata only; never used as a compliance deadline.
- Expiry Date = **forward-looking compliance state**. Continues to gate dashboard scans and remains under the future-only invariant.
- Ledger `created_at` (server clock) is unchanged — it records when the receipt was *appended*, distinct from both action and expiry dates.
- Result: three independent timestamps per receipt (`created_at`, `metadata.action_date`, `metadata.new_expiry_date`), giving the full chain of custody without breaking deadline monitoring.

## Out of scope

- No schema migrations, no changes to exception-feed scan logic, no changes to defer/revoke/decommission branches beyond hiding the new picker.
