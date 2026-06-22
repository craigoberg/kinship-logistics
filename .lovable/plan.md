## Problem

Two related defects in the pre-trip Daily Walkaround:

1. **Green/Yellow issues never reach the Governance Hub.** The Hub's Open Issues panel (`UnifiedIssuesPanel` → `listOpenUnifiedIssues`) reads from four sources: `site_issues_register`, `operational_incidents`, `operational_escalations`, and compliance asset renewals. Pre-trip findings live only in `asset_daily_clearance_items` (and only after the driver clicks **Lock In Declaration**), so the Hub has no visibility.

2. **Drafts vanish on refresh.** `IssueAccumulatorPanel` stores added Green/Yellow issues in local `useState` only. Nothing is persisted until the final submit, so a re-render, refetch, or tab refresh wipes them.

RED handling is unaffected — it already writes through `operational_escalations` immediately.

## Approach — write-ahead through the single-rail `operational_incidents` table

Use the existing single-rail surface the Hub already understands. Each Green/Yellow finding is written to `operational_incidents` the instant the driver logs it, then rehydrated from there on mount.

### 1. Write-ahead on log

In `IssueAccumulatorPanel`'s `LogAnomalyModal.onLogged` handler (Green/Yellow branch only), after pushing to local state, insert into `operational_incidents`:

- `incident_type: "mechanical"` (pre-trip walkaround is fleet/asset-scoped)
- `severity: yellow → "sev2"`, `green → "sev3"`
- `vehicle_id: asset.id`
- `description`: `"[Pre-trip] {finding} — Workaround: {workaround}"` (workaround only if present)
- `reported_by`: driver name
- `status: "pending"` (default)

Store the returned `id` on the `DraftIssue` so the local row and the DB row stay linked. Roll back the local push on insert failure and toast.

### 2. Rehydrate on mount

Add a query (or one-shot fetch in `useEffect`) keyed by `[asset.id, dateStr]`:

```ts
supabase.from("operational_incidents")
  .select("*")
  .eq("vehicle_id", asset.id)
  .eq("status", "pending")
  .gte("created_at", `${dateStr}T00:00:00Z`)
  .in("severity", ["sev2","sev3"])
```

Map rows back to `DraftIssue[]` and seed the `issues` state. This makes the panel survive refresh.

### 3. Lock-In Declaration is unchanged in effect

`insertAssetClearanceWithItems` still writes the clearance + items + `accumulated_issues` blob. The pre-existing `operational_incidents` rows remain `pending` — they are the Hub's view of the finding and the Hub already has a working **Resolve** flow (`resolveUnifiedIssue` → ledger receipt + `status: "resolved"`). No new resolve UI needed.

Optional polish (not required for the fix): include the inserted incident IDs in the clearance `accumulated_issues` blob or items' `notes` for cross-reference.

### 4. Removing a draft before submit

The trash-can button currently only removes from local state. Extend `removeIssue` to also `update({ status: "resolved" })` the corresponding `operational_incidents` row so the Hub doesn't show a phantom that the driver deleted before locking in.

### 5. RED unchanged

RED still goes straight through `raiseOperationalEscalation` inside `LogAnomalyModal`. We do NOT also write an `operational_incidents` row for RED — that would double-count it in the Hub feed (escalations branch already covers it).

## Files to touch (build mode only)

- `src/components/manifest/issue-accumulator-panel.tsx` — write-ahead in `onLogged`, rehydrate on mount, soft-resolve on `removeIssue`.
- (Optional helper) a small wrapper in `src/lib/api/fleet.ts` or new `src/lib/api/pre-trip-findings.ts` for the insert/list/soft-resolve calls, to keep the component clean.

No SQL migration required — `operational_incidents` already has every column we need.

## Verification

1. Reload `/manifest`, open the walkaround for any bus, add one Green and one Yellow finding → confirm they appear in `/governance` → Open Issues with source = **Incident**, severity badges Green/Yellow.
2. Refresh `/manifest` mid-walkaround → confirm the Green/Yellow rows are still listed in the accumulator (rehydrated from DB).
3. Click the trash icon on a draft → confirm it disappears from both the panel and the Hub.
4. Click **Lock In Declaration** with the comfort PIN → confirm clearance saves and the Hub rows remain open and resolvable from the Hub's Resolve dialog (which writes the ledger receipt).
