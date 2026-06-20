-- Operational Incidents ledger (human & mechanical) backing the Global
-- Incident & Fault Utility. Sev 1 rows additionally trigger a realtime
-- broadcast from the client.

create table if not exists public.operational_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_type text not null check (incident_type in ('mechanical','human_operational')),
  severity text not null check (severity in ('sev1','sev2','sev3')),
  description text not null,
  vehicle_id uuid null,
  event_id uuid null,
  reported_by text not null,
  status text not null default 'pending' check (status in ('pending','resolved')),
  created_at timestamptz not null default now()
);

grant select, insert, update on public.operational_incidents to anon, authenticated;
grant all on public.operational_incidents to service_role;

alter table public.operational_incidents enable row level security;

drop policy if exists "incidents_read_all" on public.operational_incidents;
create policy "incidents_read_all"
  on public.operational_incidents
  for select
  to anon, authenticated
  using (true);

drop policy if exists "incidents_insert_all" on public.operational_incidents;
create policy "incidents_insert_all"
  on public.operational_incidents
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "incidents_update_all" on public.operational_incidents;
create policy "incidents_update_all"
  on public.operational_incidents
  for update
  to anon, authenticated
  using (true)
  with check (true);

alter publication supabase_realtime add table public.operational_incidents;
