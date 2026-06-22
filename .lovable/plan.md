## Two-part fix

### Part A — Recover from the silent bootstrap failure

`src/components/site-day/day-centre-page.tsx`:

1. Add `onError` to `bootstrapMut`:
   - Reset `bootstrappedRef.current = false` so a refetch can retry.
   - Surface the error via toast and via the existing `sessionQ.isError || bootstrapMut.isError` error card.
2. Replace the silent `if (!session)` fallthrough with an explicit branch that shows "Provisioning today's session…" plus a **Retry** button that re-runs `bootstrapMut.mutate()` (also resetting the ref).
3. Add `isReady`, `user?.id`, `bootstrapMut.status`, and `bootstrapMut.error?.message` into the existing `console.log("Current Session State")` for next-time diagnosis.

### Part B — Tell the Opener exactly why they can't open

`src/components/site-day/start-of-day-panel.tsx`:

Replace the bare "X unresolved RED issues" banner with a full guidance card when `hasOpenRed`:

- Headline: **"Cannot open the Day Centre — unresolved RED issue(s)"**
- Body explanation: *"Only a Manager can clear a RED in the Governance Hub. Once every RED below is resolved there, the Open Centre workflow becomes available again."*
- List each open RED `site_issue`:
  - severity chip (RED) + the issue's `title` / `description` (whichever the row carries)
  - logged-at timestamp via `<ClientTime>`
  - logger's display name when available
- Primary CTA button **"Open Governance Hub →"** that navigates to `/admin` (or the existing Hub route — I'll grep `governance-hub-workspace` and `routes/admin.tsx` to confirm the exact path and tab) using TanStack `<Link>`.
- Keep the existing rule that the "Declare Site Safe & Compliant" button stays disabled while `hasOpenRed`.

No schema changes. No backend changes. Manager workflow from the previous turn is untouched.

## Files touched

- `src/components/site-day/day-centre-page.tsx`
- `src/components/site-day/start-of-day-panel.tsx`
