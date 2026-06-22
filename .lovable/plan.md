# Full Rehydration of the Sev 1 Escalation Workflow

## Problem

When a driver raises a Sev 1 from the walkaround and then refreshes (or the tab is reloaded), the route-guard in `src/routes/manifest.tsx` (lines 146–153) currently swaps the screen for the minimal "wait for decision" card in `red-handshake-waiting-panel.tsx` (lines 88–109). That card:

- Drops the accumulated issue list the driver typed.
- Drops the asset/driver context.
- Skips the three-phase state machine (pending → claimed → resolved_approved → operator PIN), so when the manager approves the workaround the driver never sees the green "Manager Workaround Authorized" PIN card.

Result: the driver who raised the issue is stuck on a dead-end card instead of being put back inside the live escalation form they were in before the refresh.

Separately, when a manager hard-refreshes the Governance Hub, the open RED escalation sometimes fails to come back because of a brittle PostgREST `.or()` filter.

## 1. Driver-side: rehydrate the full escalation form

Replace the minimal route-guard branch with a full rehydration that drops the driver back into `EscalationWaitingPanel` with all original context restored.

In `src/routes/manifest.tsx`, when `escalation` is truthy:

1. Resolve the `TransportAsset` from `escalation.vehicleInfo` against `listTransportAssets()` (match by `${name} · ${regoPlate}`). Fall back to a minimal synthetic asset object if not found.
2. Resolve `driverName` from `escalation.driverName` directly (no staff lookup needed; the row already stores the display name).
3. Rehydrate the issue list: query `operational_incidents` for `asset.id` + today's date with `incident_type='mechanical'`, exactly the same logic `IssueAccumulatorPanel`'s rehydrate already uses, then map to `DraftIssue[]`. Also include the RED entry itself (derived from `escalation.sourceIssueId` if present) so the driver still sees what they reported.
4. Render `<RedHandshakeWaitingPanel escalationId={escalation.id} asset={asset} driverName={driverName} ... />` instead of the `escalation`-only branch.
5. Also restore `localStorage.yada_global_escalation` + `yada_global_escalation_asset` so the existing `onAuthorized` / `onBack` flow inside `InitializeTripScreen` continues to work after the driver acknowledges.

This means the existing `EscalationWaitingPanel` (already in the file, lines 313+) becomes the single rehydration target. It already handles:

- Live subscription to status changes.
- Verbal-Auth-Override.
- Elapsed timer.
- "Manager Workaround Authorized" green card + Driver PIN submit + ledger write.

So no new state machine code is needed — just feed it the rehydrated props.

Then, delete the dead route-guard "Awaiting office authorization" branch in `red-handshake-waiting-panel.tsx` (lines 87–109) and the `escalation?: any` prop, since rehydration is now done one level up.

### Detail panel inside `EscalationWaitingPanel`

Add a compact "What was reported" block above the PIN card showing:

- `escalation.vehicleInfo`, `escalation.driverName`.
- `escalation.gateId` and a "Bus walkaround" / "Day Centre" label from `sourceKind`.
- Rehydrated issue list (chips identical to `ClearanceWaitingPanel`'s "Accumulated issues sent to manager").
- The originating issue text fetched from `operational_incidents` / `site_issues_register` when `sourceIssueId` is set (best-effort; hide if fetch fails).

The elapsed timer + the existing pending / claimed / approved cards stay as-is.

## 2. Manager-side: fix unresolved-RED rehydration on hard refresh

Root cause is the combined `.or()` filter used in two places:

```
status.in.(pending,claimed),and(status.eq.resolved_approved,operator_acknowledged_at.is.null)
```

The comma inside `in.(pending,claimed)` collides with the top-level `.or()` separator, so under some query plans rows do not match. Replace with a form where every branch is wrapped in its own `and(...)`:

```ts
.or(
  "and(status.eq.pending),and(status.eq.claimed),and(status.eq.resolved_approved,operator_acknowledged_at.is.null)"
)
```

Apply in:

- `src/lib/api/clearance.ts` → `getActiveEscalation` (so the driver guard rehydrates reliably too).
- `src/lib/api/unified-issues.ts` → `listOpenUnifiedIssues` (Hub).

As a belt-and-braces, in `src/components/admin/unified-issues-panel.tsx` subscribe to `subscribeToEscalationPool` and call `queryClient.invalidateQueries(unifiedIssuesKey)` on any change. Keeps the Hub current without re-enabling the typing-killer interval poll.

## Technical Notes

- Files touched:
  - `src/routes/manifest.tsx` — rehydrate asset + issues, route to full `RedHandshakeWaitingPanel` with `escalationId`.
  - `src/components/manifest/red-handshake-waiting-panel.tsx` — remove `escalation` prop / dead branch; add "What was reported" details block to `EscalationWaitingPanel`; optional fetch of source issue description.
  - `src/lib/api/clearance.ts`, `src/lib/api/unified-issues.ts` — replace `.or(...)` filters.
  - `src/components/admin/unified-issues-panel.tsx` — realtime invalidation.
- No schema or migration changes.
- No changes to polling/staleTime (kept off).

## Verification

1. Driver raises Sev 1 → hard refresh → returns to the same escalation form with vehicle, gate, accumulated issues, elapsed timer, and the live state machine still wired up; manager approval transitions to the green PIN card without another refresh.
2. Manager opens an unresolved RED in Governance Hub → hard refresh → row reappears immediately.
3. Manager approves workaround → driver popup transitions to "Manager Workaround Authorized" with PIN entry; PIN submit drops the shield on both sides.
