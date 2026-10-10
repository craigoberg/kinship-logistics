-- =============================================================================
-- 2026-08-20 — Day-login operational RLS (BL-117 / BL-002 security slice B)
-- =============================================================================
--
-- AuthGate already requires Supabase Auth (email + password) before PIN.
-- This migration matches the database to that model:
--
--   * Operational tables: REVOKE anon. authenticated + service_role keep CRUD.
--   * Public website: anon SELECT on published CMS + enabled public form defs.
--   * Public form submit: SECURITY DEFINER RPC only (no anon INSERT on Hub).
--   * PIN / backup RPCs: not callable as anon (stops PIN brute-force + dump).
--
-- Run on DEV then TEST (same file). SQL Editor "Success. No rows returned"
-- is expected for the DDL/REVOKE/GRANT body.
--
-- After infrastructure restore from an *old* backup, re-run this file.
-- =============================================================================

-- ---------- 1) Public form submit RPC ----------
CREATE OR REPLACE FUNCTION public.submit_public_form(
  p_form_key text,
  p_channel text,
  p_is_anonymous boolean,
  p_submitter_name text DEFAULT NULL,
  p_submitter_email text DEFAULT NULL,
  p_submitter_phone text DEFAULT NULL,
  p_submitter_role text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_extra jsonb DEFAULT '{}'::jsonb,
  p_linked_participant_id uuid DEFAULT NULL,
  p_linked_staff_id uuid DEFAULT NULL
)
RETURNS TABLE (
  reference_code text,
  submission_id uuid,
  hub_incident_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_def public.public_form_definitions%ROWTYPE;
  v_anonymous boolean;
  v_message text;
  v_ref text;
  v_prefix text;
  v_who text;
  v_tag text;
  v_description text;
  v_severity text;
  v_inc_id uuid;
  v_sub_id uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_role text;
  v_link_p uuid;
  v_link_s uuid;
BEGIN
  IF p_form_key IS NULL OR length(trim(p_form_key)) = 0 THEN
    RAISE EXCEPTION 'Unknown form.';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('public', 'connect') THEN
    RAISE EXCEPTION 'Invalid form channel.';
  END IF;
  IF p_channel = 'connect' AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connect forms require day login.';
  END IF;

  SELECT * INTO v_def
    FROM public.public_form_definitions
   WHERE form_key = trim(p_form_key);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown form.';
  END IF;
  IF p_channel = 'public' AND NOT v_def.enabled_public THEN
    RAISE EXCEPTION 'This form is not available on the public site.';
  END IF;
  IF p_channel = 'connect' AND NOT v_def.enabled_connect THEN
    RAISE EXCEPTION 'This form is not available in Connect.';
  END IF;

  v_message := trim(COALESCE(p_message, ''));
  IF length(v_message) < 20 THEN
    RAISE EXCEPTION 'Please provide at least 20 characters in your message.';
  END IF;

  v_anonymous := COALESCE(v_def.allow_anonymous, false) AND COALESCE(p_is_anonymous, false);
  v_name := NULLIF(trim(COALESCE(p_submitter_name, '')), '');
  v_email := NULLIF(trim(COALESCE(p_submitter_email, '')), '');
  v_phone := NULLIF(trim(COALESCE(p_submitter_phone, '')), '');
  v_role := NULLIF(trim(COALESCE(p_submitter_role, '')), '');
  IF NOT v_anonymous AND v_name IS NULL THEN
    RAISE EXCEPTION 'Name is required unless you submit anonymously.';
  END IF;

  -- Anon must not attach Hub tickets to named clients/staff.
  IF auth.uid() IS NULL THEN
    v_link_p := NULL;
    v_link_s := NULL;
  ELSE
    v_link_p := p_linked_participant_id;
    v_link_s := p_linked_staff_id;
  END IF;

  v_prefix := upper(substr(v_def.form_key, 1, 3));
  v_ref := format(
    'YADA-%s-%s-%s',
    v_prefix,
    to_char(timezone('Australia/Sydney', now()), 'YYYYMMDD'),
    lpad((floor(random() * 1000000))::int::text, 6, '0')
  );

  v_severity := CASE
    WHEN v_def.hub_ticket_type IN ('complaint', 'whistleblow') THEN 'sev2'
    ELSE 'sev3'
  END;

  v_tag := format('[PUBLIC FORM · %s]', upper(v_def.hub_ticket_type));
  IF v_anonymous THEN
    v_who := 'Anonymous';
  ELSE
    v_who := concat_ws(
      ' · ',
      v_name,
      CASE WHEN v_role IS NOT NULL THEN format('(%s)', v_role) END,
      v_email,
      v_phone
    );
  END IF;

  v_description := concat_ws(
    E'\n',
    v_tag || ' ' || v_ref,
    'Channel: ' || p_channel,
    'From: ' || v_who,
    '',
    v_message
  );

  INSERT INTO public.operational_incidents (
    incident_type,
    severity,
    description,
    reported_by,
    status,
    no_participant_involved,
    occurred_at
  ) VALUES (
    'human_operational',
    v_severity,
    v_description,
    CASE WHEN v_anonymous THEN 'Anonymous (public form)' ELSE COALESCE(v_name, 'Public form') END,
    'pending',
    true,
    now()
  )
  RETURNING id INTO v_inc_id;

  INSERT INTO public.public_form_submissions (
    form_key,
    reference_code,
    channel,
    is_anonymous,
    submitter_name,
    submitter_email,
    submitter_phone,
    submitter_role,
    payload,
    hub_incident_id,
    linked_participant_id,
    linked_staff_id
  ) VALUES (
    v_def.form_key,
    v_ref,
    p_channel,
    v_anonymous,
    CASE WHEN v_anonymous THEN NULL ELSE v_name END,
    CASE WHEN v_anonymous THEN NULL ELSE v_email END,
    CASE WHEN v_anonymous THEN NULL ELSE v_phone END,
    v_role,
    jsonb_strip_nulls(
      COALESCE(p_extra, '{}'::jsonb) || jsonb_build_object('message', v_message)
    ),
    v_inc_id,
    v_link_p,
    v_link_s
  )
  RETURNING id INTO v_sub_id;

  reference_code := v_ref;
  submission_id := v_sub_id;
  hub_incident_id := v_inc_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_public_form(
  text, text, boolean, text, text, text, text, text, jsonb, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_form(
  text, text, boolean, text, text, text, text, text, jsonb, uuid, uuid
) TO anon, authenticated, service_role;

-- ---------- 2) Revoke anon on every public table, then grant authenticated ----------
DO $$
DECLARE
  r record;
  keep text[] := ARRAY[
    'cms_pages',
    'cms_nav',
    'cms_media',
    'cms_publish_snapshots',
    'public_form_definitions'
  ];
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r.tablename);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      r.tablename
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      r.tablename
    );
    IF r.tablename = ANY (keep) THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon', r.tablename);
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.relname AS seqname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', r.seqname);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO authenticated', r.seqname);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', r.seqname);
  END LOOP;
