-- Day Centre visitors — kind cleanup:
--   • add 'site' (Site visitor — tradies, inspectors, council, etc.)
--   • merge 'friend' + 'family' → 'friend_family' (Friend / Family)
-- Final set: trial | friend_family | site | other
--
-- Idempotent. Safe if the earlier site-only CHECK was already applied.
-- Supabase SQL Editor may end with "Success. No rows returned" for DDL — expected.

ALTER TABLE public.site_day_visitors
  DROP CONSTRAINT IF EXISTS site_day_visitors_kind_check;

-- Allow transitional values during merge, then tighten.
ALTER TABLE public.site_day_visitors
  ADD CONSTRAINT site_day_visitors_kind_check
  CHECK (kind IN ('trial', 'friend', 'family', 'friend_family', 'other', 'site'));

UPDATE public.site_day_visitors
SET kind = 'friend_family',
    updated_at = now()
WHERE kind IN ('friend', 'family');

ALTER TABLE public.site_day_visitors
  DROP CONSTRAINT IF EXISTS site_day_visitors_kind_check;

ALTER TABLE public.site_day_visitors
  ADD CONSTRAINT site_day_visitors_kind_check
  CHECK (kind IN ('trial', 'friend_family', 'site', 'other'));

COMMENT ON COLUMN public.site_day_visitors.kind IS
  'trial | friend_family | site (contractor/official on site) | other';

-- ── Validation ──────────────────────────────────────────────────────────────
-- Expect 1 row; def lists trial, friend_family, site, other (not friend/family alone):
-- SELECT conname, pg_get_constraintdef(oid) AS def
-- FROM pg_constraint
-- WHERE conrelid = 'public.site_day_visitors'::regclass
--   AND conname = 'site_day_visitors_kind_check';
--
-- Expect 0 rows (legacy kinds gone):
-- SELECT kind, count(*) FROM public.site_day_visitors
-- WHERE kind IN ('friend', 'family') GROUP BY kind;
