## Fix: Defer `reportedBy` validation to submit time in `LogAnomalyModal`

The render-time `throw new Error("LogAnomalyModal requires a non-empty reportedBy")` is what crashes the route boundary when the modal mounts before `user` hydrates. We will move that check to submission, so the parent page keeps rendering and the user has time to finish hydrating before they ever click the submit button.

### Change in `src/components/site-day/log-anomaly-modal.tsx`

1. Remove the render-time guard at lines 103–105:
   ```ts
   if (!reportedBy) {
     throw new Error("LogAnomalyModal requires a non-empty reportedBy");
   }
   ```
2. Keep the `sessionId` guard (line 100–102) as-is — `sessionId` is always available by the time this renders.
3. In the submit handler / mutation trigger path (the `onClick` that calls `mutation.mutate()` and/or at the top of `mutationFn`), add:
   ```ts
   if (!reportedBy) {
     toast.error("User session not ready", {
       description: "Please wait a moment and try again.",
     });
     return;
   }
   ```
   so an empty `reportedBy` blocks submission gracefully instead of crashing.
4. No changes to `StartOfDayPanel`, `DayCentrePage`, or the auth hook. The parent keeps passing `reportedBy={user?.id ?? ""}` and the modal tolerates the empty string at render time.

### Scope
- One file: `src/components/site-day/log-anomaly-modal.tsx`.
- Pure runtime-validation relaxation: no UI redesign, no query changes, no new gates on the parent.