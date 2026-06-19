# Schema-Driven Operational Form Engine + Sev 1 Escalation

## 1. New types — `src/lib/operational-forms.ts` (new)

```ts
export interface CriticalGate { id: string; label: string; }
export interface OperationalSchema {
  id: string;
  title: string;
  description: string;
  infoBannerText: string;
  criticalGates?: CriticalGate[];
  primaryActionText: string;
}
export const PRE_TRIP_SCHEMA: OperationalSchema = { /* passenger-manifest gate */ };
```

## 2. Data-store additions — `src/lib/data-store.ts` (append)

- `OperationalEscalation` interface (`id`, `clearanceId`, `driverName`, `vehicleInfo`, `gateId`, `status`, `createdAt`, `resolvedAt`, `resolvedBy`).
- `rowToEscalation()` snake→camel mapper.
- `raiseOperationalEscalation({ clearanceId, driverName, vehicleInfo, gateId })` — single insert with `.select().single()`, throws on Postgres error.
- `subscribeToEscalation(escalationId, cb)` — Realtime UPDATE channel on `operational_escalations` filtered by id, mirrors `subscribeToClearance`.

## 3. `DynamicOperationalForm` — `src/components/manifest/dynamic-operational-form.tsx` (new)

Self-contained orchestrator. Layout top→bottom:

1. Header (`schema.title` + `schema.description`).
2. Info banner card (`schema.infoBannerText`).
3. **Critical gate banners** — full-width `h-16 rounded-xl` tap surfaces. Whole banner is the toggle. Unverified: `bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200`. Verified: `bg-emerald-600 text-white` + `<Check />`. State: `Record<gateId, boolean>`.
4. Issue accumulator (reused inline — issues list, add-issue drawer with severity chips + textarea + RED warning, identical visuals to current `IssueAccumulatorPanel`).
5. Footer primary button (`schema.primaryActionText`, h-14, always enabled).
6. "← Change vehicle" secondary link.

**Primary button behaviour:**
- Any gate `false` → open `GuidanceForkSheet`.
- All gates `true` and no RED issues → open `PinDeclarationModal`.
- All gates `true` and RED issues exist → existing dual-handshake path: persist clearance via `insertAssetClearanceWithItems`, hand off to `RedHandshakeWaitingPanel`.

## 4. `GuidanceForkSheet` (inside the same file)

`Sheet side="bottom"` with verbatim copy:
> "You haven't verified the passenger manifest gate. If you are missing passengers, please raise a Sev 1 for Manager Consultation for Approval to Leave."

- Primary: `🚨 RAISE SEV 1 ESCALATION` — `bg-rose-600 hover:bg-rose-700 h-14 w-full`.
- Below: text link `- Go Back & Verify Manifest -` that dismisses.
- On primary press → `handleRaiseSev1()`:
  ```ts
  try {
    const esc = await raiseOperationalEscalation({
      clearanceId, driverName, vehicleInfo,
      gateId: firstUnverifiedGateId,
    });
    onEscalated(esc);
  } catch {
    toast.error("Network error. Please contact the office via phone directly.");
  }
  ```
- `clearanceId` is `null` when no clearance row exists yet (escalation pre-dates persistence). Column is nullable in the live table.

## 5. `PinDeclarationModal` (inside the same file)

`Dialog` containing:
- Comfort declaration text (reused `COMFORT_DECLARATION_TEXT`).
- Masked PIN input: `type="password"` `inputMode="numeric"` `pattern="[0-9]*"` `maxLength={4}` `autoFocus` `autoComplete="off"`, big centered tracking.
- Confirm button (disabled until 4 digits). On confirm:
  1. `insertAssetClearanceWithItems(...)` with current issues + accumulated blob.
  2. `submitDriverAuthorization(clearanceId, driverStaffId, pin)`.
  3. `toast.success`, `onCleared()`.

## 6. Manifest wiring — `src/routes/manifest.tsx`

- Add imports for `DynamicOperationalForm`, `PRE_TRIP_SCHEMA`, `OperationalEscalation`.
- Replace `IssueAccumulatorGate`'s render body to mount `<DynamicOperationalForm schema={PRE_TRIP_SCHEMA} … />`.
- Local state `escalation`. When `onEscalated(esc)` fires → render `<RedHandshakeWaitingPanel escalationId={esc.id} … />` directly (no clearance row).

## 7. `RedHandshakeWaitingPanel` extension — `src/components/manifest/red-handshake-waiting-panel.tsx`

- Make `clearance` and `issues` optional. Add optional `escalationId`.
- When `escalationId` present:
  - Subscribe via `subscribeToEscalation`.
  - Local status state `pending | resolved_approved | resolved_denied`.
  - `resolved_approved` → toast success + `onAuthorized()`.
  - `resolved_denied` → toast error + `onBack()`.
  - Hide driver-PIN section (office unlocks remotely); show "Awaiting office authorization for Sev 1 escalation" body.
- Existing clearance path preserved unchanged when no `escalationId`.

## 8. Verification

- `bunx tsc --noEmit` must return zero errors before reporting done.
- Manual visual sanity: gate banner slate ↔ emerald toggle, Guidance Fork copy verbatim, PIN modal numeric on mobile, escalation path lands on RedHandshakeWaitingPanel with live status.

## Out of scope

- No edits to the existing `IssueAccumulatorPanel` (kept for backwards compatibility / other entry points).
- No edits to the SQL migration (live in Supabase).
- Office-side `claim_operational_escalation` RPC consumer (separate dashboard work).
