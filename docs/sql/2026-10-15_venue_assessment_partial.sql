-- Venue check can be Yes, No, or Partial.
-- Yes = the venue has this and it meets the requirement.
-- No = it does not have this; a note says why the visit is still OK.
-- Partial = some of it complies; the same note is the workaround.
-- Existing Yes/No rows are copied into assessment_result. assessment_met stays for older readers.

ALTER TABLE public.venue_template_fields
  ADD COLUMN IF NOT EXISTS assessment_result text;

UPDATE public.venue_template_fields
SET assessment_result = CASE
  WHEN assessment_met IS TRUE THEN 'yes'
  WHEN assessment_met IS FALSE THEN 'no'
  ELSE assessment_result
END
WHERE assessment_result IS NULL
  AND assessment_met IS NOT NULL;

ALTER TABLE public.venue_template_fields
  DROP CONSTRAINT IF EXISTS venue_template_fields_assessment_result_chk;

ALTER TABLE public.venue_template_fields
  ADD CONSTRAINT venue_template_fields_assessment_result_chk
  CHECK (assessment_result IS NULL OR assessment_result IN ('yes', 'no', 'partial'));
