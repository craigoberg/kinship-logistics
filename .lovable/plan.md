## Fix Infinite Loading Spinner on Day Centre Page

### Problem
`day-centre-page.tsx` gets stuck on "Loading today's session…" because the query cache doesn't reliably update after the `ensureTodaySession` bootstrap mutation succeeds.

### Changes

1. **`src/components/site-day/day-centre-page.tsx`**
   - In the `useMutation({ mutationFn: () => ensureTodaySession() })` config, append `queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY })` inside the existing `onSuccess` callback (after the current `setQueryData` call).
   - Replace the page-level loading conditional with `sessionQ.isLoading || bootstrapMut.isPending`.
   - Keep the existing error state handler and phase-based panel routing untouched.

No database or RLS changes. No other files touched.