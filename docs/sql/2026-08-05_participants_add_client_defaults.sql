-- =============================================================================
-- 2026-08-05 — participants: safe defaults for Add client (TEST/DEV)
-- =============================================================================
--
-- Symptom: Add new participant fails with
--   null value in column "dual_witness_pin_hash" … violates not-null constraint
--   and/or participant_kind NOT NULL without default (bootstrap).
--
-- App fix: insertParticipant always sends dual_witness_pin_hash '' and
-- participant_kind 'client'. This SQL aligns the DB for older rows / tools.
--
-- Idempotent. Run on TEST (and DEV for parity).
-- "Success. No rows returned" is normal for ALTER.
-- =============================================================================

-- Optional dual-witness PIN: allow empty / null
ALTER TABLE public.participants
  ALTER COLUMN dual_witness_pin_hash DROP NOT NULL;

ALTER TABLE public.participants
  ALTER COLUMN dual_witness_pin_hash SET DEFAULT '';

UPDATE public.participants
   SET dual_witness_pin_hash = ''
 WHERE dual_witness_pin_hash IS NULL;

-- Client vs guest kind — default clients
ALTER TABLE public.participants
  ALTER COLUMN participant_kind SET DEFAULT 'client';

UPDATE public.participants
   SET participant_kind = 'client'
 WHERE participant_kind IS NULL
    OR btrim(participant_kind) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.participants'::regclass
      AND conname = 'participants_participant_kind_check'
  ) THEN
    ALTER TABLE public.participants
      ADD CONSTRAINT participants_participant_kind_check
      CHECK (participant_kind IN ('client', 'guest'));
  END IF;
END $$;

-- Validation (expect defaults present):
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'participants'
--   AND column_name IN ('dual_witness_pin_hash', 'participant_kind');
