## Problem
In `LogAnomalyModal`, clicking "Log Note" silently fails when `reportedBy` is an empty string (auth still hydrating). The `if (!reportedBy)` guard in the button click handler blocks `mutation.mutate()`, but because `reportedBy` is never passed into the `NewSiteIssue` payload or used by `createIssue`, the guard is redundant and creates a dead-end UI state.

## Fix
1. **In `src/components/site-day/log-anomaly-modal.tsx`** — remove the `if (!reportedBy)` guard from the button `onClick` handler. The `createIssue` API already fetches the authenticated user internally via `supabase.auth.getUser()`, so `reportedBy` is not needed for submission.
2. **Also remove the unused `reportedBy` prop** from `LogAnomalyModal` (and from `StartOfDayPanel` / `ActiveDayPanel` call-sites) to clean up the API surface.

This eliminates the race-condition blocking behaviour entirely, rather than papering over it with a fallback string that the mutation never consumes.