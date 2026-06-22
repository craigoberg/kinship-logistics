
## Goal

Refine the Start-of-Day open gate so that **only issues without an accepted workaround block** the Open Centre flow. Issues that already have an agreed workaround (RED accepted by a Manager, or YELLOW with the opener's own workaround) should be **clearly displayed alongside the open workflow** but must **not** block it.

## Rule (canonical)

An open issue is **blocking** when:
- `severity = "red"` AND `status ≠ "workaround_accepted"` (no Manager-agreed workaround, or Manager said NO), OR
- `severity = "yellow"` AND `workaroundPlan` is empty/null (opener never recorded a workaround)

An open issue is **non-blocking / acknowledged** when:
- `severity = "red"` AND `status = "workaround_accepted"` (Manager-agreed workaround in place), OR
- `severity = "yellow"` AND `workaroundPlan` is present (opener's recorded workaround)
- (GREEN notes are informational, never blocking.)

If any blocking issue exists → Open Centre is gated (current red blocking card behavior).
If only non-blocking issues exist → Open Centre proceeds normally, but the panel shows a yellow-toned **"Open issues carried with agreed workarounds"** card listing each one with its workaround text.

## Files

### `src/components/site-day/start-of-day-panel.tsx`

Replace the current `openRedIssues` / `hasOpenRed` derivation with:

```ts
const openIssues = issues.filter(i => i.status !== "resolved");

const blockingIssues = openIssues.filter(i =>
  (i.severity === "red"    && i.status !== "workaround_accepted") ||
  (i.severity === "yellow" && !(i.workaroundPlan?.trim()))
);

const carriedIssues = openIssues.filter(i =>
  (i.severity === "red"    && i.status === "workaround_accepted") ||
  (i.severity === "yellow" && !!i.workaroundPlan?.trim())
);

const hasBlocking = blockingIssues.length > 0;
```

Update the existing RED-block card so it:
- Renders when `hasBlocking` (not just RED).
- Title: "Cannot open the Day Centre — unresolved issue(s) without an agreed workaround".
- Body explains: RED items need a Manager-agreed workaround (Governance Hub); YELLOW items need a workaround recorded by the opener.
- Lists every `blockingIssues` row with a severity chip (RED red, YELLOW amber) using the same row layout already in the file.
- Keeps the "Open Governance Hub" CTA but only if at least one blocking item is RED (otherwise hide it — YELLOW can be self-resolved by the opener via Log Anomalies).

Add a new **non-blocking** "Open issues carried with agreed workarounds" card (amber border, not red) rendered whenever `carriedIssues.length > 0`, above the Open Centre button. Each row shows severity chip, description, `Workaround: …`, and the logged timestamp — same row markup as the blocking list, just amber-themed.

Gate the Open Centre button on `!hasBlocking && allChecked` (replace existing `hasOpenRed` references).

### No other files

- No schema, server-function, ledger, or query changes.
- `data-store.ts`, `site-issues.ts`, `escalation-resolution-panel.tsx` unchanged — the "workaround_accepted" status they already write is what we key off.
- `issues-register-card.tsx` already shows workaround text correctly; no change.

## Out of scope

- No change to the global escalated-lock banner (`EscalationLockBanner`) — a live RED escalation in `operational_escalations` still hard-locks the page until claimed/resolved, which is correct. The new rule only governs the **issue-register** gate inside Start of Day after the escalation has been parked with an accepted workaround.
- No change to Active Day / Close / Reopen logic.
