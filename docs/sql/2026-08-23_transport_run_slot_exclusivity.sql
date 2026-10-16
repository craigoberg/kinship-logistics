-- One live Manifest per run slot (event IN/HOME or Day Centre morning/afternoon).
-- Cancels leftover active drafts when the same slot already completed, then
-- unique-indexes active+completed so a second Start cannot race.
--
-- trip_date is date — never COALESCE it to ''.
-- Idempotent. Safe to re-run.
-- Supabase SQL Editor often reports "Success. No rows returned" for this script.

-- ── 1. Event leftovers: cancel active IN/HOME when that slot is already completed
UPDATE transport_trips t
SET status = 'cancelled',
    updated_at = now()
WHERE t.status = 'active'
  AND t.event_id IS NOT NULL
  AND t.hop_index IS NULL
  AND COALESCE(t.trip_kind, '') IS DISTINCT FROM 'event_venue_hop'
  AND EXISTS (
    SELECT 1
    FROM transport_trips c
    WHERE c.event_id = t.event_id
      AND c.id <> t.id
      AND c.status = 'completed'
      AND c.hop_index IS NULL
      AND COALESCE(c.trip_kind, '') IS DISTINCT FROM 'event_venue_hop'
      AND c.trip_date IS NOT DISTINCT FROM t.trip_date
      AND COALESCE(c.bus_run_code, '') = COALESCE(t.bus_run_code, '')
      AND COALESCE(c.trip_return, '') = COALESCE(t.trip_return, '')
  );

-- Extra active twins (no completed sibling) — keep earliest created, cancel the rest
UPDATE transport_trips t
SET status = 'cancelled',
    updated_at = now()
WHERE t.status = 'active'
  AND t.event_id IS NOT NULL
  AND t.hop_index IS NULL
  AND COALESCE(t.trip_kind, '') IS DISTINCT FROM 'event_venue_hop'
  AND EXISTS (
    SELECT 1
    FROM transport_trips keep
    WHERE keep.event_id = t.event_id
      AND keep.id <> t.id
      AND keep.status = 'active'
      AND keep.hop_index IS NULL
      AND COALESCE(keep.trip_kind, '') IS DISTINCT FROM 'event_venue_hop'
      AND keep.trip_date IS NOT DISTINCT FROM t.trip_date
      AND COALESCE(keep.bus_run_code, '') = COALESCE(t.bus_run_code, '')
      AND COALESCE(keep.trip_return, '') = COALESCE(t.trip_return, '')
      AND keep.created_at < t.created_at
  );

-- ── 2. Day Centre leftovers (event_id IS NULL)
UPDATE transport_trips t
SET status = 'cancelled',
    updated_at = now()
WHERE t.status = 'active'
  AND t.event_id IS NULL
  AND t.hop_index IS NULL
  AND EXISTS (
    SELECT 1
    FROM transport_trips c
    WHERE c.event_id IS NULL
      AND c.id <> t.id
      AND c.status = 'completed'
      AND c.hop_index IS NULL
      AND c.trip_date IS NOT DISTINCT FROM t.trip_date
      AND COALESCE(c.bus_run_code, '') = COALESCE(t.bus_run_code, '')
      AND COALESCE(c.trip_return, '') = COALESCE(t.trip_return, '')
  );

UPDATE transport_trips t
SET status = 'cancelled',
    updated_at = now()
WHERE t.status = 'active'
  AND t.event_id IS NULL
  AND t.hop_index IS NULL
  AND EXISTS (
    SELECT 1
    FROM transport_trips keep
    WHERE keep.event_id IS NULL
      AND keep.id <> t.id
      AND keep.status = 'active'
      AND keep.hop_index IS NULL
      AND keep.trip_date IS NOT DISTINCT FROM t.trip_date
      AND COALESCE(keep.bus_run_code, '') = COALESCE(t.bus_run_code, '')
      AND COALESCE(keep.trip_return, '') = COALESCE(t.trip_return, '')
      AND keep.created_at < t.created_at
  );

-- ── 3. Unique slot indexes (skip if leftover duplicates remain)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT event_id,
             COALESCE(trip_date, DATE '0001-01-01'),
             COALESCE(bus_run_code, ''),
             COALESCE(trip_return, '')
      FROM transport_trips
      WHERE event_id IS NOT NULL
        AND status IN ('active', 'completed')
        AND hop_index IS NULL
        AND COALESCE(trip_kind, '') IS DISTINCT FROM 'event_venue_hop'
      GROUP BY 1, 2, 3, 4
      HAVING COUNT(*) > 1
    ) d
  ) THEN
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS transport_trips_event_run_slot_excl
      ON transport_trips (
        event_id,
        COALESCE(trip_date, DATE '0001-01-01'),
        COALESCE(bus_run_code, ''),
        COALESCE(trip_return, '')
      )
      WHERE event_id IS NOT NULL
        AND status IN ('active', 'completed')
        AND hop_index IS NULL
        AND COALESCE(trip_kind, '') IS DISTINCT FROM 'event_venue_hop'
    $idx$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT COALESCE(trip_date, DATE '0001-01-01'),
             COALESCE(bus_run_code, ''),
             COALESCE(trip_return, '')
      FROM transport_trips
      WHERE event_id IS NULL
        AND status IN ('active', 'completed')
        AND hop_index IS NULL
      GROUP BY 1, 2, 3
      HAVING COUNT(*) > 1
    ) d
  ) THEN
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS transport_trips_centre_run_slot_excl
      ON transport_trips (
        COALESCE(trip_date, DATE '0001-01-01'),
        COALESCE(bus_run_code, ''),
        COALESCE(trip_return, '')
      )
      WHERE event_id IS NULL
        AND status IN ('active', 'completed')
        AND hop_index IS NULL
    $idx$;
  END IF;
END $$;
