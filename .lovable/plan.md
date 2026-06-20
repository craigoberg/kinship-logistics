# SystemParameterManager — Plan

A single source of truth for tunable operational thresholds (e.g. `rego_threshold_days`, `service_km_tolerance_km`), Manager-editable, fully audited via `operational_ledger`, consumed dynamically by hooks.

## 1. Schema — `docs/sql/2026-07-03_system_parameters.sql`

```sql
CREATE TABLE public.system_parameters (
  key          text PRIMARY KEY,
  value        jsonb NOT NULL,
  description  text NOT NULL,
  updated_by   uuid REFERENCES auth.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_parameters TO authenticated, anon;
GRANT UPDATE ON public.system_parameters TO authenticated;
GRANT ALL    ON public.system_parameters TO service_role;

ALTER TABLE public.system_parameters ENABLE ROW LEVEL SECURITY;
```

### RLS

- **SELECT**: open to `authenticated` and `anon` (thresholds are non-sensitive and the app currently runs in PIN/anon mode for some surfaces — matches the existing pattern used by `operational_escalations`).
- **UPDATE**: gated by a `public.is_manager(uuid)` SECURITY DEFINER helper that checks `staff_registry.role = 'manager'` (or the existing equivalent column). This avoids the privilege-escalation footgun called out in the user-roles rule; if/when a dedicated `user_roles` table is introduced, `is_manager` swaps to `has_role(_, 'manager')` without touching call sites.
- **INSERT / DELETE**: service_role only — keys are seeded by migration, never created from the UI.

### Seed (in the same migration)

```sql
INSERT INTO public.system_parameters(key, value, description) VALUES
  ('rego_threshold_days',      '30'::jsonb, 'Days before rego expiry that a vehicle appears on the compliance feed.'),
  ('service_km_tolerance_km',  '500'::jsonb, 'Tolerance over a vehicles scheduled service interval before it is flagged.'),
  ('cert_threshold_days',      '45'::jsonb, 'Days before staff certification expiry that the cert is flagged.')
ON CONFLICT (key) DO NOTHING;
```

`value` is `jsonb` so a parameter can later hold a number, boolean, string, or small object without a schema change.

## 2. Operational ledger pattern

A new action type is added to the ledger vocabulary (no schema change — `action_type` is `text`):

- `action_type`: `'SYSTEM_PARAMETER_UPDATED'`
- `category`: `'CENTRE'` (administrative, non-vehicle)
- `severity`: `'INFO'`
- `metadata`:
  ```json
  {
    "key": "rego_threshold_days",
    "old_value": 30,
    "new_value": 21,
    "justification": "Tightened after Q2 audit finding."
  }
  ```

A new helper `updateSystemParameter(key, newValue, justification)` in `src/lib/api/system-parameters.ts`:

1. Reads the current row (for `old_value`).
2. `UPDATE system_parameters SET value=$, updated_by=auth.uid(), updated_at=now() WHERE key=$`.
3. On success calls `writeToLedger(...)` with the payload above. Ledger write stays best-effort (matches existing convention) but the update itself is rejected by RLS for non-Managers, so an audit gap is not possible for a successful change.
4. Returns `{ key, oldValue, newValue }` for optimistic cache updates.

Justification is `NOT NULL` and trimmed-min-length enforced client-side; recorded only in the ledger (the live table holds current state, the ledger holds the "why").

## 3. UI — Admin tab

### Routing

`src/routes/admin.tsx` currently renders only `AdminLookupWorkspace`. Refactor it into a tabbed shell using the existing `Tabs` primitive:

- **Lookups** — existing `AdminLookupWorkspace`.
- **System Parameters** — new `SystemParameterWorkspace`.

No new route file; tab state lives in URL search (`?tab=parameters`) so deep-links work.

### New components — `src/components/admin/`

- `system-parameter-workspace.tsx` — table of all parameters: `key`, `value` (rendered by type), `description`, `updated_by` (resolved to staff name via existing `listStaffRegistry`), `updated_at` (relative time), and an **Edit** button per row. Read-only when the current user is not a Manager (button hidden, table still visible).
- `edit-system-parameter-modal.tsx` — Dialog containing:
  - Current value (read-only, formatted).
  - New value input — typed by inspecting current `value`:
    - number → `<Input type="number">`,
    - boolean → `<Switch>`,
    - string → `<Input>`,
    - object/array → `<Textarea>` validated with `JSON.parse`.
  - **Justification** `<Textarea>` (required, min 10 chars).
  - Submit disabled until value changed AND justification valid.
  - On submit: call `updateSystemParameter`, invalidate `["system-parameters"]`, toast success, close.

### Data access

`useSystemParameters()` hook in `src/hooks/use-system-parameters.ts`:

```ts
useQuery({
  queryKey: ["system-parameters"],
  queryFn: listSystemParameters,        // returns Record<string, JsonValue>
  staleTime: 60_000,
});

useSystemParameter<T>(key, fallback: T): T  // selector wrapper
```

## 4. Integration — replacing hard-coded constants

Today, thresholds like `rego_threshold_days` live as inline literals in places such as `src/lib/data-store.ts` and the vehicle-compliance pathway feeding `useExceptionFeed`. Migration plan:

1. **Centralise**: every existing hard-coded threshold gets a `key` in the seed migration above.
2. **Hook-level injection**: hooks that derive exceptions (e.g. `useExceptionFeed`'s vehicle pipeline, certification expiry checks, service-due checks) gain a leading `const params = useSystemParameters()` call. The downstream `select` / `useMemo` reads `params.rego_threshold_days ?? 30` etc., so a missing/loading row safely falls back to the previous literal.
3. **Pure helpers**: pure functions in `src/lib/data-store.ts` that currently bake the constant in are refactored to take a `thresholds` argument; the hook is the only place that knows how to obtain the live values. This keeps the lib SSR/test-friendly.
4. **Reactivity**: because `useSystemParameters` is a TanStack Query subscription with `queryKey: ["system-parameters"]`, the modal's `invalidateQueries(["system-parameters"])` after a successful update causes every dependent hook to recompute on the next render — no event bus needed.
5. **Cache coherence**: `staleTime: 60_000` is enough to avoid hammering the API while keeping operator-visible latency to ~1 min worst case; the post-edit invalidation makes the Manager's own change feel instant.

## 5. Audit guarantees (recap for review)

| Concern | Mechanism |
|---|---|
| Only Managers can change values | RLS `UPDATE` policy via `is_manager(auth.uid())` |
| Every change has a reason | `justification` required client-side + stored in ledger metadata |
| Before/after captured | `old_value` / `new_value` in ledger metadata |
| Who & when | `updated_by`/`updated_at` on row + `staff_id`/`created_at` on ledger |
| No silent drift | Hooks read live values; no constants survive in app code post-migration |

## Files to be created / modified (preview)

- **New**: `docs/sql/2026-07-03_system_parameters.sql`
- **New**: `src/lib/api/system-parameters.ts`
- **New**: `src/hooks/use-system-parameters.ts`
- **New**: `src/components/admin/system-parameter-workspace.tsx`
- **New**: `src/components/admin/edit-system-parameter-modal.tsx`
- **Edit**: `src/routes/admin.tsx` (add Tabs shell)
- **Edit**: `src/hooks/use-exception-feed.ts` and `src/lib/data-store.ts` (replace literals with injected thresholds — only the vehicle/cert compliance branches)

Awaiting your review before switching to build mode.
