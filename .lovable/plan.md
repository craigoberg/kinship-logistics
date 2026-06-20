## Goal

Tighten the Governance Hub editor so it behaves as a high-trust admin surface: dropdowns instead of free text, PIN-gated creation of brand-new taxonomy values, longer justification/description, and a hard-coded Action Module contract.

## Scope (single file change + one API tweak)

### 1) `src/components/admin/governance-hub-workspace.tsx` — `EditAssetModal`

**Category & Type → type-ahead Combobox**
- Add a `useQuery(["governance-hub","taxonomy"])` that calls `listComplianceAssets({})` once and derives:
  - `categories: string[]` — unique sorted `category` values (active + archived, so we don't double-suggest)
  - `typesByCategory: Record<string, string[]>` — unique `type` per category
- Render two combobox controls (Radix `Popover` + `Command` from `@/components/ui/command`, matches the pattern already used elsewhere):
  - **Category**: suggestions from `categories`. Free text allowed but flagged.
  - **Type**: suggestions from `typesByCategory[category] ?? []`. Free text allowed but flagged.
- Compute booleans:
  - `isNewCategory = category.trim() && !categories.includes(category.trim().toUpperCase())`
  - `isNewType = type.trim() && !(typesByCategory[category.trim().toUpperCase()] ?? []).includes(type.trim())`
- When either is true, show an inline amber alert: "You are creating a new {Category|Type}. Manager PIN required."

**Manager PIN gate for new taxonomy values**
- When `isNewCategory || isNewType`, reveal two extra fields inside the modal:
  - `Manager` — `<LookupSelect>`-style staff picker (or simple `Select` over staff registry — re-use the same pattern as `ResolveComplianceAssetModal`).
  - `Manager PIN` — masked input.
- On submit, if a PIN is required:
  - Verify via `verifyStaffPin(managerStaffId, managerPin)` (already imported in `data-store`).
  - Reject with toast on failure.
  - On success, append `taxonomy_pin_verified_by: managerStaffId` to the upsert payload's `config` so the ledger captures who authorised the new vocabulary entry.

**Description min length (20)**
- Add `required` + character counter under the Description textarea: `{description.trim().length}/20 minimum`.
- Block submit until ≥20 chars.

**Justification min length (20) + counter**
- Raise the existing 10-char gate to 20.
- Add live counter under the textarea.
- Update the placeholder copy.

**Action Module — already a `Select` over `ACTION_MODULES`; confirm it stays locked**
- No change needed (it is already a hard-coded `Select`). Add an inline helper text under it: "Locked to modules with a registered Dispatcher modal."

**Updated `canSubmit`**
```ts
const canSubmit =
  category.trim().length > 0 &&
  type.trim().length > 0 &&
  name.trim().length > 0 &&
  description.trim().length >= 20 &&
  justification.trim().length >= 20 &&
  (!(isNewCategory || isNewType) || (managerStaffId && managerPin.length >= 4)) &&
  !mut.isPending;
```

### 2) `src/components/admin/governance-hub-workspace.tsx` — `ArchiveAssetDialog`
- Bump the justification gate from 10 → 20 chars and add a counter for parity.

### 3) `src/lib/api/compliance-assets.ts` — `upsertComplianceAsset`
- Raise the server-side justification floor from 10 → 20 chars (defence in depth; mirrors the new UI rule).
- No schema change; the PIN verification stays client-side because the modal already verifies via `verifyStaffPin` before the mutation fires. Existing manager-role check (`canManageSystemParameters`) is unchanged.

## Out of scope
- No migration / schema change.
- No edits to the Dispatcher (`dispatch-resolve-modal.tsx`) — Action Module is already enum-locked and the Dispatcher already routes on it.
- No changes to dashboard / exception feed.

## Verification
- Open `/admin → Governance Hub → New asset`:
  - Category & Type render as comboboxes with existing values; typing a new value surfaces the amber "new taxonomy — PIN required" panel.
  - Description and Justification show `n/20` counters and block submit until satisfied.
  - With Manager PIN 1111 (existing test creds), saving a new VEHICLE/rego succeeds; saving with a wrong PIN toasts an error.
- Edit an existing row — no PIN panel appears (values match registry); save still requires ≥20-char justification.
- Archive flow requires ≥20-char justification.
