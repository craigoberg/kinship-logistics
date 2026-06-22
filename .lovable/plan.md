## Problem

Buffy's "Propose Resolution" modal always shows **"Linked site session could not be found — refresh and retry."** even though the escalation row and the linked site_day_session exist.

## Root Cause

`src/components/dashboard/escalation-consultation-modal.tsx` (line 45) queries `from("site_issues")`, but everywhere else in the codebase the table is `site_issues_register`. The query throws, react-query catches it, and `sessionQ.data` resolves to `null` → `sessionMissing` becomes `true` → red banner + the GO/NO-GO buttons effectively cannot submit (the `!sessionId` guard inside `propose()` blocks it).

## Fix

Change the one query in `SiteDayProposalModal`'s `sessionQ` from `site_issues` to `site_issues_register`. No other logic needs to change — the column (`session_id`) and filter (`id = escalation.sourceIssueId`) are already correct.

```ts
// before
.from("site_issues").select("session_id").eq("id", escalation.sourceIssueId).single()
// after
.from("site_issues_register").select("session_id").eq("id", escalation.sourceIssueId).maybeSingle()
```

I'll also switch `.single()` → `.maybeSingle()` so a missing row surfaces as `null` (clean red banner) instead of a thrown error.

## Verification

After the edit: reopen the same escalation as Buffy → the "Locating site session…" line should appear briefly, then disappear with no red banner, and the Propose GO / NO-GO buttons should submit successfully.
