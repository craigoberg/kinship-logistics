## Plan

1. **Inspect table access**
   - Check the live `site_day_sessions` RLS policies and table grants for `authenticated` read access.
   - If direct schema access is unavailable from this session, use the local SQL/migration evidence and the network request diagnostics to narrow whether this is an RLS/grant problem.

2. **Add exact query diagnostics**
   - In `src/lib/api/site-day-sessions.ts`, log the literal `date` value immediately before the `.eq("session_date", date)` query in `getTodaySession()`.
   - Also log the query outcome shape (`data`, `error`, and `status` if available) without changing query behavior.

3. **Optional access fix if policies are missing**
   - If the live policy/grant check confirms missing read access, add the minimal database grant/policy needed so authenticated users can `SELECT` from `public.site_day_sessions`.
   - Do not widen anonymous access unless an existing policy already intentionally allows it.

4. **Keep scope limited**
   - No phase routing changes, no UI redesign, no table shape changes, and no changes to Start of Day panel behavior.