## Goal
Stop the dashboard's background polling from re-rendering Admin/Governance forms and modals, and make in-progress forms survivable across refresh/tab-close.

## 1. Smart polling (kill mid-typing re-renders)

Update every `useQuery` that currently sets `refetchInterval`:

- `src/components/dashboard/OperationsExceptionHub.tsx` — `pendingReviewsQ` (10s) and `groundedQ` (15s)
- `src/hooks/use-supabase-data.ts` line 936 (15s)
- `src/hooks/use-exception-feed.ts` — medication, clearance and compliance feeds

Apply the same three options to each:

```ts
refetchInterval: 30_000,           // back off from 10/15s
refetchIntervalInBackground: false, // pause when tab hidden
refetchOnWindowFocus: true,         // catch up on focus
```

Rationale: `refetchInterval` always re-renders the consuming component on success even when data is structurally identical, which is what's nuking sibling form state in any component that re-mounts under a parent that uses these hooks.

## 2. Isolation — stop dashboard hooks from leaking into Admin

`OperationsExceptionHub` is dashboard-only, but `useComplianceExceptions` (in `use-exception-feed.ts`) shares the `["compliance-assets"]` query key with `GovernanceHubWorkspace`. Today, dashboard polling invalidates/refetches that key and forces the Governance table — and any open `EditAssetModal` mounted as its child — to re-render.

Fix:

- Give the dashboard feed its own key: `["compliance-exceptions"]` (selecting/derived from the same fetch), OR scope the polling to the dashboard only by passing `refetchInterval` from the dashboard consumer rather than baking it into the shared hook.
- Confirm `EditAssetModal` form state isn't keyed off `asset` identity in a way that resets on refetch. If it is, switch the `useState` initializers to a `useRef` snapshot keyed by `asset.id`, so a refetched-but-identical asset object doesn't reset typed input.

## 3. `usePersistedForm` hook

New file `src/hooks/use-persisted-form.ts`:

```ts
export function usePersistedForm<T extends object>(
  key: string,
  initial: T,
): {
  values: T;
  setValues: (next: Partial<T>) => void;
  reset: () => void;
  isDirty: boolean;
  hasDraft: boolean;
  resumeDraft: () => void;
  discardDraft: () => void;
};
```

Behaviour:

- On mount, read `sessionStorage[`form:${key}`]`. If present and different from `initial`, expose `hasDraft = true` and DO NOT auto-apply — let the form render a "Resume previous draft?" banner that calls `resumeDraft()`.
- On every `setValues`, persist the merged object to sessionStorage (debounced ~300 ms).
- `reset()` and `discardDraft()` clear the storage key. The form's successful-save handler must call `reset()`.
- `isDirty` = current values differ from `initial`.
- `beforeunload` listener attached while `isDirty === true`, detached on unmount or reset (this is the "warn before refresh/close" requirement).

## 4. Wire `usePersistedForm` into the two target forms

**`src/components/admin/governance-hub-workspace.tsx` — `EditAssetModal`**

- Storage key: `governance-asset:${asset?.id ?? "new"}`.
- Replace the individual `useState` calls (category, type, name, description, justification, expiry, action_module, config knobs, etc.) with a single `usePersistedForm` object.
- On open, if `hasDraft`, show a yellow "Resume unsaved draft from {timestamp}? [Resume] [Discard]" bar above the form fields.
- On successful `upsertComplianceAsset` mutation, call `reset()`.
- PIN values (`managerStaffId`, `managerPin`) stay in normal `useState` — never persisted to sessionStorage.

**`src/components/dashboard/formal-audit-checklist.tsx` — Formal Audit Modal**

- Storage key: `formal-audit:${assetId}`.
- Persist checklist answers, justification text, signatures-in-progress (but again, never PINs).
- Same "Resume draft" banner pattern.
- Clear on submit success or on explicit "Discard".

## 5. Verification

- Open Governance Hub → start typing in a new asset → wait 30 s with dashboard tab focused → input must not reset.
- Same test with tab in background for 2 min → no polling should occur (check Network tab: no requests while hidden).
- Switch tabs back → exactly one refetch fires per query (focus refetch).
- Type into form, hit browser refresh → browser shows native "Leave site?" prompt; after reload the form shows a "Resume draft" banner with the prior values.
- Save successfully → refresh → no resume banner (draft cleared).

## Files touched

- New: `src/hooks/use-persisted-form.ts`
- Edit: `src/components/dashboard/OperationsExceptionHub.tsx`
- Edit: `src/hooks/use-exception-feed.ts`
- Edit: `src/hooks/use-supabase-data.ts` (single polling block at line 936)
- Edit: `src/components/admin/governance-hub-workspace.tsx`
- Edit: `src/components/dashboard/formal-audit-checklist.tsx`

## Out of scope

- No DB / migration changes.
- No changes to `dispatch-resolve-modal.tsx` or other resolve modals (can be added later with the same hook if useful).
- No global QueryClient defaults change — settings applied per-query to avoid affecting unrelated reads.
