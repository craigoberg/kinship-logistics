# Manifest pre-trip + Start-of-Day: one reentrant Issue/Escalation engine

## Why

The pre-trip "I have sighted today's passenger manifest" critical-gate is in the wrong place. The driver only knows the manifest **after** clearing the bus and selecting the trip. At walkaround time the driver is doing a **vehicle safety inspection** — exactly the same Green/Yellow/Red workflow we now run for Start-of-Day at the Day Centre. The two flows already write to the same `operational_escalations` rail and the same `operational_ledger`, but the **UI/component layer is duplicated** (`DynamicOperationalForm` vs `MandatedChecksList` + `StartOfDayPanel`). We should merge them into one context-sensitive, reentrant panel.

## Workflow we want (driver bus check-out)

```text
1. Pick vehicle + odometer
2. SAFETY DECLARATION PANEL  ← shared engine (no manifest mention)
     - Tick mandated visual checks (lights, belts, hoist, fluids, …)
     - Log issues as Green (note) / Yellow (workaround) / Red (escalation+dual-PIN)
     - Big primary button stays grey until all checks ticked AND no blocking issue
     - Same timers, refresh halts, RYGE lock, ledger receipt as Start-of-Day
3. Accept bus  (only now is the bus considered safe)
4. Pick today's trip / event   ← manifest verification belongs HERE
5. Start trip
```

Manifest accounting (hoist passengers, totals, missing pax) stays in `EventPickAndStart` / `getTodayManifestSummary`, which already runs after the trip is selected and already raises its own `manifest_accounting` escalation when needed.

## Step 1 — Quick fix (ship first, low risk)

**File:** `src/lib/operational-forms.ts`
- Remove the `passenger-manifest` entry from `PRE_TRIP_SCHEMA.criticalGates` (leave the array empty or drop the property). Leave `prettyGateLabel` mapping intact for historical rows.
- Update `infoBannerText` + `primaryActionText` to read as a vehicle-only declaration.

**File:** `src/components/manifest/dynamic-operational-form.tsx`
- With `gates.length === 0`, the "critical gate banners" block and the `GuidanceForkSheet` ("you haven't verified the passenger manifest") become unreachable. Keep the code paths but tighten copy on `GuidanceForkSheet` to be generic (or remove it from the pre-trip render — it is the only caller).
- `onPrimaryPress` no longer needs the `firstUnverifiedGate` branch when gates are empty; falls straight through to PIN or Red handshake.

That alone removes the bogus check the user is complaining about. Behaviour for Green/Yellow/Red issue logging, dual-PIN, and the dispatch handshake is untouched.

## Step 2 — Merge into one reentrant Issue/Escalation engine

Goal: one component, one set of behaviours (timers, RYGE lock, ledger writes, Red dual-PIN, Yellow workaround, Green note, blocking-vs-carried split, refresh halts), parameterized by **context**.

### New shared module

`src/components/issue-engine/issue-declaration-panel.tsx` (new) — extracted from `StartOfDayPanel` + `DynamicOperationalForm`.

Props (the "context"):

```ts
type IssueContext =
  | { kind: "site-day"; sessionId: string; reportedBy?: string }
  | { kind: "pre-trip"; asset: TransportAsset; startOdometer: number; dateStr: string; driverName: string };

interface Props {
  context: IssueContext;
  copy: {
    heading: string;          // "Start of Day Site Declaration" | "Pre-Trip Driver Declaration"
    subheading: string;
    primaryButtonLabel: string;   // "Declare Site Safe & Open Day Centre" | "Accept Bus & Continue to Trip"
    mandatedSectionLabel: string;
  };
  mandatedChecks: MandatedCheck[];  // pulled from system_parameters per context
  escalationGateId: string;          // "site_day_red" | "pre_trip_red"
  onAccepted: () => void;            // openSession() | proceed to trip pick
  onBack?: () => void;
}
```

Engine responsibilities (single code path):
- Render `MandatedChecksList` (big green tap buttons) sourced from the context-specific lookup.
- Blocking / carried-issue split (Red without accepted workaround = blocking; Yellow without `workaroundPlan` = blocking).
- Primary button grey → green only when `allChecked && !hasBlocking`.
- `LogAnomalyModal` for adding Green/Yellow/Red items; Red uses the same `raiseOperationalEscalation` + `operational_escalations` rail, parameterised by `escalationGateId` and contextual `subject_*` fields.
- Dual-PIN handshake (`PinDeclarationModal` for pre-trip, `Manager joint review` for site-day) — both already feed `operational_escalations`; engine picks the variant from `context.kind`.
- Ledger receipt write before state change (RYGE write-before-update invariant).
- Same RYGE banner / refresh halt / "Active Day" timer hooks already used in `StartOfDayPanel`.

### Wiring

- **`src/components/site-day/start-of-day-panel.tsx`** becomes a thin wrapper that constructs the site-day context, copy, mandated checks via `useMandatedChecks()`, and calls `<IssueDeclarationPanel … />`. Existing carried/blocking card + Issues Register stay as-is below the engine.
- **`src/routes/manifest.tsx`** (`IssueAccumulatorGate`) replaces the `DynamicOperationalForm` call with `<IssueDeclarationPanel context={{ kind: "pre-trip", … }} … />`. The route's step machine (`clearance → event → trip`) is unchanged; only the clearance step's body swaps.
- Delete (or keep as deprecated re-export) `src/components/manifest/dynamic-operational-form.tsx` once `manifest.tsx` is on the shared engine. Keep `red-handshake-waiting-panel.tsx` and `issue-accumulator-panel.tsx` since they handle post-Red waiting UI for the driver.

### Mandated checks per context

Add a second `mandatedCheck` set in `system_parameters` keyed `pre_trip_visual` (lights, belts, hoist, tyres, fluids, body damage…). `useMandatedChecks(scope: "site_day" | "pre_trip")` selects which list to load. No schema migration — just a new parameter category + a `scope` arg on the hook.

### Escalation taxonomy

Add `pre_trip_red` to `prettyGateLabel` mapping. Both `site_day_red` and `pre_trip_red` continue to flow through `claim_operational_escalation` RPC and the single Postgres realtime feed — no parallel pipeline.

## What does NOT change

- `operational_escalations` / `operational_ledger` schema, RPCs, and realtime feeds.
- `EventPickAndStart` and `getTodayManifestSummary` (manifest verification stays post-trip-pick).
- `MandatedChecksList`, `LogAnomalyModal`, `IssuesRegisterCard` (the engine reuses them).
- Dual-PIN, Red dispatch handshake, escalation consultation modal, "open"/"claimed" timers from your last change.

## Rollout

1. Land Step 1 alone (drop the manifest gate) — instantly fixes the user's complaint, no behaviour risk.
2. Land Step 2 behind a feature flag on `/manifest`; verify Red handshake, PIN flow, timers, ledger receipts on both surfaces; then delete the legacy `DynamicOperationalForm`.

## Open questions before build

- **Pre-trip mandated checks list** — do you want a separate `pre_trip_visual` parameter set, or reuse the existing per-vehicle `asset_checkpoints` rows (lights/belts/hoist already live there) as the "mandated checks"?
- **Pre-trip Red handshake** — keep the existing driver-side `RedHandshakeWaitingPanel` flow, or unify with the site-day "Manager joint review" modal?
