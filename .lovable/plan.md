# Operational Ledger + Wire into Escalation Release

## Scope note

There is no `resolveGroundedEscalation` helper yet (last plan to add an Unground action was rejected). The existing release path is the `resolve()` function inside `src/components/dashboard/escalation-consultation-modal.tsx` — when a manager picks **Approve**, that row's `status` flips to `resolved_approved` and the driver is cleared. That is the integration point for `VEHICLE_RELEASED`.

## 1. Migration — `operational_ledger`

New migration creating an append-only ledger:

```sql
create table public.operational_ledger (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  staff_id     uuid not null references public.staff(id) on delete restrict,
  category     text not null check (category in ('VEHICLE','CENTRE','CLIENT','TRIP')),
  severity     text not null check (severity in ('RED','YELLOW','GREEN','INFO')),
  action_type  text not null,
  gps_lat      numeric,
  gps_lng      numeric,
  metadata     jsonb
);

create index on public.operational_ledger (created_at desc);
create index on public.operational_ledger (staff_id, created_at desc);
create index on public.operational_ledger (category, action_type);

grant select, insert on public.operational_ledger to authenticated;
grant all on public.operational_ledger to service_role;

alter table public.operational_ledger enable row level security;

-- Append-only: anyone authenticated can insert; nobody can update/delete via API.
create policy "ledger_insert_authenticated"
  on public.operational_ledger for insert to authenticated with check (true);

create policy "ledger_read_authenticated"
  on public.operational_ledger for select to authenticated using (true);
-- No UPDATE / DELETE policies → immutable from the client.
```

(Foreign-key target confirmed as `public.staff` per existing `data-store.ts` / `clearance.ts` usage.)

## 2. Helper — `src/lib/api/ledger.ts`

```ts
export type LedgerCategory = 'VEHICLE' | 'CENTRE' | 'CLIENT' | 'TRIP';
export type LedgerSeverity = 'RED' | 'YELLOW' | 'GREEN' | 'INFO';

export interface LedgerEntry {
  id: string;
  created_at: string;
  staff_id: string;
  category: LedgerCategory;
  severity: LedgerSeverity;
  action_type: string;
  gps_lat: number | null;
  gps_lng: number | null;
  metadata: Record<string, unknown> | null;
}

export async function writeToLedger(
  payload: Omit<LedgerEntry, 'id' | 'created_at'>
): Promise<void> { /* supabase insert, swallow + console.error on failure */ }

// Best-effort, never throws. Resolves to null if denied/unsupported/timeout (3s).
export function tryGetGps(): Promise<{ lat: number; lng: number } | null>;
```

Behaviour:
- `writeToLedger` does a single insert. On error: `console.error('[ledger] write failed', err)` and return — never throws, never toasts. Logging failures must not break the user flow.
- `tryGetGps` wraps `navigator.geolocation.getCurrentPosition` in a Promise with a 3s timeout and `{ enableHighAccuracy: false, maximumAge: 60_000 }`. SSR-safe (returns `null` if `navigator` undefined).

## 3. Integration — escalation release

In `escalation-consultation-modal.tsx` `resolve()`, after the successful `operational_escalations` update and **only on the `resolved_approved` branch** (= vehicle released back to service), fire-and-forget:

```ts
const gps = await tryGetGps();
void writeToLedger({
  staff_id: staffId,
  category: 'VEHICLE',
  severity: 'GREEN',
  action_type: 'VEHICLE_RELEASED',
  gps_lat: gps?.lat ?? null,
  gps_lng: gps?.lng ?? null,
  metadata: {
    escalation_id: escalation.id,
    vehicle_info: escalation.vehicle_info ?? null,
    driver_name: escalation.driver_name ?? null,
    resolution_notes: notes.trim(),
  },
});
```

Wrapped so a ledger failure can never block the toast/close path. `resolved_denied` is intentionally **not** logged as `VEHICLE_RELEASED` (it would be a separate future `VEHICLE_GROUNDED` action).

## 4. Verification

- `bunx tsc --noEmit` clean.
- Approve a Sev 1 escalation in the Coordinator modal → confirm one new row in `operational_ledger` with `action_type='VEHICLE_RELEASED'`, `severity='GREEN'`, `metadata.resolution_notes` populated, and `gps_lat/lng` populated if browser geolocation was granted (else null).
- Deny an escalation → confirm **no** ledger row is written.
- Revoke geolocation permission and retry approve → confirm the resolve still succeeds with null GPS and no error toast.

## Files touched

- `supabase/migrations/<new>.sql` — create `operational_ledger` + grants + RLS.
- `src/lib/api/ledger.ts` — new helper module (`writeToLedger`, `tryGetGps`, types).
- `src/components/dashboard/escalation-consultation-modal.tsx` — add ledger write on approved release.

## Out of scope (flag for follow-up)

- No Manager "Unground" UI for already-denied escalations (previous plan rejected). When that lands, its handler should also call `writeToLedger` with `action_type='VEHICLE_RELEASED'`.
- No reads/reporting UI over `operational_ledger` yet.
