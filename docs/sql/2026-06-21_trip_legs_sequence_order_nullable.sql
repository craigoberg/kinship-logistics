-- Make trip_legs.sequence_order nullable and auto-fill from leg_index
UPDATE public.trip_legs
SET sequence_order = leg_index
WHERE sequence_order IS NULL AND leg_index IS NOT NULL;

ALTER TABLE public.trip_legs
  ALTER COLUMN sequence_order DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.trip_legs_sync_sequence_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sequence_order IS NULL THEN
    NEW.sequence_order := NEW.leg_index;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_legs_sync_sequence_order ON public.trip_legs;
CREATE TRIGGER trip_legs_sync_sequence_order
BEFORE INSERT OR UPDATE ON public.trip_legs
FOR EACH ROW EXECUTE FUNCTION public.trip_legs_sync_sequence_order();
