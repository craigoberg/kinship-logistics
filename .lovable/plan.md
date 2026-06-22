## Problem

`/day` shows "You are not signed in" for Craig even though he's logged in as Manager. The page gates on Supabase auth `user`, but this app authenticates staff via the staff profile / PIN system (`getActiveUserProfile()`), not Supabase Auth. Console confirms: `userId: null` while the active profile clearly identifies Craig as Manager (the role-based "ask a Manager" branch never even renders because we bail out earlier on `!user`).

## Fix (single file: `src/components/site-day/day-centre-page.tsx`)

Treat "signed in" as: Supabase auth user **OR** an active staff profile present. The Manager check already uses `profile.staffRole` — extend the same source to the sign-in gate.

1. Compute `isSignedIn = !!user || !!profile` once near the top.
2. Bootstrap effect: change `if (!isReady || !user) return;` → `if (!isReady || !isSignedIn) return;` so `ensureTodaySession()` runs for staff-profile logins too.
3. `reportedBy` for `StartOfDayPanel`: fall back to `profile.id` (or the staff profile's user id field) when Supabase `user` is absent, so the opener is still attributed.
4. Signed-out card branch: replace `isReady && !user` with `isReady && !isSignedIn` so it only shows when there's genuinely no session at all.
5. Retry button `disabled`: replace `!user` with `!isSignedIn`.

No other files change. No business-logic / workflow changes — purely the gate that was reading the wrong source.

## Out of scope

- Reworking Supabase auth integration vs. staff-PIN auth.
- Any change to the blocking-RED card, Governance Hub flow, or Manager messaging (those are correct and stay as-is).
