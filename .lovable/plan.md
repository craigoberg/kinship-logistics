## Fix: Remove user-auth gate from `useSiteSession` query

The `useSiteSession` hook in `src/hooks/use-site-session.ts` currently disables the primary site-day session fetch while `user` is `null` (`enabled: isReady && !!user`). This blocks the page from ever loading the session row, because the bootstrap effect (which creates a missing row) also gates on `!!user`.

### Change
In `src/hooks/use-site-session.ts`:
1. Change `const canQuery = isReady && !!user;` to `const canQuery = isReady;`
2. Remove the `user` dependency from the `useEffect` that starts the realtime subscription, keeping only `isReady` and `sessionId`.
3. Remove the `user` variable if it becomes unused, or keep it if other code still references it.

This lets the query run as soon as auth state is "ready" (regardless of whether a user object is present), matching the user's diagnosis that `hasUser: false` was permanently disabling the fetch.

### Scope
- Only `src/hooks/use-site-session.ts` is touched.
- No UI, routing, or bootstrap logic changes.
- The `day-centre-page.tsx` bootstrap `useEffect` already handles the "no user" case by not auto-creating a session when `!user`.