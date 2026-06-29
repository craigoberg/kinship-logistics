# GUARDRAILS Drift Report

> Saved 2026-06-29. Analysis-only — remediation deferred until frontend is synced with live Supabase.
> Authoritative spec remains `GUARDRAILS.md`.

## Document vs code: two RED models

| Section | Model |
|--------|--------|
| **§3** (Single-Rail Escalation) | Async verbal consultation → `VerbalAuthOverrideDialog` → ledger → `[VERBAL WORKAROUND]` ticket → local module unblocks immediately |
| **§8.1** (Two-Stage RED Handshake) | Alert → manager claims → manager proposes GO/NO-GO → operator accept/decline with PIN; session hard-locked |

**Codebase has migrated toward §3 for new RED events.** Legacy §8 / `operational_escalations` machinery remains for historical rows.

---

## §1 — Ledger (`operational_ledger`)

**Implementation:** `src/lib/api/ledger.ts` — `writeToLedger()`, `tryGetGps()`

**Consumers:** `site-issues.ts`, `client-attendance.ts`, `site-day-sessions.ts`, `compliance-assets.ts`, `centre-hours.ts`, `unexpected-med-bag.ts`, `unified-issues.ts`, `verbal-auth-override-dialog.tsx`, `escalation-resolution-panel.tsx`

**Drift:**
- `writeToLedger()` is best-effort and never throws — violates §1.1 abort-on-failure
- Verbal RED: ledger then register in separate steps — not atomic per §3
- No `CORRECTION` action_type usage in app code

---

## §1.2 — RYGE

**Implementation:** `log-anomaly-modal.tsx`, `site-issues.ts`, `issue-accumulator-panel.tsx`, `clearance.ts`, `client-attendance.ts`, `compliance-assets.ts`

**Drift:**
- Attendance RED (`client-attendance.ts`) — direct insert, no verbal flow
- Unexpected med-bag RED — does not block originating action

---

## §2 — Auth & session

**Correct:** `day-centre-page.tsx` — `isSignedIn = !!user || !!profile`, `reporterId = user?.id ?? profile?.staffId ?? ""`

**Drift:**
- Pattern not used project-wide
- `use-no-show-watch.ts` gates on `!!user` only (excludes PIN-only staff)
- Issue inserts use `supabase.auth.getUser()` for `reported_by` instead of `reporterId`

---

## §3 — Single-rail verbal (current RED path)

**Chain:** `log-anomaly-modal.tsx` → `VerbalAuthOverrideDialog` → ledger → parent writes register with `[VERBAL WORKAROUND]`

**Wiring:** `start-of-day-panel.tsx`, `active-day-panel.tsx`, `issue-accumulator-panel.tsx`, Hub via `unified-issues.ts`

**Aligned:** `GlobalEscalationInterceptor` unmounted; new RED does not call `raiseOperationalEscalation`

---

## §4 — UI primitives

| GUARDRAILS path | Actual |
|-----------------|--------|
| `issue-declaration-panel.tsx` | **Missing** |
| `use-mandated-checks.ts` | `hooks/use-system-parameters.ts` → `useMandatedChecks()` |
| `shared/active-issues-register.tsx` | `issue-engine/active-issues-register.tsx` |
| `auth/verbal-auth-override-dialog.tsx` | `issue-engine/verbal-auth-override-dialog.tsx` |

**Dead / unmounted:** `dynamic-operational-form.tsx`, `global-escalation-interceptor.tsx`, `site-leader-handshake-panel.tsx`, `site-manager-handshake-modal.tsx`, `WalkaroundChecklist` in `manifest.tsx`

---

## §5–§7 — Compliance, access

**Implementation:** `compliance-assets.ts`, `governance-hub-workspace.tsx`, SharePoint in resolve modals only

**Drift:** No `/manager` route (uses `/governance`, `/admin`); no wall-view dashboard

---

## §8 — Legacy handshake (historical data)

**Still mounted:** `EscalationResolutionPanel` when `escalated_lock` or live `operational_escalations`

**Inactive:** `GlobalEscalationInterceptor`, `EscalationConsultationModal`

**Hub:** `unified-issues.ts` still merges all three sources including operator-ack handshake logic

---

## §9 — Active Issues Register

**Mounted only in:** `issue-accumulator-panel.tsx` (manifest)

**Day Centre uses:** `IssuesRegisterCard` instead

**Drift:** Duplicate blocking not wired; §9.1 not met across modules

---

## RED drift matrix

| Area | §3 verbal | §8 legacy | Today |
|------|-----------|-----------|-------|
| New Day Centre RED | Verbal dialog + prefix | escalated_lock | Verbal only |
| New pre-trip RED | Same | RedHandshakeWaitingPanel | Verbal only |
| Legacy sessions | N/A | Full handshake UI | EscalationResolutionPanel if old row exists |
| Hub sources | site_issues + incidents | operational_escalations | All three merged |
| raiseOperationalEscalation | Must not insert | Old path | Only dead code |

---

## Priority summary

**High:** Dual RED models; best-effort ledger; non-atomic verbal writes; automated RED bypasses verbal; ActiveIssuesRegister not universal

**Medium:** Wrong primitive paths in doc; auth patterns incomplete; Hub legacy escalation logic; no /manager route

**Low:** Stale comments; dead code preserved on disk

---

## Remediation (deferred — do not execute until user approves post-Supabase sync)

1. Reconcile GUARDRAILS §8 vs §3 in the document
2. Legacy escalation policy for historical rows
3. Align `writeToLedger` semantics with spec or amend spec
4. Hub: verbal workaround badge parsing; reduce operational_escalations dependency
5. Unify Active Issues UI across modules