END $$;

-- ---------- 3) Revoke anon EXECUTE on public functions; keep authenticated ----------
DO $$
DECLARE
  r record;
  ident text;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  LOOP
    ident := format('public.%I(%s)', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', ident);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', ident);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', ident);
    -- Keep staff RPCs callable after day login. Dangerous backup DDL stays service_role-only below.
    IF r.proname NOT IN (
      'truncate_backup_tables',
      'exec_backup_ddl',
      'backup_drop_all_public_fks',
      'backup_restore_all_public_fks',
      'list_backup_tables',
      'order_tables_for_restore',
      'export_backup_schema_catalog'
    ) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', ident);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', ident);
  END LOOP;
END $$;

-- Public site must still call submit_public_form without a day session.
GRANT EXECUTE ON FUNCTION public.submit_public_form(
  text, text, boolean, text, text, text, text, text, jsonb, uuid, uuid
) TO anon;

-- Backup discovery/truncate: server uses service_role only (not the publishable key).
DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.list_backup_tables() FROM anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.list_backup_tables() TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.order_tables_for_restore(text[]) FROM anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.order_tables_for_restore(text[]) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.export_backup_schema_catalog() FROM anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.export_backup_schema_catalog() TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- PIN verify: day-login JWT or service_role (Admin backup PIN). Not anon.
DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.verify_operator_pin(text) FROM anon;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- ---------- 4) Public-site RLS: published / visible only ----------
DROP POLICY IF EXISTS kinship_anon_all_cms_pages ON public.cms_pages;
DROP POLICY IF EXISTS cms_pages_anon_read_published ON public.cms_pages;
DROP POLICY IF EXISTS cms_pages_authenticated_all ON public.cms_pages;
CREATE POLICY cms_pages_anon_read_published ON public.cms_pages
  FOR SELECT TO anon
  USING (status = 'published');
