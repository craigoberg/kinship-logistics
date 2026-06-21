## Findings — no filter/column mismatch exists

I read both sides of the query end-to-end. The fields and filter line up exactly:

**Insert (`createIssue` → `src/lib/api/site-issues.ts:100-110`)**
```
session_id:         payload.sessionId   ← from modal prop
reported_by:        auth user id
severity:           green | yellow | red
issue_description:  …
workaround_plan:    … | null
owner:              internal | council
status:             "open"              ← always set
```

**List (`listIssues` → `src/lib/api/site-issues.ts:66-83`)**
```
.from("site_issues_register")
.select("*")
.eq("session_id", sessionId)            ← same column
.order("created_at", { ascending: false })
NO status filter, NO date filter
```

**`sessionId` provenance**
`DayCentrePage` reads one row via `useSiteSession()` and threads `session.id` into both `StartOfDayPanel` (which calls `useSiteIssues(sessionId)`) and `LogAnomalyModal` (which calls `createIssue({ sessionId })`). They are the same UUID by construction — there's no `session_date` involved on either side.

So the three checks you asked me to verify all pass:
- Same identifier? Yes — `session_id` UUID on both sides.
- Hidden `status: 'open'` filter on the list? No — the list returns every status; insert sets `'open'` anyway.
- Column shape? Matches `SiteIssueRow` exactly.

The symptom (empty register after a hard reload, even though the insert log shows success) is therefore **not** a client query mismatch. The row is being written but a fresh `SELECT … WHERE session_id = …` returns 0 rows. The remaining suspects, in order of likelihood:

1. **RLS SELECT policy on `site_issues_register` denies the inserting user.** Insert can succeed under an INSERT policy while SELECT is gated by a stricter policy (e.g. requires a manager role, or a join to `site_day_sessions` the user can't see). PostgREST silently returns `[]` in that case.
2. **The row is written against a different `session_id` than the one currently loaded.** Possible if `ensureTodaySession()` provisioned a new row after the insert (e.g. the day rolled over, or the bootstrap re-ran). The `listIssues` console line already prints the queried `session_id`; the `createIssue` line prints the inserted `session_id` — comparing those two values is the fastest confirmation.
3. **Table actually empty for that session_id** because the insert hit a different schema/role than the SELECT (only relevant if anything in the app uses the service-role client to insert — it doesn't here, both go through the browser client).

## Plan

### Step 1 — Confirm which suspect it is (read-only, no code change)

After this plan is approved, in build mode I will:

1. Run `security--run_security_scan` and `security--get_table_schema` for `site_issues_register` to dump current RLS policies and grants.
2. Have you reproduce once with the console open; compare the two log lines already present:
   - `[SiteIssues] createIssue ← inserted row { session_id: <A> }`
   - `[SiteIssues] listIssues → querying session_id <B>`
   If `A !== B`, it's suspect 2. If `A === B` and `listIssues ← returned 0 rows`, it's suspect 1 (RLS).

### Step 2 — Fix based on what Step 1 shows

**If RLS (most likely):** add/repair a SELECT policy on `public.site_issues_register` so any authenticated user who can see the parent `site_day_sessions` row can read its issues. Sketch:

```sql
CREATE POLICY "Read issues for visible sessions"
ON public.site_issues_register
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.site_day_sessions s
    WHERE s.id = site_issues_register.session_id
  )
);
GRANT SELECT ON public.site_issues_register TO authenticated;
```

Exact `USING` clause will match the existing visibility rule on `site_day_sessions` (read-only check in Step 1 will show what that is).

**If session_id drift:** harden `ensureTodaySession()` to be idempotent on the same calendar day and add a guard in `DayCentrePage` so `bootstrapMut` cannot run after a row already exists in cache. No schema change needed.

### Step 3 — Verify

- Hard reload `/day`, log a green note, hard reload again — register shows the row.
- `security--run_security_scan` returns no new findings.

## What I will NOT do

- I will not add a `status` filter, change column names, or "broaden" the client query further — the client side is already correct, and more shotgun cache invalidation won't make an RLS-blocked SELECT return rows.
