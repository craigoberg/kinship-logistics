## Confirmed scope

Every issue surfaced in the Governance Hub — **Day Centre anomalies, Incidents, Escalations, AND Compliance Asset renewals** — uses the same Manage Issue dialog with the same flow:

1. Read-only timeline of all prior notes (newest at bottom, one per line).
2. New note input (min 10 chars).
3. **Log Note & Update** → appends `[dd-mm-yy/hh:mm]: note` to the timeline, closes dialog.
4. Optional **Defer / Next action date** → moves row to Awaiting tab.
5. Optional **Escalate to Council** with severity → moves row to Awaiting tab.
6. **Resolve & Close** (manager PIN) → final note appended, status flipped, NDIS ledger receipt written.

Re-opening any issue (from any source) shows the full historical timeline.

## Architecture decision

Rather than adding an `update_log` column to four different tables (`site_issues_register`, `operational_incidents`, `operational_escalations`, `compliance_assets`), introduce **one central timeline table** keyed by `(source, source_row_id)`. This is the only way to give Compliance Assets and Escalations a timeline without bolting columns onto unrelated schemas, and it keeps the optimistic-concurrency story uniform across sources.

### New table: `public.hub_issue_notes`
```
id              uuid pk default gen_random_uuid()
source          text not null     -- 'day_centre' | 'incident' | 'escalation' | 'renewal'
source_row_id   text not null     -- FK-free (compliance_assets uses uuid, others uuid as text)
note            text not null
stamped_at      timestamptz not null default now()
staff_id        uuid null         -- attribution (nullable for system writes)
kind            text not null default 'append'   -- 'append' | 'defer' | 'escalate' | 'resolve'
metadata        jsonb null        -- defer_until, council_severity, etc.

index (source, source_row_id, stamped_at)
```

- **GRANTs** added in the same migration (per project rules):
  `GRANT SELECT, INSERT ON public.hub_issue_notes TO authenticated;`
  `GRANT ALL ON public.hub_issue_notes TO service_role;`
- **RLS**: enabled. SELECT for authenticated, INSERT for authenticated (no UPDATE/DELETE — append-only, immutable).
- Note: this lives alongside `site_issues_register.update_log`. The existing column stays for backward compat but new appends ALSO write here so the unified read path works.

### Migration file
`docs/sql/2026-07-14_hub_issue_notes.sql` — table + grants + RLS + indexes.

## Code changes

### `src/lib/api/unified-issues.ts`
- New `listIssueNotes(source, sourceRowId)` — single read for any source.
- Rewrite `appendUpdateNote(issue, note)` to INSERT into `hub_issue_notes` for ANY source (no more "day_centre only" throw). Concurrency safety comes from append-only inserts (no row contention).
- `deferUnifiedIssue` / `escalateUnifiedIssueToCouncil`: extend to all sources where it makes sense. For now keep status flips scoped to `site_issues_register` (only table with `status='deferred'` / `awaiting_external`); but the **timeline note** is logged universally. For Incidents / Escalations / Renewals, defer = note-only (with `kind='defer'` + `metadata.defer_until`); they don't drop off the active list until resolved. (Open question — see below.)
- `resolveUnifiedIssue`: writes a `kind='resolve'` note to `hub_issue_notes` in addition to the existing ledger receipt and source-row status flip. Works for incidents, escalations, day_centre, and renewals (renewals: write note + ledger only; no destructive flip on compliance_assets).
- Timestamp helper changed to `dd-mm-yy/hh:mm`.

### `src/components/admin/resolve-issue-dialog.tsx`
- Drop the `isDayCentre` gate around the Timeline panel — show for every source.
- Replace the `site_issues_register.update_log` query with `listIssueNotes(issue.source, issue.sourceRowId)`.
- Render notes as:
  ```
  [24-06-26/14:32]: first note
  [24-06-26/15:01]: follow up
  ```
  (staff name dropped from the visible line; still captured in `staff_id` for audit.)
- Defer/Escalate toggles visible for all sources. For non-day_centre sources the toggle is allowed but a small helper line clarifies: "Note is recorded; status flip only applies to Day Centre rows today."
- Log Note & Update closes dialog on success (already fixed).
- Resolve & Close: manager PIN gate unchanged; now also works for renewals (writes note + ledger; no compliance_assets row mutation).

## Files
- **New**: `docs/sql/2026-07-14_hub_issue_notes.sql`
- **Edited**: `src/lib/api/unified-issues.ts`, `src/components/admin/resolve-issue-dialog.tsx`

## Action after merge
Run `docs/sql/2026-07-14_hub_issue_notes.sql` in the Supabase SQL editor.

## One question before I build

For **Incidents, Escalations, and Renewals**, what should "Defer" actually do? Two options:

- **A (recommended, minimal):** Log a `kind='defer'` note with the chosen date. The row stays on the active Hub list (no status flip) — because those tables don't currently have a "deferred" status. The note is the audit trail.
- **B (bigger lift):** Add a parallel `hub_deferrals` table that the Hub query joins against, so any source row with a future defer date drops from Active and surfaces in Awaiting/Deferred regardless of source.

A ships today. B is a follow-up. Which do you want?
