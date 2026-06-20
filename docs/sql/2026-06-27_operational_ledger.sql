-- Operational Ledger (general ledger / NDIS compliance audit trail).
-- Append-only: clients can INSERT and SELECT, but no UPDATE/DELETE policies
-- are defined, so RLS makes rows effectively immutable from the Data API.
--
-- staff_id intentionally has no FK constraint: the resolveStaffIdWithFallback
-- helper can return a synthetic UUID when the signed-in user is not present
-- in staff_registry yet. We never want compliance logging to fail because
-- of an FK miss — the column is still NOT NULL so a value is always recorded.

create table if not exists public.operational_ledger (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  staff_id    uuid not null,
  category    text not null check (category in ('VEHICLE','CENTRE','CLIENT','TRIP')),
  severity    text not null check (severity in ('RED','YELLOW','GREEN','INFO')),
  action_type text not null,
  gps_lat     numeric,
  gps_lng     numeric,
  metadata    jsonb
);

create index if not exists operational_ledger_created_at_idx
  on public.operational_ledger (created_at desc);
create index if not exists operational_ledger_staff_created_idx
  on public.operational_ledger (staff_id, created_at desc);
create index if not exists operational_ledger_category_action_idx
  on public.operational_ledger (category, action_type);

grant select, insert on public.operational_ledger to anon, authenticated;
grant all on public.operational_ledger to service_role;

alter table public.operational_ledger enable row level security;

drop policy if exists "ledger_read_all" on public.operational_ledger;
create policy "ledger_read_all"
  on public.operational_ledger
  for select
  to anon, authenticated
  using (true);

drop policy if exists "ledger_insert_all" on public.operational_ledger;
create policy "ledger_insert_all"
  on public.operational_ledger
  for insert
  to anon, authenticated
  with check (true);

-- No UPDATE or DELETE policies → append-only via the Data API.