CREATE POLICY cms_pages_authenticated_all ON public.cms_pages
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_cms_nav ON public.cms_nav;
DROP POLICY IF EXISTS cms_nav_anon_read_visible ON public.cms_nav;
DROP POLICY IF EXISTS cms_nav_authenticated_all ON public.cms_nav;
CREATE POLICY cms_nav_anon_read_visible ON public.cms_nav
  FOR SELECT TO anon
  USING (visible = true);
CREATE POLICY cms_nav_authenticated_all ON public.cms_nav
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_cms_media ON public.cms_media;
DROP POLICY IF EXISTS cms_media_anon_read ON public.cms_media;
DROP POLICY IF EXISTS cms_media_authenticated_all ON public.cms_media;
CREATE POLICY cms_media_anon_read ON public.cms_media
  FOR SELECT TO anon
  USING (true);
CREATE POLICY cms_media_authenticated_all ON public.cms_media
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_cms_publish_snapshots ON public.cms_publish_snapshots;
DROP POLICY IF EXISTS cms_publish_snapshots_anon_read ON public.cms_publish_snapshots;
DROP POLICY IF EXISTS cms_publish_snapshots_authenticated_all ON public.cms_publish_snapshots;
CREATE POLICY cms_publish_snapshots_anon_read ON public.cms_publish_snapshots
  FOR SELECT TO anon
  USING (true);
CREATE POLICY cms_publish_snapshots_authenticated_all ON public.cms_publish_snapshots
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_public_form_definitions ON public.public_form_definitions;
DROP POLICY IF EXISTS public_form_definitions_anon_read ON public.public_form_definitions;
DROP POLICY IF EXISTS public_form_definitions_authenticated_all ON public.public_form_definitions;
CREATE POLICY public_form_definitions_anon_read ON public.public_form_definitions
  FOR SELECT TO anon
  USING (enabled_public = true);
CREATE POLICY public_form_definitions_authenticated_all ON public.public_form_definitions
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS kinship_anon_all_public_form_submissions ON public.public_form_submissions;
DROP POLICY IF EXISTS public_form_submissions_authenticated_all ON public.public_form_submissions;
CREATE POLICY public_form_submissions_authenticated_all ON public.public_form_submissions
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- App tickets: drop leftover anon policies (grants already revoked above).
DROP POLICY IF EXISTS anon_app_tickets_all ON public.app_tickets;
DROP POLICY IF EXISTS anon_app_ticket_notes_all ON public.app_ticket_notes;

-- ---------- 5) Default privileges: new tables should not auto-grant anon ----------
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon',
          r
        );
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon',
          r
        );
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon',
          r
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- Validation (run after load — these SHOULD return rows)
--
-- A) RPC exists — expect 1 row:
--    SELECT proname FROM pg_proc
--    WHERE proname = 'submit_public_form';
--
-- B) Anon has SELECT only on the public-site tables — expect 5 tables:
--    SELECT table_name
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND grantee = 'anon'
--      AND privilege_type = 'SELECT'
--    GROUP BY table_name
--    ORDER BY 1;
--    -- cms_media, cms_nav, cms_pages, cms_publish_snapshots, public_form_definitions
--
-- C) Anon must NOT be able to read participants — expect 0 rows:
--    SELECT privilege_type
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name = 'participants'
--      AND grantee = 'anon';
--
-- D) Authenticated still has SELECT on participants — expect 1+ rows:
--    SELECT privilege_type
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name = 'participants'
--      AND grantee = 'authenticated'
--      AND privilege_type = 'SELECT';
--
-- E) Anon EXECUTE on submit_public_form — expect 1 row:
--    SELECT p.proname
--    FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--    JOIN aclexplode(p.proacl) a ON true
--    WHERE n.nspname = 'public'
--      AND p.proname = 'submit_public_form'
--      AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon');
-- =============================================================================
