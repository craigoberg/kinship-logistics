-- Fix legacy trip_legs.leg_type NOT NULL constraint.
-- App writes leg_kind; mirror it into leg_type via trigger and drop NOT NULL.

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
