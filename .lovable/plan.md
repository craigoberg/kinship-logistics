
## Goal
Make the mandated checks read as positive confirmations ("I've checked it AND it's OK / a Manager-approved workaround is in place"), and turn the Open Centre action into a single big, full-width button that lights up green only once every item is confirmed. Pure UI change — no schema, no API, no new business rules.

## Changes

### 1. `src/components/site-day/mandated-checks-list.tsx`
- Reword each row label to read as a confirmation. Display format per item:
  - Bold line: `Confirm: {itemLabel}`
  - Subline (muted, smaller): `Checked and OK, or a Manager-approved workaround is in place.`
- Larger tap target (more vertical padding) since this is now the primary affirmation surface.
- When ticked, give the row a subtle green tint (`bg-green-500/10 border-green-500/40`) so the user sees the page going green as they confirm.
- Keep checkbox + check-circle behavior; keep controlled `ticked` / `onTickedChange` contract unchanged.
- Section header reworded from "Mandated Compliance Checks" → "Confirm site is ready to open".

### 2. `src/components/site-day/start-of-day-panel.tsx`
- Replace the 2-button grid with a stacked layout:
  - **Big full-width primary button** "Declare Site Safe & Open Day Centre"
    - Same height/feel as today's `size="lg"` button but `w-full` and taller (e.g. `h-16 text-base`).
    - Disabled (muted/grey) until `allChecked && !hasBlocking`.
    - Turns solid green (`bg-green-600 hover:bg-green-700`) once enabled — reinforcing the "page goes all green" cue.
    - Same confirm dialog + `openMut` flow as today (no logic change).
  - **Secondary outline button below**, full-width, normal height: "Log Anomalies / Action Needed" (workarounds continue to be raised here — wording in the helper text reaffirms this).
- Remove the "One or more mandated checks remain unticked…" warning banner *only if* it duplicates the new affirmation copy; otherwise soften its wording to: "Tick each confirmation above. If any item is **not** OK, use Log Anomalies to raise a Yellow workaround or Red escalation."
- No changes to mutation, query, blocking-issue, or carried-issue logic.

## Out of scope
- No DB / `system_parameters` changes — item text in `mandated_compliance_checks` stays as-is; the "Confirm: …" prefix and confirmation subline are added in the UI layer.
- No changes to Log Anomalies, escalation, or ledger flows.
