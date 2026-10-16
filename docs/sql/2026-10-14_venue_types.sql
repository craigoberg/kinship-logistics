-- Venue types are a managed list (Admin → Venues → Venue types).
-- venues.venue_type keeps storing the code (general, park, hotel, …).
-- Idempotent. "Success. No rows returned" is expected for this script.

CREATE TABLE IF NOT EXISTS public.venue_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  label       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_types_code_key UNIQUE (code)
);

COMMENT ON TABLE public.venue_types IS
  'Labels for venues.venue_type. code is stable; label is what Admin shows. hotel is the overnight stay.';

CREATE INDEX IF NOT EXISTS venue_types_status_idx
  ON public.venue_types (status, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_types TO authenticated, service_role;
REVOKE ALL ON TABLE public.venue_types FROM anon;

ALTER TABLE public.venue_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS venue_types_authenticated_all ON public.venue_types;
CREATE POLICY venue_types_authenticated_all
  ON public.venue_types
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

INSERT INTO public.venue_types (code, label, sort_order)
VALUES
  ('general', 'General', 10),
  ('park', 'Park / outdoor', 20),
  ('hotel', 'Hotel / accommodation', 30),
  ('cinema', 'Cinema / theatre', 40),
  ('museum', 'Museum / gallery', 50),
  ('sports', 'Sports / recreation', 60),
  ('restaurant', 'Restaurant / café', 70),
  ('shopping', 'Shopping centre', 80),
  ('club', 'Club / social venue', 90)
ON CONFLICT (code) DO NOTHING;

-- Any type already stored on a venue, but missing from the list above.
INSERT INTO public.venue_types (code, label, sort_order)
SELECT DISTINCT lower(trim(v.venue_type)), lower(trim(v.venue_type)), 200
FROM public.venues v
WHERE nullif(trim(v.venue_type), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.venue_types t
    WHERE t.code = lower(trim(v.venue_type))
  );

-- The name written on an itinerary line when that line is added.
-- Renaming a type does not change lines already on a trip.
ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS venue_type_label text;

COMMENT ON COLUMN public.event_venue_stops.venue_type_label IS
  'Venue type name at the time this stop was added. A later rename does not rewrite it.';

UPDATE public.event_venue_stops s
SET venue_type_label = t.label
FROM public.venues v
JOIN public.venue_types t ON t.code = lower(trim(v.venue_type))
WHERE s.venue_id = v.id
  AND s.venue_type_label IS NULL;

-- Validation: expect at least these 9 codes (extra rows are fine if a venue
-- already used another type):
-- SELECT code, label, sort_order, status
-- FROM public.venue_types
-- WHERE code IN (
--   'general', 'park', 'hotel', 'cinema', 'museum',
--   'sports', 'restaurant', 'shopping', 'club'
-- )
-- ORDER BY sort_order;
--
-- Policy: expect 1 row, roles {authenticated}, cmd ALL:
-- SELECT policyname, roles::text, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'venue_types';
--
-- Itinerary snapshot column: expect 1 row:
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'event_venue_stops'
--   AND column_name = 'venue_type_label';
