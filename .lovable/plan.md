## Goal
Make the `ActiveDayPanel` Issues Register show a unified operational view: today's issues for the current session **plus** any still-`open` issues carried over from previous days. Read-only, no resolved carry-over.

## Changes

### 1. `src/lib/api/site-issues.ts` — add a new fetcher
Add `listActiveIssues(sessionId: string)` alongside the existing `listIssues`. Query:

```ts
supabase
  .from("site_issues_register")
  .select("*")
  .or(`session_id.eq.${sessionId},status.eq.open`)
  .order("created_at", { ascending: false });
```

This returns, in one round trip:
- every row for today's `session_id` (any status), and
- every still-`open` row from prior sessions.
Resolved rows from prior days are excluded by the `status.eq.open` branch and by not matching today's `session_id`.

Keep `listIssues` unchanged so the pre-declaration `StartOfDayPanel` view (which today shows nothing yet anyway, but uses the same hook contract) is untouched.

### 2. `src/hooks/use-site-issues.ts` — add a sibling hook
Add `useActiveSiteIssues(sessionId)` mirroring `useSiteIssues` but:
- queryKey: `["site-issues-active", sessionId ?? "none"]`
- queryFn calls the new `listActiveIssues`
- same auth-ready gating, polling, and dormant realtime effect

Export a matching `activeSiteIssuesKey(sessionId)` helper so `LogAnomalyModal`'s `onSuccess` can invalidate it alongside the existing keys.

### 3. `src/components/site-day/log-anomaly-modal.tsx` — invalidate the new key
Append `queryClient.invalidateQueries({ queryKey: ["site-issues-active"] })` to the existing global invalidation list so a freshly logged anomaly appears immediately in the unified view.

### 4. `src/components/site-day/active-day-panel.tsx` — consume the unified hook
- Swap `useSiteIssues(session.id)` → `useActiveSiteIssues(session.id)`.
- Update the header copy from "No issues or notes logged today" → "No active issues. Use **Log anomaly** above when something needs flagging." (since the list now spans prior open items too).
- `openIssues` count logic unchanged (`status !== 'resolved'`).
- Remains read-only — no new buttons/mutations added.

### 5. `StartOfDayPanel` — no change
Pre-declaration view keeps `useSiteIssues` (session-scoped) since there is no active session_id to unify against yet.

## Why this shape
- Single SQL round trip via `.or(...)` — efficient and indexable on `(session_id)` and `(status)`.
- Read-only contract preserved; only the SELECT widens.
- Separate hook + queryKey avoids cache collisions with the pre-declaration view and with any other caller of `useSiteIssues`.
- No schema changes, no RLS changes, no realtime changes.