-- =============================================================================
-- 2026-08-10 — Public CMS + forms → Hub (BL-110 / BL-111 / BL-112)
-- =============================================================================
--
-- yada.org.au content managed from Connect; public form posts create Hub tickets
-- via operational_incidents (human_operational) + public_form_submissions.
--
-- Idempotent. PIN/anon publishable key must INSERT submissions + read published pages.
-- "Success. No rows returned" is normal for DDL.
-- =============================================================================

-- ---------- CMS ----------
CREATE TABLE IF NOT EXISTS public.cms_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NULL,
  body_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  nav_label text NULL,
  nav_order int NOT NULL DEFAULT 100,
  show_in_nav boolean NOT NULL DEFAULT true,
  easy_read boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz NULL,
  updated_by_staff_id uuid NULL REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cms_nav (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  href text NOT NULL,
  sort_order int NOT NULL DEFAULT 100,
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cms_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  kind text NOT NULL DEFAULT 'link'
    CHECK (kind IN ('image', 'pdf', 'link', 'sharepoint')),
  alt_text text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cms_publish_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by_staff_id uuid NULL REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NULL
);

-- ---------- Forms ----------
CREATE TABLE IF NOT EXISTS public.public_form_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_key text NOT NULL UNIQUE,
  title text NOT NULL,
  intro_html text NULL,
  hub_ticket_type text NOT NULL,
  allow_anonymous boolean NOT NULL DEFAULT false,
  enabled_public boolean NOT NULL DEFAULT true,
  enabled_connect boolean NOT NULL DEFAULT true,
  field_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.public_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_key text NOT NULL REFERENCES public.public_form_definitions(form_key),
  reference_code text NOT NULL UNIQUE,
  channel text NOT NULL DEFAULT 'public'
    CHECK (channel IN ('public', 'connect')),
  is_anonymous boolean NOT NULL DEFAULT false,
  submitter_name text NULL,
  submitter_email text NULL,
  submitter_phone text NULL,
  submitter_role text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  hub_incident_id uuid NULL,
  linked_participant_id uuid NULL REFERENCES public.participants(id) ON DELETE SET NULL,
  linked_staff_id uuid NULL REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_form_submissions_form_key_idx
  ON public.public_form_submissions (form_key, created_at DESC);
CREATE INDEX IF NOT EXISTS public_form_submissions_hub_idx
  ON public.public_form_submissions (hub_incident_id);
CREATE INDEX IF NOT EXISTS cms_pages_status_slug_idx
  ON public.cms_pages (status, slug);

CREATE OR REPLACE FUNCTION public.touch_cms_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_cms_pages_updated ON public.cms_pages;
CREATE TRIGGER trg_cms_pages_updated
  BEFORE UPDATE ON public.cms_pages
  FOR EACH ROW EXECUTE FUNCTION public.touch_cms_updated_at();

DROP TRIGGER IF EXISTS trg_cms_nav_updated ON public.cms_nav;
CREATE TRIGGER trg_cms_nav_updated
  BEFORE UPDATE ON public.cms_nav
  FOR EACH ROW EXECUTE FUNCTION public.touch_cms_updated_at();

DROP TRIGGER IF EXISTS trg_public_form_defs_updated ON public.public_form_definitions;
CREATE TRIGGER trg_public_form_defs_updated
  BEFORE UPDATE ON public.public_form_definitions
  FOR EACH ROW EXECUTE FUNCTION public.touch_cms_updated_at();

-- Grants (anon reads published content + inserts submissions)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_pages TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_nav TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_media TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_publish_snapshots TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_form_definitions TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_form_submissions TO anon, authenticated, service_role;

-- operational_incidents already used by Hub; ensure anon can insert for public forms
GRANT SELECT, INSERT, UPDATE ON public.operational_incidents TO anon, authenticated, service_role;

