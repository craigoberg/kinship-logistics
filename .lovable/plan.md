## Problem

Two issues on `/admin → System Parameters`:

1. The "Last updated" stamp shows ~11 hours ago for a change made ~1 hour ago. `formatRelative()` in `src/components/admin/system-parameter-workspace.tsx` uses `new Date(iso).toISOString()`, which always renders in **UTC**. In AEST (UTC+10/+11) this looks ~10–11 hours behind local wall-clock time.
2. A React hydration warning fires on the same view because any locale-aware date formatting during SSR disagrees with the browser's first render (server has no concept of the user's timezone).

## Fix

1. **New shared helper** `src/components/ui/client-time.tsx`
   - `<ClientTime iso fmt? />` component and `useClientFormattedDate(iso, options?)` hook.
   - Server / first paint: returns a stable placeholder (raw `YYYY-MM-DD HH:mm` slice of the ISO, or `—`).
   - After mount (`useEffect`): swaps to `new Date(iso).toLocaleString(undefined, options)` — no explicit `timeZone`, so the browser's setting is used automatically.
   - This guarantees SSR/CSR markup matches, then upgrades to local time.

2. **Switch the Admin "Last updated" cell** in `src/components/admin/system-parameter-workspace.tsx` from the UTC `formatRelative` to `<ClientTime>` with `{ dateStyle: "short", timeStyle: "short" }`.

3. **Wrap the other in-render timestamp displays** with the same helper so timezone is uniformly the browser's and no SSR mismatch can occur:
   - `src/components/dashboard/OperationsExceptionHub.tsx` (clearance time, grounded-at)
   - `src/components/ui/NotificationSimulator.tsx` (dispatched-at)
   - `src/components/medication/todays-medication-card.tsx` (administered-at)

4. **Write paths are unchanged.** All `new Date().toISOString()` calls that persist to Supabase stay UTC ISO strings — that is the correct storage format. Only *display* changes.

5. **No project-level TZ override / no user preference UI.** "Align all Date/Time displays to Browser Time Zone settings" is exactly what `toLocaleString` without an explicit `timeZone` does.

## Persist the convention for future builds

So future tasks don't reintroduce UTC strings in the UI:

- **Append a new section to `PROJECT_CONTEXT.md`** — *"10. UI Conventions: Date & Time Display"* — capturing the rule:
  > All user-visible dates and times render in the browser's local timezone via `toLocaleString` (no explicit `timeZone` option). Never display raw `toISOString()` strings. Use `<ClientTime>` / `useClientFormattedDate` from `src/components/ui/client-time.tsx` so SSR and client hydration agree. Storage stays UTC ISO — only the display layer is localized.

- **Add a matching one-liner to `mem://index.md` → Core** so every future session enforces it without re-reading the doc:
  > UI date/time displays use browser local TZ via `<ClientTime>` / `useClientFormattedDate` (`src/components/ui/client-time.tsx`). Never render `toISOString()` to users. Storage stays UTC ISO.

## Files touched

- New: `src/components/ui/client-time.tsx`
- Edit: `src/components/admin/system-parameter-workspace.tsx`
- Edit: `src/components/dashboard/OperationsExceptionHub.tsx`
- Edit: `src/components/ui/NotificationSimulator.tsx`
- Edit: `src/components/medication/todays-medication-card.tsx`
- Edit: `PROJECT_CONTEXT.md` (append §10)
- Edit: `mem://index.md` (append Core rule)

## Verification

- Edit a System Parameter and confirm "Last updated" now matches the local clock within a minute.
- Reload `/admin`; the hydration-mismatch console warning is gone.
- Spot-check the dashboard exception hub and medication card — times render in local TZ without warnings.
