## Fixes for "Declare Site Safe & Compliant" failure

### 1. Stop hijacking real errors as "Session expired"

In `src/components/site-day/start-of-day-panel.tsx`, rewrite the `openMut.onError` handler so the actual Supabase error message is surfaced inline (red callout) instead of triggering the PIN re-auth modal on every failure.

- Remove the `isAuthError(e)` branch and the `reauthRetryRef` retry dance.
- Set `authRecoveryMessage` to the raw `e.message` (with any Postgres `code`/`details`/`hint` if present on the error object) so the operator can read the exact constraint failure.
- Replace the callout heading from "Authorisation still required" to "Could not open the day" and drop the "Re-enter PIN" button; keep only **Retry now** and **Dismiss**.
- Remove the `<PinReauthDialog>` mount, the `reauthOpen` state, `reauthRetryRef`, and the now-unused imports (`isAuthError`, `PinReauthDialog`).
- Keep the toast for quick feedback but use `e.message` as the description.

To preserve the raw Supabase fields, widen the mutation's error type from `Error` to `unknown` and format with a small inline helper that pulls `message`, `code`, `details`, `hint` when the value looks like a `PostgrestError`.

### 2. Guarantee a row exists before flipping to `active_day`

In the same file, change the mutation function from `() => openSession("")` to:

```ts
mutationFn: async () => {
  await ensureTodaySession();
  return openSession("");
},
```

Import `ensureTodaySession` alongside `openSession` from `@/lib/api/site-day-sessions`. `openSession` already does a find-or-create internally, but calling `ensureTodaySession()` first matches the Anomaly modal pattern and makes any insert-time RLS/constraint failure surface as the **first** error (clearer diagnostics) rather than being masked by the subsequent update.

### Files touched

- `src/components/site-day/start-of-day-panel.tsx` — the two changes above.

No changes to `src/lib/api/site-day-sessions.ts`, the hook, or any DB migration. After this lands, clicking the green button will either succeed or show the real Postgres error verbatim so we can fix the underlying cause (likely an RLS policy or NOT NULL column on `site_day_sessions`).