ALTER TABLE public.cms_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_nav ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_publish_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_form_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kinship_anon_all_cms_pages ON public.cms_pages;
CREATE POLICY kinship_anon_all_cms_pages ON public.cms_pages
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_cms_nav ON public.cms_nav;
CREATE POLICY kinship_anon_all_cms_nav ON public.cms_nav
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_cms_media ON public.cms_media;
CREATE POLICY kinship_anon_all_cms_media ON public.cms_media
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_cms_publish_snapshots ON public.cms_publish_snapshots;
CREATE POLICY kinship_anon_all_cms_publish_snapshots ON public.cms_publish_snapshots
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_public_form_definitions ON public.public_form_definitions;
CREATE POLICY kinship_anon_all_public_form_definitions ON public.public_form_definitions
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_public_form_submissions ON public.public_form_submissions;
CREATE POLICY kinship_anon_all_public_form_submissions ON public.public_form_submissions
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Seed form definitions
INSERT INTO public.public_form_definitions
  (form_key, title, intro_html, hub_ticket_type, allow_anonymous, enabled_public, enabled_connect, sort_order)
VALUES
  ('complaint', 'Make a complaint',
   '<p>You can complain anonymously. If you leave contact details we can respond. See our Complaints policy.</p>',
   'complaint', true, true, true, 10),
  ('enquiry', 'General enquiry',
   '<p>Ask about day centre, community supports, or how to join YADA.</p>',
   'enquiry', false, true, true, 20),
  ('feedback', 'Feedback',
   '<p>Tell us how we can improve. Anonymous feedback is welcome.</p>',
   'feedback', true, true, true, 30),
  ('compliment', 'Compliment',
   '<p>Share something that went well — staff, volunteers, or the centre.</p>',
   'compliment', true, true, true, 40),
  ('volunteer_eoi', 'Volunteer expression of interest',
   '<p>Interested in volunteering? Office will follow up and may start Volunteer onboarding in Connect.</p>',
   'volunteer_interest', false, true, true, 50)
ON CONFLICT (form_key) DO UPDATE SET
  title = EXCLUDED.title,
  intro_html = EXCLUDED.intro_html,
  hub_ticket_type = EXCLUDED.hub_ticket_type,
  allow_anonymous = EXCLUDED.allow_anonymous;

-- Seed page shells (published). Editorial copy: run
-- docs/sql/2026-08-10_public_cms_content_v1.sql after this file (idempotent UPDATE).
INSERT INTO public.cms_pages (slug, title, summary, body_blocks, nav_label, nav_order, status, published_at)
VALUES
  ('home', 'Welcome to YADA', 'Young Adults Disabled Association', '[]'::jsonb, 'Home', 10, 'published', now()),
  ('about', 'About us', 'Who we are', '[]'::jsonb, 'About', 20, 'published', now()),
  ('services', 'Services', 'What we offer', '[]'::jsonb, 'Services', 30, 'published', now()),
  ('how-to-join', 'How to join', 'Starting with YADA', '[]'::jsonb, 'How to join', 40, 'published', now()),
  ('policies', 'Policies', 'Public policy set', '[]'::jsonb, 'Policies', 50, 'published', now()),
  ('contact', 'Contact', 'Get in touch', '[]'::jsonb, 'Contact', 60, 'published', now()),
  ('forms', 'Forms', 'Rights and voice', '[]'::jsonb, 'Forms', 70, 'published', now()),
  ('easy-read', 'Easy Read', 'Short Easy Read pages', '[]'::jsonb, 'Easy Read', 80, 'published', now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.cms_nav (label, href, sort_order, visible)
SELECT * FROM (VALUES
  ('Home', '/public', 10, true),
  ('About', '/public/about', 20, true),
  ('Services', '/public/services', 30, true),
  ('How to join', '/public/how-to-join', 40, true),
  ('Policies', '/public/policies', 50, true),
  ('Contact', '/public/contact', 60, true),
  ('Forms', '/public/forms', 70, true),
  ('Easy Read', '/public/easy-read', 80, true)
) AS v(label, href, sort_order, visible)
WHERE NOT EXISTS (SELECT 1 FROM public.cms_nav LIMIT 1);

NOTIFY pgrst, 'reload schema';

-- Validation:
-- SELECT form_key, title, allow_anonymous FROM public.public_form_definitions ORDER BY sort_order;
-- Expect 5 rows.
-- SELECT slug, status FROM public.cms_pages ORDER BY nav_order;
-- Expect >= 8 published rows after seed.
-- SELECT has_table_privilege('anon', 'public.public_form_submissions', 'INSERT');
-- Expect true.
