## Problem
After logging an anomaly the modal closes and the row is persisted, but the Walkthrough Issues Register still displays the empty "No issues logged yet" state because the parent panel’s cached query is not being refreshed.

## Proposed Change
Update the `useMutation` `onSuccess` handler in `src/components/site-day/log-anomaly-modal.tsx` to explicitly invalidate the queries that feed the Issues Register and the session overview.

### Current `onSuccess` (line ~152)
Already calls `queryClient.invalidateQueries({ queryKey: siteIssuesKey(sessionId) })`, which targets the issues list.

### Update
Add an additional invalidation for the today’s session query key so any parent components that derive state from the session also pick up the change immediately:

```ts
onSuccess: (issue) => {
  queryClient.invalidateQueries({ queryKey: siteIssuesKey(sessionId) });
  queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
  reset();
  onOpenChange(false);
  // existing toast logic preserved …
}
```

## Scope
- **File:** `src/components/site-day/log-anomaly-modal.tsx` only.
- No UI, layout, or database changes.
- Existing toast messages and red-issue escalation flow remain untouched.

## Result
The parent panel (`StartOfDayPanel` or `ActiveDayPanel`) will refetch both the issues list and the session record as soon as the mutation succeeds, eliminating the stale empty state.