## Diagnostic plan

### Goal
Stop guessing why Start of Day is still blocked by showing exactly which data row is causing the block, what linked escalation/workaround state exists, and which rule the UI applied.

### What I’ll add
1. **Test-only diagnostic panel on `/day`**
   - Visible only in the existing test/dev environment wrapper.
   - Shows:
     - current site day session id + phase
     - each RED issue for the session and cross-session guard
     - issue `status`, `workaround_plan`, `resolved_at`
     - linked escalation `status`, `resolution_notes`, `resolved_at`, `source_issue_id`
     - final computed result: `BLOCKING` or `CARRIED WITH WORKAROUND`

2. **Explain the blocker in plain text**
   - For each RED issue, display why it is blocking, e.g.:
     - `Issue status is open and no workaround_plan is stored`
     - `Linked escalation is resolved_approved but issue row was not updated`
     - `Issue is resolved`
     - `Workaround accepted`

3. **Add temporary console diagnostics**
   - Log one compact table when `/day` loads/refetches:
     - issue id
     - issue status
     - workaround present
     - linked escalation status
     - linked escalation notes present
     - computed blocking reason

4. **Use the diagnostic result to identify the real fix**
   - Based on the network data you pasted, the likely mismatch is:
     - the linked escalation is `resolved_approved` with notes
     - but the original issue row is still `status: open` and `workaround_plan: null`
   - The diagnostic will confirm whether the acceptance flow failed to copy the approved workaround back onto `site_issues_register`.

### Likely follow-up fix after diagnosis
If confirmed, update the RED blocking rule to treat a linked `resolved_approved` escalation with `resolution_notes` as an accepted workaround, and/or repair the acceptance path so it always updates the issue row to `workaround_accepted` with the agreed plan.

### Files likely involved
- `src/components/site-day/day-centre-page.tsx`
- `src/components/site-day/start-of-day-panel.tsx`
- optionally a small test-only diagnostic component under `src/components/dev/`

### Safety
- No published-production visibility: diagnostics are wrapped in the existing test-only tooling.
- No data rollback or issue mutation in the diagnostic step.
- No change to RED/YELLOW business rules until the diagnostic confirms the mismatch.