# Permanent Architectural Guardrails

> These rules are non-negotiable. Every build, every PR, and every AI-assisted change must comply. Violations are blockers.

---

## 1. Canonical Logged-In Derivation

**Rule:** The only valid derivation of "signed in" across the entire application is:

```ts
const isSignedIn = !!user || !!getActiveUserProfile();
```

where `user` is the Supabase Auth `User` object (often `null` for staff PIN logins) and `profile` is the active staff profile returned by `getActiveUserProfile()`.

**Reporter / Actor Identity:**

```ts
const reporterId = user?.id ?? profile?.staffId ?? "";
```

- `user?.id` is the fallback when a Supabase-authenticated session exists.
- `profile?.staffId` is the fallback for staff PIN-authenticated sessions.

**Scope:** This applies to **all** gated modules — Day Centre, Governance Hub, Manifest, Transport, Medication, Events, Finance, Admin, Sync, and any future modules. No module may implement its own variant (`!!user`, `!!profile` alone, `localStorage.getItem`, etc.).

**Enforcement:** Any branch that gates on `!user` instead of `!isSignedIn` is a bug. Any PR that introduces a second `isSignedIn` implementation must be rejected.

---

## 2. Reusable Components Only

**Rule:** Duplicate code for PIN dialogues, escalation flows, or any cross-cutting UI pattern is forbidden.

**Canonical Locations:**

| Pattern | Canonical Component | Path |
|---------|---------------------|------|
| PIN re-authentication | `PinReauthDialog` | `src/components/auth/pin-reauth-dialog.tsx` |
| Escalation lock / banner | `EscalationLockBanner`, `EscalationResolutionPanel` | `src/components/site-day/` |
| Global escalation intercept | `GlobalEscalationInterceptor` | `src/components/dashboard/global-escalation-interceptor.tsx` |
| Shared / global UI primitives | (future) | `src/components/shared/` |

**Requirement:** If a PIN dialogue or escalation flow is needed in a new module, import and reuse the existing global component. Do not copy-paste or rewrite a local version. New cross-cutting components that do not belong in an existing domain folder must live under `src/components/shared/`.

**Rationale:** UI Look-and-Feel Drift (inconsistent modals, mismatched validation, divergent PIN pads) undermines trust in a high-stakes operational system. A single source of truth for sensitive flows is mandatory.

---

## 3. Single-Rail Escalations

**Rule:** All high-severity anomalies (RED states and anything requiring Manager intervention) must pass through **one** unified pipeline.

**Pipeline:**

1. **Table:** `operational_escalations`
2. **Atomic Claim Rail:** `claimOperationalEscalation()` RPC (or equivalent atomic claim primitive)
3. **Realtime Feed:** Single Postgres realtime subscription — no parallel alert pipelines, no duplicate toast streams, no secondary tables shadowing the same anomaly.

**Prohibited:**
- Ad-hoc `toast()` chains that bypass the escalation table.
- Separate "alert" or "notification" tables that duplicate RED state.
- Client-side-only escalation state that is not backed by `operational_escalations`.

**Rationale:** The Single-Rail Escalation Convergence guarantee ensures that every critical anomaly has exactly one claimable record, one auditable resolution path, and one realtime stream. Parallel pipelines create race conditions, dropped alerts, and compliance gaps.

---

## Amendment Process

These guardrails may only be amended by explicit project-owner approval documented in this file (dated signature line). AI-assisted edits must reference this file and confirm compliance before implementation.
