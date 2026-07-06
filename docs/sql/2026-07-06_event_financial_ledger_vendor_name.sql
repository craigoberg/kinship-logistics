-- Optional — add dedicated vendor column (live DB as of 2026-07-06 omits this).
-- Frontend stores vendor in description prefix [Vendor: …] until this is applied.

ALTER TABLE public.event_financial_ledger
  ADD COLUMN IF NOT EXISTS vendor_name text;

COMMENT ON COLUMN public.event_financial_ledger.vendor_name IS
  'Payee / supplier name for event P&L expenses.';
