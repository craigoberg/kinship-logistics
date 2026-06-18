# Active Driver Manifest Workflow

A mobile-first single-screen route that drives the daily transport shift through an ordered chain of legs (Depot → Clients → Venue → Depot), capturing GPS, odometer, passenger presence, and medication bag handover.

## Scope

New route `/manifest` (added to bottom nav). Existing `/transport` page stays untouched — it remains the legacy quick-log form. No changes to medication, carer, or event modules beyond reads.

## Database (new migration `docs/sql/2026-06-19_driver_manifest.sql`)

Two new tables in `public`, both with grants + RLS + `authenticated`-scoped policies (project pattern).

`transport_trips`
- `id uuid pk default gen_random_uuid()`
- `driver_staff_id uuid` (nullable, from `getStaffId()`)
- `event_id uuid references event_manifest(id) on delete set null`
- `trip_date date not null default current_date`
- `start_odometer_km numeric not null`
- `end_odometer_km numeric` (null until shift closed)
- `status text not null default 'active'` — `active | completed`
- `started_at timestamptz not null default now()`
- `completed_at timestamptz`
- Partial unique index: one `active` trip per `driver_staff_id`.

`trip_legs`
- `id uuid pk default gen_random_uuid()`
- `trip_id uuid not null references transport_trips(id) on delete cascade`
- `leg_index int not null` (1-based)
- `leg_kind text not null` — `depot_to_client | client_to_client | client_to_venue | venue_to_depot`
- `from_label text not null`, `to_label text not null`
- `from_participant_id uuid`, `to_participant_id uuid` (nullable; depot/venue have neither)
- `status text not null default 'pending'` — `pending | en_route | arrived | completed`
- `start_lat numeric`, `start_lng numeric`, `start_at timestamptz`
- `end_lat numeric`, `end_lng numeric`, `end_at timestamptz`
- `gps_distance_km numeric`, `logged_distance_km numeric`
- `passenger_present boolean`
- `no_show_triggered_at timestamptz`
- `medication_expected boolean not null default false`
- `medication_handover_confirmed boolean not null default false`
- `unexpected_medication_logged boolean not null default false`
- `unexpected_medication_notes text`
- `completed_at timestamptz`
- Unique `(trip_id, leg_index)`.

Both tables: `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated; GRANT ALL … TO service_role;` then `ENABLE ROW LEVEL SECURITY` and a permissive `authenticated` policy (matches existing `transport`/`carer` tables in this project).

## Data layer (`src/lib/data-store.ts` + `src/hooks/use-supabase-data.ts`)

Add typed helpers + React Query hooks:
- `useActiveTrip()` → fetches the current driver's `active` trip + ordered legs.
- `useStartTrip()` → inserts `transport_trips` row, then generates `trip_legs` from selected event's roster (ordered by `pickup_sequence` if present, else booking order). Sequence built as: depot → each rostered participant → event venue → depot.
- `useUpdateLeg()` → patches a single leg (status/GPS/distance/passenger/medication flags).
- `useCompleteTrip()` → sets `end_odometer_km`, `status='completed'`, `completed_at=now()`.
- All mutations invalidate `["transport_trips","active"]`.

Roster source: read `event_roster_bookings` joined with `participants` for the chosen `event_manifest.id`, scoped to today's event date.

## UI (`src/routes/manifest.tsx` + components under `src/components/manifest/`)

Route is mobile-first, `ssr: false`. Layout:

```text
┌── max-w-md mx-auto h-[100dvh] flex flex-col ──┐
│ sticky top: TripStatusHeader (km counter,    │
│   leg X of Y, event name, status pill)       │
├──────────────────────────────────────────────┤
│ flex-1 overflow-y-auto: LegItinerary         │
│   • ActiveLegCard (border-2 border-blue-500) │
│   • UpcomingLegList (opacity-50)             │
│   • CompletedLegList (collapsed, check mark) │
├──────────────────────────────────────────────┤
│ sticky bottom: FooterActions / FinalizeCard  │
└──────────────────────────────────────────────┘
```

Components:
- `InitializeTripCard` — shown when `useActiveTrip()` returns null. Event `<Select>` (today's events from `event_manifest`), odometer numeric input, blue full-width submit.
- `ActiveLegCard` — context-aware single primary button driven by `leg.status`:
  - `pending` → teal "🚀 Start Leg / Set En Route" → `navigator.geolocation.getCurrentPosition` → write `start_lat/lng/at`, status → `en_route`.
  - `en_route` → amber pulsing "🛑 Arrived at Destination" → capture end coords, compute Haversine km, status → `arrived`, populate editable `logged_distance_km`.
  - `arrived` → hides primary button, renders `ArrivedChecklist`.
- `ArrivedChecklist`:
  - "Logged Leg Kilometers (GPS)" editable numeric input (default = `gps_distance_km`).
  - Passenger present `<Switch>` (default on).
  - When off → red "⚠️ Trigger No-Show Countdown" button → opens existing `NoShowCountdownModal` (already in `src/components/attendance/`); pass primary carer phone from `carers_registry` (where `is_primary_contact = true`) with fallback to `participants.phone`, rendered as a `tel:` link inside the modal.
  - Medication panel: if participant has any active `participant_medication_schedules` row → amber alert + mandatory "Medication Bag Handover Confirmed" checkbox (blocks completion).
  - Always shown: "➕ Log Unexpected Medication Bag Received" checkbox; when checked slide-expands a `Textarea`.
  - Green full-width "Confirm & Log Leg Completion" — disabled until checklist passes; on click sets leg to `completed`, advances `currentLegIndex`, auto-scrolls next card into view.
- `UpcomingLegList` — grayed, `pointer-events-none`.
- `FinalizeShiftCard` — appears after last leg completed; ending odometer input + red "🏁 End Shift & Lock Daily Run Logs".

Visuals use the literal Tailwind classes from the spec (`bg-blue-600`, `bg-teal-600`, `bg-amber-500 animate-pulse`, `bg-red-600`, `bg-green-600`, `bg-red-700`, `h-14 rounded-xl font-bold`). Container `max-w-md mx-auto` with `overflow-x-hidden` on root.

## Haversine helper

New `src/lib/geo.ts` exporting `haversineKm(a, b)` (pure function, unit-testable later).

## Error handling

All mutations wrapped with `try/catch`; on failure `toast.error((err as Error).message, { className: "!bg-red-600 !text-white !border-red-700", duration: 12_000 })`. Modals stay open on failure.

## Navigation

Add "Manifest" tab to `src/components/bottom-nav.tsx` linking to `/manifest`.

## Out of scope

- No edits to existing `/transport` form, medication modals, or carer sheets.
- No new map view — coordinates are stored numerically only.
- No offline queue for manifest legs (online-only v1; existing offline sync queue untouched).

## Files touched

- New: `docs/sql/2026-06-19_driver_manifest.sql`
- New: `src/lib/geo.ts`
- New: `src/routes/manifest.tsx`
- New: `src/components/manifest/{initialize-trip-card,trip-status-header,leg-itinerary,active-leg-card,arrived-checklist,finalize-shift-card}.tsx`
- Edit: `src/lib/data-store.ts` (trip/leg types + queries)
- Edit: `src/hooks/use-supabase-data.ts` (hooks)
- Edit: `src/components/bottom-nav.tsx` (nav entry)
