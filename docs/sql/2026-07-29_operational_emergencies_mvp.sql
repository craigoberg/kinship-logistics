-- ============================================================================
-- 2026-07-29 — BL-084 Phase B + C MVP
-- operational_emergencies + muster lines; site lockdown / trip suspend columns
-- Idempotent. Anon grants for PIN terminals.
-- ============================================================================

-- ── 1) Emergencies (Drill | Live) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operational_emergencies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                    text NOT NULL CHECK (mode IN ('drill', 'live')),
  severity                text NOT NULL CHECK (severity IN ('yellow', 'red')),
  situation_text          text NOT NULL,
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'stood_down')),
  site_day_session_id     uuid REFERENCES public.site_day_sessions(id) ON DELETE SET NULL,
  event_id                uuid,
  event_day_session_id    uuid,
  surface                 text NOT NULL DEFAULT 'centre'
                            CHECK (surface IN ('centre', 'trip', 'manifest')),
  activated_by_staff_id   uuid NOT NULL REFERENCES public.staff_registry(id),
  activated_at            timestamptz NOT NULL DEFAULT now(),
  stood_down_by_staff_id  uuid REFERENCES public.staff_registry(id),
  stood_down_at           timestamptz,
  debrief_text            text,
  hub_issue_id            uuid REFERENCES public.site_issues_register(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_op_emergencies_active
  ON public.operational_emergencies (status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_op_emergencies_site_day
  ON public.operational_emergencies (site_day_session_id)
  WHERE site_day_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_op_emergencies_event_day
  ON public.operational_emergencies (event_day_session_id)
  WHERE event_day_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_op_emergencies_hub
  ON public.operational_emergencies (hub_issue_id)
  WHERE hub_issue_id IS NOT NULL;

COMMENT ON TABLE public.operational_emergencies IS
  'BL-084 Phase C — manager-activated Drill/Live emergency with light muster + stand-down.';

-- At most one active emergency per centre session
CREATE UNIQUE INDEX IF NOT EXISTS uq_op_emergencies_one_active_centre
  ON public.operational_emergencies (site_day_session_id)
  WHERE status = 'active' AND site_day_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_op_emergencies_one_active_event_day
  ON public.operational_emergencies (event_day_session_id)
  WHERE status = 'active' AND event_day_session_id IS NOT NULL;

-- ── 2) Light muster lines ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operational_emergency_muster (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id            uuid NOT NULL REFERENCES public.operational_emergencies(id) ON DELETE CASCADE,
  participant_id          uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  participant_name        text,
  state                   text NOT NULL DEFAULT 'expected'
                            CHECK (state IN ('expected', 'accounted', 'missing')),
  updated_by_staff_id     uuid REFERENCES public.staff_registry(id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (emergency_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_op_emergency_muster_emergency
  ON public.operational_emergency_muster (emergency_id);

COMMENT ON TABLE public.operational_emergency_muster IS
  'BL-084 Phase C — light muster (Expected / Accounted / Missing) for people in care.';

-- ── 3) Phase B — centre lockdown (active day) ───────────────────────────────
ALTER TABLE public.site_day_sessions
  ADD COLUMN IF NOT EXISTS lockdown_active boolean NOT NULL DEFAULT false;

ALTER TABLE public.site_day_sessions
  ADD COLUMN IF NOT EXISTS lockdown_reason text;

ALTER TABLE public.site_day_sessions
  ADD COLUMN IF NOT EXISTS lockdown_severity text;

ALTER TABLE public.site_day_sessions
  DROP CONSTRAINT IF EXISTS site_day_sessions_lockdown_severity_check;

ALTER TABLE public.site_day_sessions
  ADD CONSTRAINT site_day_sessions_lockdown_severity_check
  CHECK (
    lockdown_severity IS NULL
    OR lockdown_severity IN ('yellow', 'red')
  );

ALTER TABLE public.site_day_sessions
  ADD COLUMN IF NOT EXISTS lockdown_hub_issue_id uuid
    REFERENCES public.site_issues_register(id) ON DELETE SET NULL;

ALTER TABLE public.site_day_sessions
  ADD COLUMN IF NOT EXISTS lockdown_at timestamptz;

ALTER TABLE public.site_day_sessions
  ADD COLUMN IF NOT EXISTS lockdown_by_staff_id uuid
    REFERENCES public.staff_registry(id);

COMMENT ON COLUMN public.site_day_sessions.lockdown_active IS
  'BL-084 Phase B — blocks new arrivals; orderly close still required.';

-- ── 4) Phase B — trip programme suspend ─────────────────────────────────────
ALTER TABLE public.event_day_sessions
  ADD COLUMN IF NOT EXISTS programme_suspended boolean NOT NULL DEFAULT false;

ALTER TABLE public.event_day_sessions
  ADD COLUMN IF NOT EXISTS programme_suspend_reason text;

ALTER TABLE public.event_day_sessions
  ADD COLUMN IF NOT EXISTS programme_suspend_severity text;

ALTER TABLE public.event_day_sessions
  DROP CONSTRAINT IF EXISTS event_day_sessions_programme_suspend_severity_check;

ALTER TABLE public.event_day_sessions
  ADD CONSTRAINT event_day_sessions_programme_suspend_severity_check
  CHECK (
    programme_suspend_severity IS NULL
    OR programme_suspend_severity IN ('yellow', 'red')
  );

ALTER TABLE public.event_day_sessions
  ADD COLUMN IF NOT EXISTS programme_suspend_hub_issue_id uuid
    REFERENCES public.site_issues_register(id) ON DELETE SET NULL;

ALTER TABLE public.event_day_sessions
  ADD COLUMN IF NOT EXISTS programme_suspended_at timestamptz;

ALTER TABLE public.event_day_sessions
  ADD COLUMN IF NOT EXISTS programme_suspended_by_staff_id uuid
    REFERENCES public.staff_registry(id);

-- ── 5) RLS + anon ───────────────────────────────────────────────────────────
ALTER TABLE public.operational_emergencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_emergency_muster ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS op_emergencies_anon_all ON public.operational_emergencies;
CREATE POLICY op_emergencies_anon_all
  ON public.operational_emergencies
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS op_emergency_muster_anon_all ON public.operational_emergency_muster;
CREATE POLICY op_emergency_muster_anon_all
  ON public.operational_emergency_muster
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operational_emergencies TO anon, authenticated;
GRANT ALL ON public.operational_emergencies TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operational_emergency_muster TO anon, authenticated;
GRANT ALL ON public.operational_emergency_muster TO service_role;

NOTIFY pgrst, 'reload schema';

-- Validation (expect rows):
--   SELECT relname FROM pg_class
--   WHERE relname IN ('operational_emergencies', 'operational_emergency_muster');
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'site_day_sessions' AND column_name = 'lockdown_active';
