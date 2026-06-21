## Fix Supabase Realtime subscription lifecycle in `use-site-session.ts`

### Problem
The realtime `useEffect` in `use-site-session.ts` is firing before `sessionId` is fully populated, causing the error:
`cannot add postgres_changes callbacks for realtime:... after subscribe()`.
Additionally, the cleanup path delegates channel removal to `subscribeToSiteSession`, making it harder to verify that a dirty channel is fully torn down before a new one is created.

### Plan
1. **Modify `src/hooks/use-site-session.ts`**
   - Import the browser `supabase` client.
   - Replace the delegated `subscribeToSiteSession(...)` call with inline Realtime subscription logic.
   - Set the top-of-effect guard to exactly: `if (!sessionId) return;` — this blocks initialization until a valid session UUID exists, independent of auth-ready state.
   - In the cleanup function, explicitly call `supabase.removeChannel(channel)` before returning, ensuring the previous channel is fully destroyed before any re-subscription.
   - Keep `queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next)` as the payload handler.

2. **No changes required** in `src/lib/api/site-day-sessions.ts` or other consumers; `subscribeToSiteSession` can remain as an exported helper for other callers.

### Files changed
- `src/hooks/use-site-session.ts`

### Acceptance
- No more `cannot add postgres_changes callbacks ... after subscribe()` crashes.
- Effect stays dormant until `sessionId` is truthy.
- Cleanup always invokes `supabase.removeChannel(channel)` on unmount or `sessionId` change.