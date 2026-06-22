## What we're seeing

Screenshot shows the inline red strip:
> "Escalation must be claimed before proposing a resolution."

That string is only produced by the `!escalation.claimedBy` guard in `SiteDayProposalModal.propose()`. So at submit time, the `escalation` object held by the modal has `claimedBy = null` even though the user is the manager who claimed it (Buffy).

## Root cause

In `src/components/dashboard/global-escalation-interceptor.tsx` → `handleClaim()`:

```ts
const result = await claimOperationalEscalation(target.id, staffId);
...
setConsultTarget(result.escalation ?? target);
```

`target` came from the **claimable** queue, where every row has `status="pending"` and `claimedBy=null`. When `result.escalation` is `undefined` (RPC payload shape mismatch — `payload.escalation ?? payload.row` is null), we fall back to `target`, so `consultTarget.claimedBy` stays `null`. The user can then sit on the modal for minutes; nothing ever populates `claimedBy`, and the propose guard fires.

The rehydrate path (`listMyClaimedAwaitingProposal`) does set `claimedBy` correctly, which is why the *previous* attempt eventually worked — it was opened from rehydrate, not from a fresh claim.

## Fix

Two small, surgical changes — no schema, no RPC, no behaviour change beyond closing the gap.

### 1. `global-escalation-interceptor.tsx` — guarantee `claimedBy` on consultTarget

Replace the fallback assignment with a merge that always stamps the current claimer onto the row we hand to the modal:

```ts
const claimed = result.escalation ?? target;
setConsultTarget({
  ...claimed,
  claimedBy: claimed.claimedBy ?? staffId,
  claimedAt: claimed.claimedAt ?? new Date().toISOString(),
  status: "claimed",
});
```

Also add a one-line `console.debug("[handleClaim] consultTarget set", { id, claimedBy, fromRpc: !!result.escalation })` so future regressions are visible.

### 2. `escalation-consultation-modal.tsx` → `SiteDayProposalModal.propose()` — defensive refetch

If `escalation.claimedBy` is still missing when the user clicks Propose, do one re-read of the row from `operational_escalations` before refusing:

```ts
if (!escalation.claimedBy) {
  const { data } = await supabase
    .from("operational_escalations")
    .select("claimed_by")
    .eq("id", escalation.id)
    .maybeSingle();
  const claimedBy = (data?.claimed_by as string | null) ?? null;
  if (!claimedBy) { /* keep existing error */ return; }
  // use claimedBy locally for the rest of this submit
}
```

Then use the locally-resolved `claimedBy` for both `submitManagerHandshake({ managerStaffId })` and the ledger write. This makes the modal self-healing for any other path that hands it a stale row.

## Out of scope

- The RPC return shape itself — we work around it client-side. If we later confirm the RPC returns the row under an unexpected key, we can normalise in `claimOperationalEscalation`, but that's a follow-up.
- Tracing left in place from the previous fix stays as-is.

## Verification

1. New escalation → Buffy claims → console shows `[handleClaim] consultTarget set` with `claimedBy = <Buffy's id>`.
2. Type plan + PIN → click Propose GO → handshake succeeds, no "must be claimed" strip.
3. Leave modal idle 10 min, then submit → still succeeds (state retained from the fix).
4. As a safety net: temporarily simulate `result.escalation = undefined` → defensive refetch still resolves `claimedBy` from the DB row.
