## Plan: stabilize `useSiteSession` realtime channel lifecycle

1. **Update imports in `src/hooks/use-site-session.ts`**
   - Change the React import to include `useRef` alongside `useEffect`.

2. **Add a channel ref inside `useSiteSession`**
   - Declare `const channelRef = useRef<any>(null);` near the top of the hook.

3. **Guard the realtime effect against duplicate subscriptions**
   - Keep `if (!sessionId) return;` as the first guard.
   - Immediately after it, add `if (channelRef.current) return;` so rapid render ticks cannot create another channel while one is already active.
   - Create the channel using the requested `realtime:site-day-session-${sessionId}` name and assign it to `channelRef.current` after `.subscribe()`.

4. **Strictly clean up the channel ref**
   - In the effect cleanup, check `channelRef.current`.
   - Call `supabase.removeChannel(channelRef.current)`.
   - Set `channelRef.current = null` immediately after removal.

5. **Verify the hook file**
   - Run a focused lint check on `src/hooks/use-site-session.ts` after the edit.