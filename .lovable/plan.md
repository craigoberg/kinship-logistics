# Formal Safety Audit Module

A new "Formal Audit" resolution path on `ResolveVehicleMaintenanceModal` that renders a dynamic checklist driven by `public.checklist_items`, captures per-item responses, requires a dual-PIN sign-off (Auditor + Witness), and embeds the full checklist into a `VEHICLE_FORMAL_AUDIT` ledger entry.

## 1. Database (new migration `docs/sql/2026-07-05_formal_safety_audit.sql`)

```sql
create table public.checklist_items (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  category    text not null,              -- e.g. 'VEHICLE_FORMAL_AUDIT'
  sort_order  int  not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.checklist_responses (
  id          uuid primary key default gen_random_uuid(),
  ledger_id   uuid not null references public.operational_ledger(id) on delete cascade,
  item_id     uuid not null references public.checklist_items(id),
  status      text not null check (status in ('pass','fail','na')),
  notes       text,
  created_at  timestamptz not null default now()
);

-- Grants (per project convention)
grant select on public.checklist_items to anon, authenticated;
grant all    on public.checklist_items to service_role;
grant select, insert on public.checklist_responses to anon, authenticated;
grant all    on public.checklist_responses to service_role;

alter table public.checklist_items     enable row level security;
alter table public.checklist_responses enable row level security;

create policy "checklist_items_read"      on public.checklist_items
  for select to anon, authenticated using (true);
create policy "checklist_responses_read"  on public.checklist_responses
  for select to anon, authenticated using (true);
create policy "checklist_responses_write" on public.checklist_responses
  for insert to anon, authenticated with check (true);

-- Seed VEHICLE_FORMAL_AUDIT items (brakes, tyres, lights, seatbelts,
-- first-aid kit, fire extinguisher, wheelchair restraints, fluid levels,
-- body damage, registration sticker, fuel cap, dashboard warnings).
insert into public.checklist_items (label, category, sort_order) values
  ('Brakes operating correctly',          'VEHICLE_FORMAL_AUDIT', 10),
  ('Tyre tread + pressure within spec',   'VEHICLE_FORMAL_AUDIT', 20),
  ('All exterior lights functional',      'VEHICLE_FORMAL_AUDIT', 30),
  ('All seatbelts retract and lock',      'VEHICLE_FORMAL_AUDIT', 40),
  ('Wheelchair restraints serviceable',   'VEHICLE_FORMAL_AUDIT', 50),
  ('First-aid kit present + in date',     'VEHICLE_FORMAL_AUDIT', 60),
  ('Fire extinguisher charged + in date', 'VEHICLE_FORMAL_AUDIT', 70),
  ('Fluid levels checked',                'VEHICLE_FORMAL_AUDIT', 80),
  ('No new body damage',                  'VEHICLE_FORMAL_AUDIT', 90),
  ('Registration sticker valid',          'VEHICLE_FORMAL_AUDIT', 100),
  ('No active dashboard warnings',        'VEHICLE_FORMAL_AUDIT', 110);
```

## 2. API layer

**`src/lib/api/checklists.ts` (new)** — `listChecklistItems(category)` ordered by `sort_order, label`; `insertChecklistResponses(ledgerId, rows[])`. Both use the browser `supabase` client.

**`src/lib/api/ledger.ts`** — extend the vehicle resolution flow:
- Add `"formal_audit"` to `VehicleResolutionType`.
- Extend `ResolveVehicleMaintenanceInput` with `auditorStaffId`, `witnessStaffId`, `checklistResponses: { itemId, label, status, notes }[]`.
- New branch in `resolveVehicleMaintenance`:
  - Verify both PINs via `supabase.rpc('verify_staff_pin', …)` (reuses existing RPC). Both must succeed and the two staff IDs must differ.
  - Insert ledger row with `action_type = 'VEHICLE_FORMAL_AUDIT'`, `severity = 'GREEN'` (or `'YELLOW'` if any item is `fail`), `metadata` embedding `auditor_staff_id`, `witness_staff_id`, `checklist_category`, and the full `checklist_responses[]` snapshot (id, label, status, notes).
  - Capture the inserted ledger id (`.select('id').single()`) then insert the per-item rows into `checklist_responses` for relational querying.
  - Does NOT mirror to `transport_assets` (audit is a periodic review, not a flag clear), but writes `last_audit_at` only if the column exists — out of scope for this iteration; leave a TODO.

## 3. UI — `ResolveVehicleMaintenanceModal`

- Add `"Formal Audit"` as a 5th radio option.
- When selected:
  - Hide rego / service / defer / decommission inputs.
  - Fetch `listChecklistItems('VEHICLE_FORMAL_AUDIT')` on demand (cached in state).
  - Render each item as a row: label + RadioGroup (`Pass` / `Fail` / `N/A`) + optional notes (required when `status === 'fail'`, min 6 chars).
  - Two PIN blocks at the bottom: `Auditor` (staff picker + 4-digit PIN) and `Witness` (staff picker + 4-digit PIN). Both required, must be different staff.
  - `canSubmit` requires: every checklist item has a status, every `fail` has notes, both PINs entered, justification ≥ 20 chars. Evidence ref optional for audits.
- On submit, call extended `resolveVehicleMaintenance` with `resolutionType: 'formal_audit'` plus checklist + PIN payloads. Toast on success/failure as today.

New small component `formal-audit-checklist.tsx` co-located in `src/components/dashboard/` to keep the modal file readable.

## 4. Audit guarantees

- Ledger metadata embeds the full checklist snapshot (label + status + notes) so the receipt is self-contained even if `checklist_items` later changes.
- `checklist_responses` rows provide a normalized, queryable mirror keyed by `ledger_id`.
- PIN verification happens server-side via `verify_staff_pin`; raw PINs never leave the modal beyond the RPC call.
- `operational_ledger` remains append-only (existing RLS).

## Files

- new: `docs/sql/2026-07-05_formal_safety_audit.sql`
- new: `src/lib/api/checklists.ts`
- new: `src/components/dashboard/formal-audit-checklist.tsx`
- edit: `src/lib/api/ledger.ts` (add `formal_audit` branch + input fields)
- edit: `src/components/dashboard/resolve-vehicle-maintenance-modal.tsx` (new option, checklist + dual-PIN UI, validation, submit wiring)

## Out of scope

- Admin UI to CRUD `checklist_items` (seeded via SQL for now; manageable via existing Admin lookup workspace pattern in a follow-up).
- Scheduling / reminders for periodic audits.
- Mirroring an `audited_at` column onto `transport_assets`.
