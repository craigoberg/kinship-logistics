-- =============================================================================
-- 2026-10-10 — Public website forms require a valid email
-- =============================================================================
--
-- yada.org.au forms (channel = public) reject a submit unless the email
-- looks like local@domain.tld.
--
-- Exception: an anonymous complaint stores no name and no contact.
-- Feedback and compliment may still omit the name, but the email is kept
-- so the office can reply.
--
-- Connect rights-and-voice (channel = connect) is unchanged: email stays
-- optional, and an anonymous submit still stores no contact.
--
-- Replaces public.submit_public_form (same signature as
-- docs/sql/2026-08-20_day_login_operational_rls.sql). Grants are kept.
--
-- Run in Supabase Dashboard → SQL Editor → Run All.
-- "Success. No rows returned" is expected. This only replaces the function.
-- =============================================================================

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
  v_stored_email text;
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

  -- Public site: valid email on every form except an anonymous complaint.
  IF p_channel = 'public'
     AND NOT (v_def.form_key = 'complaint' AND v_anonymous)
     AND (
       v_email IS NULL
       OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     )
  THEN
    RAISE EXCEPTION 'A valid email address is required.';
  END IF;

  -- Anonymous complaint: store nothing. Other anonymous public forms keep
  -- the email. Connect anonymous submits still drop contact.
  v_stored_email := CASE
    WHEN v_anonymous AND (v_def.form_key = 'complaint' OR p_channel <> 'public') THEN NULL
    ELSE v_email
  END;

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
  IF v_anonymous AND v_def.form_key = 'complaint' THEN
    v_who := 'Anonymous';
  ELSIF v_anonymous THEN
    v_who := concat_ws(' · ', 'Anonymous', v_stored_email);
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
    v_stored_email,
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

NOTIFY pgrst, 'reload schema';

-- Validation (should return 1 row, email_rule_present = true):
-- SELECT p.proname,
--        pg_get_functiondef(p.oid) LIKE '%A valid email address is required.%' AS email_rule_present
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname = 'submit_public_form';
