# 401 Recovery Flow for Day Centre Open/Close

When `openSession` or `closeSession` fails with an auth/permission error (HTTP 401 from PostgREST, or Postgres code `42501` RLS rejection), the current UI just shows a generic red toast like "Could not open the day: …". The Check Leader has no idea what to do next. This plan adds a clear, recoverable flow.

## What the user will see

1. They tap **Declare Site Safe & Compliant** (or **Close Day**).
2. If the call returns 401 / RLS-denied, instead of a toast we open a blocking dialog:
   - **Title:** "Session expired — please re-enter your PIN"
   - **Body:** "Your terminal sign-in has timed out. Re-enter your 4-digit operator PIN to continue. Your mandated checks and notes are preserved."
   - **Primary button:** *Re-enter PIN* (opens an inline PIN pad).
   - **Secondary button:** *Cancel*.
3. After a successful PIN re-entry, a **Retry** button appears (and auto-fires once) that re-runs the exact same open/close call. On success the dialog closes and the normal success toast shows.
4. All other (non-401) errors keep the existing red toast behaviour — no change.

## Pieces to build

### 1. Shared auth-error helper — `src/lib/api/auth-errors.ts` (new)
- `isAuthError(err: unknown): boolean` — true when the error is a PostgrestError with `code === "42501"`, or any error whose `status === 401`, or message contains "row-level security" / "JWT".
- `AuthExpiredError` class for callers that want to rethrow as a typed error.

### 2. Re-usable PIN re-entry dialog — `src/components/auth/pin-reauth-dialog.tsx` (new)
- Controlled `open` / `onOpenChange` props.
- Reuses the same 4-digit numeric input pattern as `src/routes/auth.tsx` (auto-submit on 4 digits, `loginWithPin`, GuardianPinError handling).
- Props:
  - `reason?: string` — short context line ("Re-authenticate to open the Day Centre").
  - `onAuthenticated: () => void` — fired after `loginWithPin` succeeds; parent triggers the retry.
- Internal busy/error state mirrors the auth route; no navigation occurs.

### 3. Wire 401 handling into the two mutations
- **`src/components/site-day/start-of-day-panel.tsx`**
  - Add `reauthOpen` state.
  - In `openMut.onError`, branch: `isAuthError(e)` → `setReauthOpen(true)`; else current toast.
  - Render `<PinReauthDialog open={reauthOpen} reason="Re-authenticate to open the Day Centre." onOpenChange={setReauthOpen} onAuthenticated={() => { setReauthOpen(false); openMut.mutate(); }} />`.
  - Preserve `ticked` state (already component-local, so nothing extra needed).
- **`src/components/site-day/active-day-panel.tsx`**
  - Same pattern around the close mutation; reason text "Re-authenticate to close the Day Centre."
  - Preserve any in-flight close notes by lifting them into state before the mutate call (they already live in component state).

### 4. Toast copy when we don't open the dialog
- Keep current generic toast for non-auth errors.
- When the dialog opens, also fire a single neutral `toast.message("Session expired — please re-enter your PIN.")` so the user notices if the dialog is briefly missed.

## Out of scope

- No RLS / migration changes.
- No changes to `site-day-sessions.ts` API surface beyond optionally exporting the auth-error helper if convenient.
- No global auth interceptor — scoped to the two Day Centre mutations the user called out. (We can generalise later if other surfaces need it.)

## Files touched

- new: `src/lib/api/auth-errors.ts`
- new: `src/components/auth/pin-reauth-dialog.tsx`
- edit: `src/components/site-day/start-of-day-panel.tsx`
- edit: `src/components/site-day/active-day-panel.tsx`
