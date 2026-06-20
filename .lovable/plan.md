## Plan

1. **Fix the immediate RPC mismatch**
   - Update the client permission check so it calls the currently deployed function shape: `public.is_manager(_user_id)`.
   - Keep compatibility with the newer planned function shape by trying `_staff_id` only as a fallback if `_user_id` is unavailable/missing.
   - This directly addresses the observed `PGRST202` error: PostgREST says it found `public.is_manager(_user_id)`, but the UI called `_staff_id`.

2. **Preserve PIN-based Manager authorization**
   - Continue deriving the active operator from the PIN session stored by `loginWithPin()`.
   - Ensure staff with `staff_registry.role = 'Manager'` are classified as an office/coordinator session so PIN `1111` remains a valid Manager/admin login rather than being rejected as an unmapped role.

3. **Make the UI permission check resilient**
   - In `SystemParameterWorkspace`, keep showing the table while permission loads.
   - Enable Edit when either:
     - the local PIN profile has `staffRole` containing `Manager`, or
     - the database `is_manager(...)` RPC returns true.
   - Avoid hiding Edit due to a transient RPC/schema-cache mismatch when the local PIN profile is already clearly Manager.

4. **Harden the update path**
   - Before saving, validate Manager status using the same dual-path permission helper.
   - Prefer the database-backed audited update function if present.
   - Fall back to the existing update + ledger write only when the audited RPC is genuinely missing, not when it returns a real authorization error.

5. **Database migration adjustment**
   - Add/adjust the migration so `public.is_manager(_user_id uuid)` can resolve both:
     - a `staff_registry.id` from PIN login, and
     - an authenticated user id via nullable `staff_registry.auth_user_id`.
   - Preserve backwards compatibility: no requirement to add emails or change PIN login; `Craig Oberg` with staff id `68a17753-d387-4b53-a466-40cf1d06a384` and role `Manager` should pass.
   - Keep existing RLS policies safe and avoid breaking modules that already call `is_manager(_user_id)`.

6. **Verify**
   - Re-test `/admin` with a Manager-like PIN session and confirm the System Parameters tab renders Edit buttons.
   - Confirm the network no longer shows `PGRST202` for `rpc/is_manager`.
   - Run a focused lint check on the touched TypeScript files.