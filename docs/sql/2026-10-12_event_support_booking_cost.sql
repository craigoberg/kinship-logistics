-- Non-participant roster cost and payments.
-- A staff member, volunteer, or carer on a trip can be charged the event price
-- (the default) or a lower amount, and can pay some or all of it.
-- Idempotent. "Success. No rows returned" is expected for this DDL.

ALTER TABLE public.event_support_bookings
  ADD COLUMN IF NOT EXISTS custom_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_fully_paid boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_support_bookings.custom_price IS
  'Null means the full event ticket price. A number is the amount this non-participant is expected to pay.';

CREATE TABLE IF NOT EXISTS public.event_support_payment_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_booking_id uuid NOT NULL REFERENCES public.event_support_bookings(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.event_manifest(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  financial_code text NOT NULL CHECK (financial_code IN ('EVENT_PMT', 'EVENT_REFUND')),
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_support_payment_ledger_booking_idx
  ON public.event_support_payment_ledger (support_booking_id, transaction_date);

CREATE INDEX IF NOT EXISTS event_support_payment_ledger_event_idx
  ON public.event_support_payment_ledger (event_id);

COMMENT ON TABLE public.event_support_payment_ledger IS
  'Payments and refunds for a non-participant on a trip. Not the participant ledger.';

ALTER TABLE public.event_support_payment_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_support_payment_ledger FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_support_payment_ledger TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_support_payment_ledger TO service_role;
DROP POLICY IF EXISTS kinship_authenticated_all_event_support_payment_ledger
  ON public.event_support_payment_ledger;
CREATE POLICY kinship_authenticated_all_event_support_payment_ledger
  ON public.event_support_payment_ledger
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- Validation (these should return rows):
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'event_support_bookings'
--   AND column_name IN ('custom_price', 'notes', 'amount_paid', 'is_fully_paid')
-- ORDER BY column_name;
-- Expect 4 rows.
--
-- SELECT to_regclass('public.event_support_payment_ledger') AS payment_ledger;
-- Expect one row, not null.
