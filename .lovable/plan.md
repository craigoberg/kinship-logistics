## Goal
Add a **Unified Open Issues** panel to the Governance Hub that pulls open items from every operational source the system already has, tagged by origin, with a Resolve action that captures a mandatory resolution note into the `operational_ledger` (NDIS receipt) and flips the source row to resolved/pending=false so the Day Centre's Active Day register drops it automatically.

The existing Hub stays a Compliance Asset registry; the new panel sits above it as a separate tab/section.

## Sources unioned

| Source table | Category | Sub-category | Open filter | Resolve target |
|---|---|---|---|---|
| `site_issues_register` | Day Centre | severity (Red/Yellow/Green) | `status='open'` | `status='resolved'`, `resolved_at=now()` |
| `operational_incidents` | Incident | `incident_type` (mechanical / human_operational) | `status='pending'` | `status='resolved'` |
| `operational_escalations` | Escalation | `gate_id` (with `eventName`/event link when `event_id` set) | `status IN ('pending','claimed')` | `status='resolved_approved'`, `resolved_at=now()`, `resolution_notes=<note>` |
| `compliance_assets` (RED/YELLOW only) | Renewal | `category` (with type as sub) | `status='active'` AND `computeRyge(asset) !== 'green'` | Read-only here — link to existing Compliance Asset editor |

`compliance_assets` is included for visibility but Resolve for it stays in the existing renewal/audit flow; the panel surfaces a "Manage" link that opens the existing `EditAssetModal`. The other three are resolvable inline.

## Data layer

### New file: `src/lib/api/unified-issues.ts`
- `UnifiedIssue` type:
  ```ts
  {
    key: string;            // `${source}:${id}` — stable React key + dedupe
    source: 'day_centre' | 'incident' | 'escalation' | 'renewal';
    sourceLabel: string;    // "Day Centre" | "Incident" | "Escalation" | "Renewal"
    category: string;       // e.g. severity for Day Centre, incident_type for Incident
    subCategory: string | null; // event name for escalations etc.
    severity: 'red' | 'yellow' | 'green' | null;
    title: string;          // short summary
    description: string;
    status: string;         // raw source status
    createdAt: string;
    sourceRowId: string;    // for Resolve dispatch
    eventId?: string | null;
    raw: unknown;           // original row for edit/manage links
  }
  ```
- `listOpenUnifiedIssues()` — runs the four `select` queries in parallel via `Promise.all`, normalizes rows to `UnifiedIssue`, and returns them sorted by `createdAt DESC`. Compliance assets are filtered client-side via the existing `computeRyge` helper.
- `resolveUnifiedIssue(issue: UnifiedIssue, resolutionNote: string, resolvedByStaffId: string)`:
  - Validates `resolutionNote.trim().length >= 10`.
  - Dispatches the right UPDATE per `source`.
  - **Always** writes an `operational_ledger` receipt via `writeToLedger` with `action_type='governance.issue_resolved'`, `severity` mapped from the source severity, and metadata `{ source, sourceRowId, category, subCategory, resolutionNote, resolvedByStaffId }` — this is the NDIS-reportable receipt.
  - Throws on `compliance_assets` so the UI never calls it for renewals (the button is hidden for that source anyway).

### New file: `src/hooks/use-unified-issues.ts`
- `unifiedIssuesKey = ['governance-unified-issues']`.
- `useUnifiedIssues()` — `useQuery` wrapping `listOpenUnifiedIssues`, 30s `refetchInterval`, 5s `staleTime`. Auth-ready gated like `useSiteIssues`.

## UI layer

### Update `src/components/admin/governance-hub-workspace.tsx`
Wrap the existing content in a `Tabs` component with two tabs: **Open Issues** (new, default) and **Compliance Assets** (existing content moved verbatim). No behavior change to the existing tab.

### New file: `src/components/admin/unified-issues-panel.tsx`
Renders the unified list:
- Filter bar: `Source` (All / Day Centre / Incident / Escalation / Renewal), `Severity` (All / Red / Yellow / Green), text search.
- Table columns: Source (Badge — colour per source), Category / Sub-category, Severity (RYG badge when present), Title + description (truncated), Created, Action.
- Action column:
  - Day Centre / Incident / Escalation → **Resolve** button → opens `ResolveIssueDialog`.
  - Renewal → **Manage** button → triggers the existing `EditAssetModal` via a callback prop (kept in the parent so we don't duplicate the modal).
- Empty state when no open issues across all sources.
- Loading + error states with the standard pattern.

### New file: `src/components/admin/resolve-issue-dialog.tsx`
- Shows the issue summary (source, category, severity, description).
- `Textarea` for resolution notes — required, min 10 chars, copy: "This text becomes part of the NDIS-reportable operational ledger receipt."
- Confirm button runs `useMutation(resolveUnifiedIssue)`.
- `onSuccess`: toast, invalidate `['governance-unified-issues']`, `['site-issues']`, `['site-issues-active']`, and the existing `SITE_SESSION_QUERY_KEY` so the Active Day register refetches and drops the row. Close dialog.

## Cross-cutting wiring
- `LogAnomalyModal` invalidations already broad-sweep `site-issues*` and `site-day*`. Add `['governance-unified-issues']` to its `onSuccess` so newly logged Day Centre issues appear in the Hub immediately.
- No schema or RLS changes — every table already grants `authenticated` SELECT/UPDATE per existing migrations.

## Out of scope (call out for follow-up)
- Bulk resolve.
- Editing severity / category on a unified row (resolve only).
- Pulling event-based sub-categories beyond the `event_id` column already on escalations/incidents (we'll display the raw event id; a future pass can join to `events` for the name).
- Compliance asset resolve from inside the unified panel.

## Why this shape
- No new tables; everything is composed client-side from existing sources, so we don't fork the source of truth.
- Resolution always writes the ledger receipt **before** flipping the source row, in a single mutation, so an NDIS audit trail exists for every Hub-driven resolution.
- Day Centre drop-off is automatic because the Active Day register already filters resolved rows out and the mutation invalidates its query keys.
- Tabs keep the existing Compliance Asset workflow untouched.