## Problem

Clicking "Start Daily Trip" successfully creates the `transport_trips` row, but the follow-up bulk insert into `trip_legs` fails with `23502: null value in column "leg_type" of relation "trip_legs" violates not-null constraint`.

The app code (`src/lib/data-store.ts`) writes the leg category into `leg_kind` (values like `depot_to_client`, `client_to_client`, `client_to_venue`, `venue_to_depot`). The live database, however, also has a legacy `leg_type` column marked `NOT NULL` that the app never populates. Our own `docs/sql/2026-06-19_driver_manifest.sql` only defines `leg_kind` — `leg_type` is leftover from an earlier schema iteration that was applied directly to the database.

## Fix

Run a schema migration on `public.trip_legs` that:

1. Backfills `leg_type` for any existing rows from `leg_kind` (so the column isn't empty).
2. Drops the `NOT NULL` constraint on `leg_type`.
3. Adds a `BEFORE INSERT` trigger that mirrors `leg_kind` into `leg_type` automatically, so the legacy column stays populated for anything still reading it without requiring app changes.

This keeps the application code untouched (it continues to send only `leg_kind`) and preserves the legacy column for any reports / views that may still reference it.

### SQL

```sql
UPDATE public.trip_legs
SET leg_type = leg_kind
WHERE leg_type IS NULL AND leg_kind IS NOT NULL;

ALTER TABLE public.trip_legs
  ALTER COLUMN leg_type DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.trip_legs_sync_leg_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.leg_type IS NULL THEN
    NEW.leg_type := NEW.leg_kind;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_legs_sync_leg_type ON public.trip_legs;
CREATE TRIGGER trip_legs_sync_leg_type
BEFORE INSERT OR UPDATE ON public.trip_legs
FOR EACH ROW EXECUTE FUNCTION public.trip_legs_sync_leg_type();
```

## Verification

After the migration, click "Start Daily Trip" again with an event + odometer selected. Expected: `trip_legs` POST returns 201, the manifest UI advances to the in-progress trip view, and no `23502` error appears in the console.

## Out of scope

- No application code changes — `data-store.ts` continues to use `leg_kind` only.
- Not dropping `leg_type` outright in case other DB objects (views, reports) still reference it.
