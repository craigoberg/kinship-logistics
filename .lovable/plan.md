Plan:

1. In `src/components/site-day/day-centre-page.tsx`, insert the requested diagnostic statement immediately before the first loading conditional:

```ts
console.log("Current Session State:", {
  session: sessionQ.data,
  isLoading: sessionQ.isLoading,
  bootstrapPending: bootstrapMut.isPending,
});
```

2. Do not alter routing, database logic, queries, mutations, RLS, or any other component behavior.

3. After approval, I’ll make only this diagnostic change so the browser console shows the values keeping the spinner active.