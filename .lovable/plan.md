# Stop requiring a secret for "Confirm & Open"

## You're right on both counts

1. **Supabase Secrets**: the "Secrets" tab in Supabase only lists Edge Function secrets. The `service_role` key isn't there — it lives under **Project Settings → API → Project API keys**. So "I have no secrets" is true and expected; we were sending you to the wrong place.
2. **Other forms don't need one**: every other write in this app (including `submitManagerHandshake` / `submitLeaderHandshake` on this *same* `site_day_sessions` table — see `src/lib/api/site-day-sessions.ts` lines 217 and 271) goes through the normal browser Supabase client with the publishable key + your signed-in session. They work because RLS already permits authenticated users to update the row.

The only reason **Confirm & Open** is asking for a service-role key is that I previously routed `openSession` / `ensureTodaySession` / `closeSession` / `setPhase` through a TanStack server function that uses `supabaseAdmin`. That was unnecessary — the comment in the file claims "browser is PIN-authenticated only, no Supabase Auth user", but the handshake writes prove that's not actually the case for this app: those updates land fine from the browser. So the server-fn detour added a new secret dependency for no benefit.

## Fix

Revert to the same pattern the handshake functions already use. No new SQL, no new secret, no RLS change.

### Edits

- **`src/lib/api/site-day-sessions.ts`** — rewrite four functions to do the work directly with the browser `supabase` client:
  - `ensureTodaySession()` — `insert({ session_date, phase: "open_pending" }).select().single()`
  - `openSession(notes)` — find-or-create today's row, then `update({ phase: "active_day", opened_by_id, open_declared_at, open_leader_notes })`
  - `closeSession(notes)` — `update({ phase: "closed_orderly", closed_by_id, close_declared_at, close_leader_notes })`
  - `setPhase(id, phase)` — `update({ phase })`
  Keep the ledger writes and `rowToSession` mapping exactly as they are.

- **Delete** `src/lib/api/site-day-sessions.functions.ts` and `src/lib/api/site-day-sessions.server.ts` (no other callers — verified with ripgrep).

- **`src/lib/api/auth-errors.ts`** — remove the service-role-key guidance branch I added earlier; the generic Supabase error mapping is enough.

- **Leave** the `YADA_SUPABASE_SERVICE_ROLE_KEY` secret in place — unused but harmless. You can delete it from Project Settings → Secrets later if you want.

### If a write *does* fail with a permission error after this

Then the real fix is a one-line RLS policy on `site_day_sessions` for `authenticated` (mirroring whatever currently lets the handshake update succeed), not a service-role key. I'll add it if it actually surfaces — but based on the handshake code working, it won't.

## What you'll see

Click **Confirm & Open** → the row updates via the same path as every other form → you flip straight into Active Day. No secret prompt, no Supabase dashboard hunt.
