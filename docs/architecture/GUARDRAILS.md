# MASTER_GUARDRAILS.md — Core System Architecture & Operational Specification

> Status: Permanent System Directive. Every code modification, database migration, and AI-assisted build must strictly comply with this document. Violations are immediate blocking defects.

---

## 1. Core Platform Philosophies & High-Trust Data Models

### 1.1 The Ledger Philosophy (public.operational_ledger)

The General Ledger is the single source of truth for all critical state changes.

- Append-Only Structure: Never update or delete a ledger row under any circumstances. Administrative corrections or reversals must be written as entirely new entries with action_type = 'CORRECTION', referencing the original row id inside the metadata JSONB blob.
- Compulsory Auditable Receipts: Every high-impact operational action (vehicle walkarounds, session handshakes, incident logging, escalation claims, medication events, or asset renewals) must generate an explicit ledger receipt. If the ledger write fails, the parent state mutation must abort entirely to prevent un-vouched operations.
- GPS Enforcement: Every operational state change must attempt to capture active GPS coordinates via the canonical writeToLedger() wrapper. Coordinates will record as null if the browser session explicitly denies permissions, but skipping the capture attempt is strictly prohibited.
- Evidence-Based Metadata: Every entry must carry structured JSONB payload context that can stand up independently to an NDIS audit trail.

### 1.2 The RYGE Trust Model (Red / Yellow / Green / Escalation)

The entire application surfaces operational health via a strict traffic-light visual language designed around clear operational thresholds:

| State Severity        | Operational Rule                                                                       | Core System Action                                                                                           |
| :-------------------- | :------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| GREEN (Clear)         | Standard operating parameter. Fleet, staff, and session routes are completely healthy. | Normal operational paths proceed unhindered. Silence indicates a well-running day.                           |
| YELLOW (Caution)      | Non-blocking anomaly, warning, or operational notice. Early warning indicator.         | Logged immediately to the General Ledger; demands visual monitoring but does not halt flow.                  |
| RED (Grounded / Lock) | Absolute safety fault, critical compliance breach, or structural failure.              | Absolute, non-dismissible hard block. Shuts down corresponding routes, manifests, and panels until resolved. |

- The Wheelchair Lift Exception: Certain mechanical vectors follow a managed Yellow Flag (Workaround) model. A reported lift issue defaults to a tracked YELLOW ledger warning that permits a documented manual workaround. If the workaround successfully completes the route, it remains yellow. If the workaround fails, it is promoted to a hard RED state, initiating the standard Escalation Loop.

### 1.3 Manager-Only Risk Acceptance

Only an authenticated profile with the explicit role of Manager or Coordinator can resolve a RED state.

- No staff-level or driver-level overrides exist within the system.
- Resolution requires structured justification notes, which are permanently receipted to the ledger.

---

## 2. Authentication & Session Guardrails

### 2.1 Canonical Logged-In Derivation

To prevent split-session synchronization errors—where a user appears authenticated in the application header but locked out by specific operational page components—a uniform session derivation is mandatory across all modules (Day Centre, Governance Hub, Manifest, Transport, Medication, Events, Finance, Admin):

[CODE REGULATION]
const isSignedIn = !!user || !!getActiveUserProfile();
[END CODE REGULATION]

- "user" represents the Supabase Auth User object, utilized predominantly for remote administrative sessions.
- "getActiveUserProfile()" represents the active local staff profile resolved via the on-site PIN infrastructure.
- Any conditional execution or layout routing that gates on !user instead of !isSignedIn is an immediate bug.

### 2.2 Actor Identity Mapping

When identifying which entity executed a state mutation or signed off on an anomaly, actors must resolve identity uniformly via:

[CODE REGULATION]
const reporterId = user?.id ?? profile?.staffId ?? "";
[END CODE REGULATION]

- Use profile.id or the staff profile's identifier as a fallback when a Supabase auth session is absent so the active opener is accurately attributed.

---

## 3. The Single-Rail Escalation Matrix (Asynchronous Verbal-Consultation Model)

### 3.1 Architecture Rules

All high-severity anomalies, RED states, and manager-level interventions converge on a single, asynchronous, single-user pipeline. There is no longer a synchronous multi-device handshake; field operations are protected from network dropouts by writing the consultation receipt locally and routing the open ticket through the unified Governance Hub feed.

Flow Graph:
[Subsystem Flags RED]
  --> Local operator opens `VerbalAuthOverrideDialog` (action_type = `RED_VERBAL_WORKAROUND`)
  --> Operator captures Authorising Manager, ≥20-char workaround plan, and their own PIN
  --> Atomic write to `public.operational_ledger` (immutable receipt, GPS captured)
  --> Open ticket inserted into the appropriate active-issues register
        - Day Centre  → `public.site_issues_register` (severity = `red`)
        - Manifest    → `public.operational_incidents` (severity = `sev1`)
      with `issue_description` prefixed `"[VERBAL WORKAROUND] …"` so the
      Governance Hub renders it as **Open — Operating via Verbal Workaround**
  --> Local module unblocks IMMEDIATELY; no realtime broadcast, no remote
      acknowledgment, no driver/manager handshake required

- Single Source of Truth: The ledger row is the audit artefact; the source register row is the operational tracker. Both are written in the same submit transaction. If the ledger write fails, the source row is never inserted.
- Database Safeguard: To flag verbal-workaround records for the Hub without triggering UUID-shape errors on the `owner` column, the sentinel is always carried inside `issue_description` (prefix `"[VERBAL WORKAROUND] "`), never in `owner`.
- Multi-Device Realtime Retired: The `RedHandshakeWaitingPanel`, `subscribeToEscalationPool` polling, and the `GlobalEscalationInterceptor` mount have all been removed from the active route tree. The legacy `operational_escalations` table remains in place for historic records and existing manager grounding logic (e.g. `getAssetGroundedStatus`); new RED anomalies do NOT write to it.
- Single-Rail Hub Routing: The Governance Hub (`UnifiedIssuesPanel`) reads from `site_issues_register` + `operational_incidents` + `compliance_assets` and presents every `[VERBAL WORKAROUND]` ticket alongside ordinary Yellow workarounds, with "Resolve" writing the closing ledger receipt.
- Preserved Fallbacks: `DynamicOperationalForm.tsx`, `RedHandshakeWaitingPanel` historical migrations, `GlobalEscalationInterceptor.tsx`, and the `operational_escalations` schema remain on disk as inactive fallbacks per the project's preservation policy. They MUST NOT be re-mounted without an explicit architectural review.



---

## 4. Reusable Core UI Components & Design System Tokens

To entirely eliminate Look-and-Feel drift and divergent input validation rules, all interfaces must import canonical UI primitives rather than reproducing isolated variants:

### 4.1 Global Primitive Mappings & Centralized Issue Engine

To maintain a single source of truth and eliminate look-and-feel drift, duplicate local form states or isolated textareas are strictly forbidden. All current and future modules must consume these exact global primitives:

| Pattern / Functional Layer  | Canonical Component / Hook Path                               | Operational Purpose                                                                              |
| :-------------------------- | :------------------------------------------------------------ | :----------------------------------------------------------------------------------------------- |
| PIN Re-Authentication       | `src/components/auth/pin-reauth-dialog.tsx`                   | Secure dual-PIN multi-session handshakes.                                                        |
| Multi-line required text    | `src/components/ui/character-counted-textarea.tsx`            | Enforces min-char rule, live X/Y tracker, progress bar, thick red required border (§4.3).        |
| Single-line required text   | `src/components/ui/character-counted-input.tsx`               | Evidence refs and short mandatory inputs — same §4.3 border/counter semantics as textarea.       |
| Required-field style tokens | `src/lib/ui/required-field.ts`                                | Shared `requiredFieldOutline`, `requiredFieldCounterClass`, `requiredFieldRemainingHint`.      |
| Centralized Issue Panel     | `src/components/issue-engine/issue-declaration-panel.tsx`     | Context-sensitive reentrant engine governing all RYGE checklist gates and refresh halts.         |
| Mandated Checks Lookup      | `src/hooks/use-mandated-checks.ts` (or data layer equivalent) | Dynamically sources checkpoints via registry scope ('site_day' vs 'pre_trip').                   |
| High-Trust Escape Hatch     | `src/components/auth/verbal-auth-override-dialog.tsx`         | Renders the auditable verbal authorization bypass for un-reachable manager states.               |
| Global Escalation Intercept | `src/components/dashboard/global-escalation-interceptor.tsx`  | Real-time broadcast coordinator pop-up handling atomic RPC claims.                               |

Every future module that requires checklists, visual inspections, or anomaly logging must import and leverage these specific files. Building custom, localized variations of these blocks is a structural violation.

### 4.2 Modal Footer Button Standard

Every tab or form panel inside a `Dialog` must display a footer at the bottom of the visible content area. The footer layout is:

| Scenario | Left button | Right button |
| :-- | :-- | :-- |
| Tab or form **with a save/submit action** | `Close` (variant `outline`) | `Save` / action label (primary, disabled until valid and dirty) |
| Tab or form **read-only** (no save action) | — | `Close` (variant `outline`) |

Rules:
- The **Close** button always calls `onOpenChange(false)` on the parent dialog. It must be labelled "Close", not "Cancel" or "Dismiss".
- The **Save** button must be disabled (`disabled={!canSubmit}`) until all required fields are populated **and** the form has unsaved changes (`dirty`). It must never be enabled for an unchanged form.
- The Save button must display a pending state (e.g. "Saving…") while the mutation is in-flight, and remain disabled during that period.
- `DialogFooter` from `src/components/ui/dialog.tsx` is the canonical wrapper — it handles responsive stacking on mobile automatically.
- Tabs that open child modals for their mutations (e.g. Attendance, Finance) are **read-only** from the parent tab's perspective and use the Close-only footer.
- The dialog's built-in top-right **X** remains present as a secondary close path, but the footer Close button is the primary affordance.

### 4.3 Required Field Visual Identifiers

Mandatory inputs must give operators an **immediate, consistent** signal of what is missing and when it is satisfied. Do **not** rely on small red asterisks alone, muted-grey helper text, or post-submit-only error styling.

**Canonical components (mandatory for new builds):**

- Multi-line notes / justifications → `CharacterCountedTextarea`
- Single-line evidence refs / short required text → `CharacterCountedInput`
- Custom controls (date pickers, selects) → apply helpers from `src/lib/ui/required-field.ts`

**Visual contract (all required fields):**

1. **Thick red outline** (`border-2 border-destructive`) on the control while it is empty or below the minimum. The outline **disappears** once the field is compliant.
2. **Live counter** beneath the control: `{current}/{min} minimum` (or `{current} / {min} min` for long-form). Counter is **red and bold** while invalid; **emerald green** when compliant.
3. **Remaining hint** (right-aligned, red): e.g. `4 more characters required.` — shown only while invalid.
4. **Progress bar** along the bottom edge of text inputs: blue while filling, emerald when minimum met.
5. **Save / submit buttons** remain `disabled` until every required field passes validation (see §4.2).

**Anti-patterns (do not ship):**

- White or muted-grey “N more chars required” without a red counter
- Inline uppercase “REQUIRED” badges instead of the standard counter + border
- Showing validation styling only after the first submit attempt (`attempted && !valid`)
- Hand-rolled `<Textarea>` + manual counter divs when a canonical component applies

**Minimum lengths (shared constants in `src/lib/governance/constants.ts`):**

| Constant            | Chars | Typical use                          |
| :------------------ | :---- | :----------------------------------- |
| `MIN_TIMELINE_NOTE` | 10    | Manage issue/asset timeline notes    |
| `MIN_EVIDENCE`      | 6     | Evidence reference on resolve/renew  |
| (default textarea)  | 20    | Justifications, anomaly descriptions |

### 4.4 Mobile Checklist Targets (Fat-Finger Proofing)

- Full-Width Rows: Standard, tiny native desktop checkboxes are strictly prohibited for operational checklists, safety gates, attendance logs, or roll-calls accessed via mobile devices or tablets.
- Toggle Target Cards: Checklist items must be rendered as full-width, touch-friendly rows or button-cards. Tapping anywhere within the text boundary or row target must instantly toggle the entire button green (Checked/Active). Tapping it again must return the row to a neutral grey state.

---

## 5. Compliance Governance & Integrations

### 5.1 Registry-Driven Compliance Architecture (public.compliance_assets)

Every expiring metric—including vehicle registration renewals, insurance policies, staff health certificates, and council workspace audits—lives dynamically inside a single dynamic table public.compliance_assets.

- Data-Only Category Extensions: Adding a new compliance category or altering an alert threshold is a database-only transaction. Modifying configuration bounds (yellow_days, red_days) or choosing a workflow modal key (vehicle_rego, staff_cert, etc.) automatically registers the new rule into the Governance Hub without requiring application redeployment.
- Automated Footprints: A database trigger (log_compliance_asset_change) hooks directly into this engine, generating comprehensive before and after JSON snapshots straight to the operational_ledger on every manual data mutation.

### 5.2 External Interfaces (SharePoint Sync)

- All critical corporate compliance records, vehicle servicing slips, and certification PDFs exist externally on Microsoft SharePoint.
- The application interacts with these structures natively using the Microsoft Graph API workspace connector. No local or temporary server disk storage may be used for audited asset documentation.

### 5.3 User Interface Time Conventions

**Canonical helpers:** `src/lib/utils.ts` — `formatDate`, `formatTime`, `formatDateTime`, `parseIsoDateLocal`, `toIsoDateString`, `todayLocalIso`, `REGIONAL_DATE_FORMAT`.  
**SSR-safe timestamps:** `src/components/ui/client-time.tsx` — `<ClientTime iso="…" />` / `useClientFormattedDate`.  
**Calendar inputs:** `src/components/ui/date-picker.tsx` — canonical `DatePicker` with `REGIONAL_DATE_FORMAT`.

#### Local timezone (mandatory)

- **Display:** All user-facing dates and times are interpreted in the **browser's local timezone** (operators work in Australia/Sydney context; the client clock is authoritative for “today”).
- **Calendar-date logic:** Guards and comparisons against stored calendar dates (`event_manifest.start_date`, “is today”, roster dates, etc.) must use **`todayLocalIso()`** or **`toIsoDateString(localDate)`** — never `new Date().toISOString().slice(0, 10)`, which is UTC and can be **one day behind** local time before midday UTC+10.
- **Instant timestamps:** Full ISO instants from Supabase (`created_at`, `checked_in_at`, …) are stored UTC. Render them through `<ClientTime />` or `formatDateTime()` so the user sees local wall-clock time.
- **Never** render raw `toISOString()` strings to operators.

#### Display formats (mandatory)

| Kind | Format | Example | Helper |
| :-- | :-- | :-- | :-- |
| **Date only** | `dd-Mmm-yy` | `06-Jul-26` | `formatDate()` · `DatePicker` · `REGIONAL_DATE_FORMAT` |
| **Time only** | 24-hour `hh:mm` | `08:43` | `formatTime()` |
| **Date + time** | `dd-Mmm-yy / hh:mm` | `06-Jul-26 / 08:43` | `formatDateTime()` · `<ClientTime />` (default) |

- Month abbreviations use three-letter English caps (`Jan` … `Dec`).
- Time is **24-hour**, zero-padded, **no seconds** unless a compliance audit explicitly requires them.
- Do **not** use native `<input type="date">` or `<input type="time">` in operator-facing forms — they render locale-dependent controls that conflict with this standard.

#### Storage layer (unchanged)

- **Instants:** UTC ISO strings (`new Date().toISOString()`) for `timestamptz` columns and ledger metadata.
- **Calendar dates:** Plain **`YYYY-MM-DD`** strings in the database (`event_manifest.start_date`, `end_date`, session dates, etc.). Only the **display layer** uses `dd-Mmm-yy`; parsing back from pickers uses `parseIsoDateLocal` / `toIsoDateString` without UTC day-shift.

---

## 6. Upcoming Module Context (Future Horizons)

When architecting or laying data foundations for upcoming features, you must automatically inject all existing guardrails (Session derivation, 20-character limits, thick red borders, and automated NDIS ledger writing):

> **Venue registry, out-of-centre outings, and multi-day tours** are specified in **§12** (effective 2026-07-04). New work on those modules must comply with §12 before shipping.

### 6.1 Continuous Improvement & Procedural Review Pipeline

- Every closed escalation or resolved issue will eventually pipe into a secondary, asynchronous 'Continuous Improvement' audit queue.
- This module will allow managers to conduct a delayed secondary sign-off to assess if procedural updates, policy modifications, or Permanent Corrective Actions are required.
- All actions taken in this pipeline must follow the 'Write-Before-Update' rule, generating automated operational ledger receipts.

---

## 7. Access Control & Authorization Model

### 7.1 Security Matrices

The platform strictly segregates operational views based on profile state verification:

- Manager Dashboard (/manager): Interactive, authenticated administrative space for escalation resolutions, ledger reviews, role mapping modifications, and roster changes. Access is restricted solely to the 'Manager' role.
- Wall-View Dashboard: Read-only, large-format display for common-area screens. Consumes the same data layer via read-only server functions with zero write-capable endpoints exposed.

---

## 8. Global Exception & Severity Handshake Protocols

To guarantee absolute operational alignment, every module (including Day Centre, Fleet Management, Transport, and Multi-Date Events) must strictly execute the RYGE exception lifecycle using a unified behavioral loop:

### 8.1 The Two-Stage RED Escalation Handshake

- Stage 1 (The Alert): When a staff member raises a RED severity issue, they must only provide a description of the problem. They must NEVER be prompted for a workaround plan or resolution at this stage. Submitting the alert places the local module session into a hard lock phase.
- Stage 2 (The Manager Proposal): A Manager claims the alert via the Global Escalation Interceptor. Following an offline conversation, the Manager uses their own dashboard to input the negotiated action plan, designates a status parameter (GO / NO-GO), and signs off with their PIN.
- Stage 3 (The Operator Handshake): The proposed plan is displayed on the original locked screen. The local operator must explicitly 'Accept' or 'Decline' the Manager's proposed plan, verifying the action with their own PIN.
- Rejection Safeguard: If the operator declines the manager's proposal, the system remains hard-locked under the original RED state, requiring a new consultation loop.

### 8.2 YELLOW Severity Workaround Life-Cycles

- Unlike RED states, logging a YELLOW anomaly requires the on-site operator to input a good-faith operational workaround plan immediately upon discovery.
- The module remains fully operational (unlocked) with a YELLOW flag active.
- The active issue card remains visible within both the active module dashboard and the Governance Hub, displaying an 'Open - Workaround in Place' status badge.
- The issue will only drop off the active operational dashboard on the subsequent calendar day IF it has been formally audited and marked resolved within the Governance Hub.

### 8.3 GREEN Severity Operational Notices

- GREEN alerts represent minor tracking updates that hold zero impact on active facility or vehicle operations.
- GREEN notifications do not require a workaround statement and never interrupt user navigation. They seamlessly dispatch a background notice directly to the Governance Hub queue for standard administrative scheduling.

  ***

  ## 9. State-Driven Contextual UI: Unified Exception Register

To prevent alert fatigue, duplicate data entry, and UI look-and-feel drift, all current and future operational modules must display live or inherited anomalies using a single, centralized rendering component[cite: 4].

### 9.1 The ActiveIssuesRegister Primitive (`src/components/shared/active-issues-register.tsx`)

Every module layout (including Day Centre Open, Manifest Checkout, Transport Run, and Multi-Day Event Boards) must embed this component at the top of its workspace view. It dynamically queries open records from the unified single-rail pipeline based on the module's target identifier, enforcing a standard three-tier visual lifecycle[cite: 1, 4]:

| UI Visual State             | Operational Meaning                                                                                                     | Core System Action / UX Treatment                                                                                                                                                  |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Active Amber / Red Card** | An open anomaly exists, but a valid worker or managerial workaround is currently protecting the shift[cite: 1].         | Displays the issue description and the approved workaround text prominently[cite: 1]. Keeps the primary module workflow unlocked so staff can proceed safely[cite: 1].             |
| **Satisfied Grey Card**     | A Coordinator or Manager has officially closed the issue within the Governance Hub during the active shift[cite: 1, 4]. | The card instantly sheds its background color, greys out text elements, and appends a green checkmark stamped with a permanent "Resolved: [Manager Review Receipt]" line[cite: 1]. |
| **Disappeared (Hidden)**    | The issue was successfully closed during a prior shift and the system executed a day rollover[cite: 1].                 | The row item completely drops off the operator's daily dashboard view to maintain a silent, clutter-free operating environment[cite: 1].                                           |

### 9.2 Cross-Module Workflow Scenarios

The component acts as an abstract, state-driven engine, applying identical data behaviors to completely variant on-the-floor operational problems:

- **Scenario A: Vehicle Fleet Anomalies (The Rejected Fuel Card)**
  - An on-site operator encounters a rejected fuel card at the pump and logs a YELLOW operational notice[cite: 1, 2].
  - The operator inputs their immediate workaround: "Paying out-of-pocket on personal card, submitting reimbursement claim."[cite: 1]
  - The vehicle remains fully unlocked and operational[cite: 1]. The issue logs straight to the Governance Hub[cite: 1]. The moment an administrative manager clears the account balance and marks the issue resolved in the Hub, the driver's active register card turns instantly **Grey**, showing the clearance note: "Card account cleared by office, safe to reuse."[cite: 1]

- **Scenario B: Event Manifest Cancellations (The Client Illness)**
  - A client calls in sick on Day 1 of a 4-day regional travel event. The coordinator logs a YELLOW exception against the trip manifest: "Passenger May absent due to illness for entire event window."[cite: 1]
  - The approved workaround reads: "Seating manifest locked at 11 passengers; adjusting catering headcounts."[cite: 1]
  - For the remaining 3 days of the tour, the driver's active manifest interface does not trigger a missing-passenger red alert. The active exception card sits at the top of their checkout screen, allowing the driver to confidently press "All Accounted For" even though the physical passenger count differs from the historic manifest total[cite: 1].

### 9.3 Anti-Redundancy Rules

- Operators starting a new daily workspace check or vehicle inspection must be shown all existing, unresolved exceptions carried over from prior shifts before they fill out their safety checklist[cite: 1].
- If a problem is already actively displayed in the `<ActiveIssuesRegister />` block with an active workaround, operators are strictly blocked from re-reporting or creating a duplicate ticket for the same asset fault[cite: 1, 4].

### Amendment Process

These guardrails may only be amended by explicit project-owner approval documented in this file via a dated signature line. AI-assisted edits must reference this file and confirm compliance before implementation.

---

## 10. Real-time Data Refresh Standard (BMS / Network Monitor Model)

> Status: Permanent Build Requirement — effective 2026-06-30. All current and future modules must comply.

The application must behave like a BMS (Building Management System) or Network Monitor: every coordinator save, booking edit, or participant profile change must be visible to the driver manifest, dashboard tiles, and all connected surfaces **immediately**, without a manual page refresh.

### 10.1 Two-Layer Refresh Architecture

Every data class that can be mutated by one user and observed by another must use **both** layers simultaneously:

| Layer | Mechanism | Purpose |
| :-- | :-- | :-- |
| **Realtime (primary)** | `useRealtimeInvalidate` hook — `postgres_changes` subscription on the Supabase table | Instant invalidation on INSERT / UPDATE / DELETE; sub-second update on all subscribed screens |
| **Polling (fallback)** | `refetchInterval` on the underlying `useQuery` | Recovers from dropped WebSocket connections; ensures data is never older than the configured floor even if the socket is lost |

Both layers are mandatory. Neither may be omitted. Using polling alone (the pre-2026-06-30 state for transport data) is a violation of this standard.

### 10.2 Polling Floor Requirements

| Data class | Mandatory `refetchInterval` ceiling | Realtime table(s) |
| :-- | :-- | :-- |
| Active driver trip + legs | 30 s | `transport_trips`, `trip_legs` |
| Day Centre attendance roll | 60 s | `client_attendance_log`, `site_issues_register` |
| Site issues / escalations | 30 s | `site_issues_register` |
| Governance unified issues | 30 s | `site_issues_register`, `operational_escalations`, `operational_incidents`, `hub_issue_notes` |
| Site session (RYGE state) | realtime-only acceptable; `refetchOnWindowFocus: true` as fallback | `site_day_sessions` |
| Event confirmed list (driver picker) | 60 s | `event_roster_bookings` |
| Compliance assets | 5 min | none — polling only is acceptable for low-velocity compliance data |

### 10.3 Canonical Subscription Primitive

All realtime subscriptions must use:

```typescript
// src/hooks/use-realtime-invalidate.ts
useRealtimeInvalidate({
  table: "table_name",          // public schema table
  filter: "col=eq.value",       // optional PostgREST filter
  queryKeys: [["key", "parts"]], // TanStack Query keys to invalidate
  enabled: boolean,              // optional — disable without unmounting
});
```

Building ad-hoc `supabase.channel().on("postgres_changes", ...).subscribe()` calls inside components is prohibited unless the subscription result must write directly to `setQueryData` (as in `subscribeToSiteSession`). In all other cases use `useRealtimeInvalidate`.

### 10.4 Centralised Invalidation Helpers

Two helpers in `src/lib/query/invalidation.ts` are the mandatory entry points for batch invalidation:

| Helper | Covers | When to call |
| :-- | :-- | :-- |
| `invalidateIssueCaches(qc, scope?)` | Day Centre / Governance Hub feeds — roll, session, unified issues, site-day prefix | Any mutation touching `site_issues_register`, `operational_incidents`, `site_day_sessions`, or attendance |
| `invalidateTransportCaches(qc)` | Driver manifest bundle, dashboard manifest summary tile, start/end-day anomaly feed, confirmed-events picker | Any mutation touching `participants`, `event_roster_bookings`, `event_manifest`, `trip_legs`, or `transport_trips` |

Never inline individual `invalidateQueries` calls for transport-adjacent keys without also calling `invalidateTransportCaches`. Doing so will leave the driver manifest stale.

### 10.5 Query Key Registry

The canonical TanStack Query key for each Supabase table is:

| Table | Canonical query key | Polling interval |
| :-- | :-- | :-- |
| `transport_trips` (active bundle) | `["transport_trips", "active", driverId]` | 30 s |
| `trip_legs` | included in active bundle above | — |
| `participants` | `["participants"]` | stale 5 min, focus-refetch |
| `event_manifest` | `["event_manifest"]` | stale 5 min |
| `event_roster_bookings` (by event) | `["event_roster_bookings", eventId]` | stale 30 s |
| `event_roster_bookings` (by participant) | `["event_roster_bookings", "by-participant", participantId]` | stale 30 s |
| `events` (confirmed picker) | `["events", "confirmed"]` | stale 60 s |
| `client_attendance_log` (roll) | `["client-attendance-roll", sessionId]` | 60 s |
| `site_issues_register` (active session) | `["site-issues", sessionId]` | 30 s |
| `site_day_sessions` (today) | `["site-day-session", "today"]` | realtime + focus |
| `asset_daily_clearance` | `["asset-clearance", assetId, date]` | stale 30 s |
| `compliance_assets` | `["compliance-assets", "active"]` | 5 min |

When adding a new `useQuery` that targets one of these tables, use the key listed above. Do not create a new, parallel key for the same data. Duplicate keys for the same underlying table break cross-component invalidation.

### 10.6 Mutation Compliance Rules

Every `useMutation` that writes to a table in §10.5 must, in its `onSuccess` callback:

1. Invalidate all **specific** keys for the row (e.g. `["event_roster_bookings", booking.eventId]`).
2. Call the appropriate centralised helper — `invalidateIssueCaches` and/or `invalidateTransportCaches` — so broader surfaces refresh without needing individual key tracking.

Omitting step 2 is a structural defect. Any new feature that adds a mutation without calling the helper will leave related modules stale and must be flagged in code review.

### 10.7 Constraint — No Realtime on RED Verbal Workaround Paths

Per §3 of this document, the verbal RED consultation flow must **not** use realtime broadcast for unblocking. The ledger write + register insert is the unblocking mechanism. `useRealtimeInvalidate` may still be mounted on `site_issues_register` (and is), but the local module unblocks synchronously on mutation success — it does not wait for the socket event to return. This is the only case where the realtime layer is present but not load-bearing for the primary UX path.

---

## 11. Driver Manifest & Transport Run Workflow (Locked UX — effective 2026-06-30)

> Status: Permanent Build Requirement. Applies to **Day Centre bus runs**, **single-day event trips**, and **multi-day event trips** wherever the driver uses `/manifest`. Future transport UI must extend this pattern — not replace it with alternate pre-start lists or reorder panels.

> **Coordinator-side outing workflows** (venue registry, event-floor rolls, bus boarding rolls, curfew, Trip Report) are specified in **§12** — not in this section. §11 covers the **driver** manifest only.

This section locks the end-to-end workflow for selecting a run, choosing a starting point, opening the manifest, and rearranging stops during the drive. The same `ActiveTripScreen`, `StartPointPicker`, and `reorderTripPickupLegs` pipeline is the canonical experience across run types.

### 11.1 Initialize Wizard (Steps 1–3)

Every new driver session follows the same three-step gate before the active manifest opens:

| Step | Screen | Purpose |
| :-- | :-- | :-- |
| **1 — Vehicle** | Fleet asset picker | Select cleared vehicle for today's shift |
| **2 — Clearance** | Daily operational clearance | Walkaround / checklist sign-off |
| **3 — Run start** | `EventPickAndStart` (`src/routes/manifest.tsx`) | Choose run type + starting point only — **not** stop management |

Step 3 must **not** display a passenger roster, pickup-order list, or scrollable stop preview. Stops are discovered and managed **inside** the active manifest after the run opens. Showing a pre-start stop list is a structural violation of this workflow.

### 11.2 Step 3 — Run Selection (Consistent Across Run Types)

#### Day Centre bus runs

| Today's runs | UI treatment |
| :-- | :-- |
| **0 runs** | Empty state with Admin pointer — no start button |
| **1 run** | Run name + direction shown as a single label; run auto-selected |
| **2+ runs** | One compact **Select** dropdown ("Which run?") — not a card list with passenger counts |

Passenger counts and stop sequences are **not** shown on Step 3.

#### One-off / multi-day event trips

| Control | UI treatment |
| :-- | :-- |
| **Event picker** | Single **Select** dropdown (today's events first) |
| **Multi-day events** | Same Step 3 UX as single-day — one event selection + starting point per trip start. Cross-day exception carry-over uses §9 `ActiveIssuesRegister`; it does **not** change Step 3 layout. |

Event roster order seeds the initial leg chain at trip creation (`startTrip` in `src/lib/data-store.ts`). The driver does **not** reorder stops before opening the manifest.

### 11.3 Step 3 — Starting Point (Shared Component)

All run types use the same touch-friendly `StartPointPicker` (`src/routes/manifest.tsx`):

| Option | Default when |
| :-- | :-- |
| **Depot** | Morning Day Centre pickup; default for event trips |
| **Day Centre** | Afternoon home run |
| **Other address (this trip only)** | Driver-entered alternate via dialog — e.g. bus parked off-site |

Rules:

- Addresses default from Admin → Lookups → Day Centre Bus Runs → **Transport site addresses** (`depot_address`, `day_centre_address` in `system_parameters`).
- The resolved street address is stored on `transport_trips.origin_address` at trip start.
- **Leg 1 display rule:** When the active pickup leg is the first segment from the trip anchor (`leg_kind = depot_to_client` with a passenger destination), the active leg card must show that stored starting address under the origin label.

Direction-aware defaults (morning → Depot, afternoon return → Day Centre) must not be bypassed without explicit driver selection.

### 11.4 Active Manifest — Single Unified Leg List

Once the run is open, **one scrollable leg sequence** replaces any separate "reorder pickups" panel. Implementation: `ActiveTripScreen` in `src/routes/manifest.tsx` + `PointerSortableList` in `src/components/manifest/manage-pickups-panel.tsx`.

Layout order (top → bottom):

1. **Completed legs** — green, locked, no drag handle
2. **Active leg card** — blue pinned card with Depart Stop / Arrive at Stop / arrival checklist
3. **Upcoming passenger pickups** — compact rows with **⋮⋮ drag handles** (touch-friendly, no external DnD library required)
4. **Terminal legs** — Day Centre, Depot, or event venue return legs; fixed at bottom, not reorderable

Anti-patterns (prohibited):

- A separate "Reorder pickups" panel above the active leg card
- Arrow-only ↑/↓ reorder controls on mobile operational screens
- Pre-start drag lists that duplicate in-manifest reorder

### 11.5 Stop Reorder Rules (Drivable Chain — Mandatory)

Reordering changes **stop sequence only**. It must **never** teleport the bus. Every leg's `from_label` / `to_label` pair must remain a physically drivable chain.

Canonical chain logic lives in `computePickupChainEndpoints` and `reorderTripPickupLegs` (`src/lib/data-store.ts`):

| Leg position | From (where the bus is) | To |
| :-- | :-- | :-- |
| First pending pickup (no completed pickups yet) | Trip origin label (Depot / Day Centre / alternate) | First client |
| Next pending pickup | Previous client's name/location | Next client |
| After last pickup | Last client | Terminal destination (Day Centre, Depot, or venue) |

**Lock rules during the run:**

| Leg state | Reorderable? |
| :-- | :-- |
| **Completed** pickup | No — locked forever; shown in completed section |
| **Active, pending** (before Depart Stop) | Yes — included in the unified sortable list; whoever is first becomes the active card |
| **Active, en_route / arrived** | No — current stop is in progress; other **pending** pickups may still reorder among themselves |
| **Terminal** (centre / depot / venue return) | No |

**UI requirement:** While dragging, from/to labels must update **live** using `computePickupChainEndpoints` against the current drag order — not stale DB labels from the leg's previous position. Example: at Depot, moving David ahead of Fred must immediately show **Depot → David**, then **David → Fred** — never Fred → David on stop 1.

**Persistence:** On drop, `reorderTripPickupLegs` rewrites pending pickup `leg_index`, chain labels, and terminal leg `from_label` anchors. Call `invalidateTransportCaches` on success (§10.4).

### 11.6 Pickup Cancellation (Shared Across Run Types)

Cancel is available on any non-completed **passenger pickup** leg (`canCancelPickupLeg` in `manage-pickups-panel.tsx`):

- **Active leg card** — cancel control top-right
- **Upcoming pickup rows** — cancel button on the row

Cancel flow (`cancelTripPickupLeg` in `src/lib/api/transport-pickup.ts`):

1. Complete the leg as skipped (`passengerPresent = false`)
2. Write a **YELLOW** ledger entry + open Hub issue when a site session exists
3. Dispatch manager SMS via internal route

The manifest advances to the next leg without breaking the chain rebuild for remaining pending pickups.

### 11.7 Cross-Run-Type Consistency Matrix

| Capability | Day Centre run | Event trip (single or multi-day) |
| :-- | :-- | :-- |
| Step 3 starting point picker | ✓ Same component | ✓ Same component |
| Pre-start stop / roster list | ✗ Prohibited | ✗ Prohibited |
| Active manifest leg list | ✓ Unified list | ✓ Same `ActiveTripScreen` |
| Drag reorder pending pickups | ✓ | ✓ (passenger pickup legs only) |
| Chain-aware label recompute | ✓ | ✓ |
| Pickup cancel → YELLOW + SMS | ✓ | ✓ |
| Realtime leg refresh | ✓ §10 | ✓ §10 |
| Terminal leg after pickups | Day Centre or Depot (direction-dependent) | Event venue → return origin |

Differences that are **allowed** (not UX drift):

- Day Centre Step 3 uses bus-run code + direction; Event Step 3 uses event picker.
- Leg chain terminal labels differ (Day Centre / Depot vs event venue name).
- Morning Day Centre runs may end with `trip_return = none` (bus stays at centre); event trips include a return leg.

Differences that are **violations**:

- Building a second reorder UI for events only
- Showing passenger lists on Step 3 for one run type but not another
- Reordering legs without recomputing the drivable from/to chain

### 11.8 Code Anchors (Implementation Reference)

| Concern | Canonical path |
| :-- | :-- |
| Initialize + Step 3 | `src/routes/manifest.tsx` — `EventPickAndStart`, `StartPointPicker` |
| Active trip UI | `src/routes/manifest.tsx` — `ActiveTripScreen`, `ActiveLegCard`, `LegRow` |
| Drag reorder + cancel dialog | `src/components/manifest/manage-pickups-panel.tsx` |
| Trip start (events) | `startTrip()` — `src/lib/data-store.ts` |
| Trip start (Day Centre) | `startDayCentreRun()` — `src/lib/data-store.ts` |
| Chain recompute + persist | `computePickupChainEndpoints`, `reorderTripPickupLegs` — `src/lib/data-store.ts` |
| Site address defaults | `src/components/admin/transport-site-addresses-panel.tsx` |

### Amendment Process (§11)

> **2026-06-30 — Project owner directive:** Step 3 run/start workflow and in-manifest drag reorder locked as specified in §11. Pre-start pickup lists removed. Drivable-chain label recompute mandatory on reorder. Consistent across Day Centre runs and event trips (including multi-day event contexts per §9 exception carry-over).

---

## 12. Venue Registry, Outing Trips & Multi-Day Accountability (Locked — effective 2026-07-04; amended same day — Day Centre parity)

> Status: Permanent Build Requirement. Applies to **out-of-centre single-day outings**, **multi-day tours**, and the **Venue Management** registry. Extends §11 (driver manifest) and Day Centre patterns (`client_attendance_log`, `site_day_sessions`) — **same cadence, temporary centre at the venue**. Does **not** replace Day Centre modules.

These trips are **not NDIS-funded**. Safety, auditability, and internal P&L reporting are the goals. Reuse the existing **Events** module (`event_manifest`, `event_roster_bookings`, `event_financial_ledger`, Finance tab) for revenue and expenses. Do **not** build a parallel finance subsystem.

### 12.1 Design Principles

> **2026-07-04 (amendment) — Project owner directive:** Outings follow **Day Centre parity**. Transport to/from the venue is a **separate activity** from the **event floor** at the venue. The cinema, hotel, or park is a **temporary centre**. **Hard open** when the trip leader opens the location; **hard close** when departure handover is complete. No soft open/close unless a legal requirement applies.

| Principle | Rule |
| :-- | :-- |
| **Centre parity** | Single-day and multi-day outings use the **same separation** as Day Centre: **transport** (bus runs, manifests) vs **site** (leader open, arrival roll, program, departure handover, close). Events are **not** a different operational model. |
| **Two accountability layers** | **Transport layer:** `event_bus_manifest` + §11 driver manifest — who is on **this bus for this leg**. **Event-floor layer:** `event_attendance_log` (planned; mirrors `client_attendance_log`) — who has **arrived at / departed from** the temporary centre. **Neither layer substitutes for the other.** |
| **Hard open = event starts** | Trip leader **opens the location** (Manager PIN + on-the-day venue checks, parallel to Day Centre open). **RED blocks open** — buses may be turned around; self-transport contacted. Kinship transport may start **hours before** open; that does **not** start the event. |
| **Hard close = handover done** | Trip leader **closes the location** after **departure handover** — every participant on assigned return transport (bus / self). Leader **does not** wait for the last home drop-off. |
| **Transport home** | Return legs completed and reconciled via §11 manifest (parallel to Day Centre going-home logging). **`event_manifest` → Closed** is not blocked on the last drop-off completing. |
| **Venue safety (planning) ≠ live roll** | Registry baseline sign-off (§12.2) is **planning/compliance**. Live rolls are §12.4 event-floor + bus boarding + curfew/morning (multi-day). |
| **One hop = one trip** | Each venue leg (Hotel → Park → Cinema → Hotel) is exactly **one** `transport_trip` with its own manifest lifecycle per §11. |
| **Check on at bus boarding** | Before every hop **depart**, every expected bus traveller is checked **onto the bus** — transport accountability for that leg only. |
| **Group hop arrival** | When the **whole group** travels together on one bus, **no per-person event-floor check-in at the hop destination** — group presence is implied unless an incident was logged en route. |
| **Self-transport** | Permitted **only** on **first day inbound** and **last day outbound** (roster + API). Self arrivals are checked in on the **event-floor roll** as they arrive at the venue. |
| **Trip leader on duty** | A **Manager** (or Coordinator with manager-equivalent PIN per §7) must be assigned to **`event_day_sessions`** for each calendar day before Confirm. UI label: **Trip leader** (not “Day Centre manager”). |
| **Ledger on every mutation** | Event-floor check-in/out, bus boarding, curfew/morning account, location open/close, venue baseline sign-off — all receipt to `operational_ledger` via `writeToLedger()` / `writeToLedgerOrThrow()` per §1.1. |
| **Finance reuse** | Ticket revenue, booking payments, and vendor expenses stay on the existing Event Finance tab; Trip Report aggregates them (§12.8). |

### 12.2 Venue Registry & Variable Safety Templates

#### 12.2.1 Managed venues

All recurring destinations (clubs, hotels, cinemas, parks, museums) live in a **Venue Management** registry — not as free-text-only `venue_name` on events.

| Field class | Examples |
| :-- | :-- |
| Identity | Name, venue type, status (`active` / `archived`) |
| Location | Street address, GPS pin, access notes |
| Operations | Site contact, max safe group size, risk tier |
| Safety | Linked template + baseline sign-off record |

Events must reference venues via FK (`primary_venue_id`, `event_venue_stops.venue_id`). Legacy `venue_name` text may remain as a display fallback during migration only.

#### 12.2.2 Variable template model (competency-style fields)

Venue safety uses a **field-definition** model — not a fixed pass/fail checklist only:

| Concept | Behaviour |
| :-- | :-- |
| **`venue_template_fields`** | Prompt (e.g. “Wheelchair ramps?”), `answer_type` (`yes_no`, `text`, `number`, `select`), optional `options_json`, `is_mandatory`, `sort_order` |
| **System mandatory core** | Shipped defaults (access ramps, accessible toilet, emergency exits, evacuation point, max group size, site contact briefed). Org may add custom fields. |
| **Baseline sign-off** | Manager PIN + evidence reference (§4.3 `CharacterCountedInput`) + ledger receipt. Answers stored per venue in `venue_safety_answers`. |
| **Per-event reconfirmation** | Lightweight “still valid for this trip?” before event status → `Confirmed`. Required when baseline age exceeds configured threshold. |
| **Clone template** | Copying from Venue A → new Venue B copies **field structure only** — **never** copies answered values. New venue requires fresh baseline sign-off. |

Anti-patterns:

- One-off free-text venue safety notes with no template linkage
- Cloning a hotel and inheriting another hotel’s answered checklist
- Using **event-floor check-in** as a substitute for **bus boarding** check (or vice versa)
- Treating “bus left depot” as **event open**
- Requiring the trip leader to **wait for last home drop-off** before close

#### 12.2.3 Canonical UI (when built)

| Surface | Purpose |
| :-- | :-- |
| Admin → **Venues** tab | CRUD, template edit, baseline sign-off, clone-from-venue |
| Event planning | Pick stops from venue pool; block **Confirmed** until reconfirmations satisfied |

### 12.3 Trip Planning — Reuse Existing Events Module

#### 12.3.1 Event kinds and trip-day scope

Extend `event_manifest` (do not fork):

| `event_kind` | Scope | How it is set |
| :-- | :-- | :-- |
| `single_day_outing` | One calendar day; ordered venue hops | **Derived:** outing `event_type` (excursion / tour / trip) and `start_date` = `end_date` |
| `multi_day_tour` | `start_date` … `end_date`; base hotel + daily hops | **Derived:** same outing types when `end_date` > `start_date` |
| `legacy` | Existing centre-linked events unchanged until migrated | Non-outing event types only |

**Rules (locked 2026-07-06):**

- Operators do **not** pick “Standard event vs outing” separately from dates. **Start date** and **end date** (optional — mirrors start when blank) define the calendar span; **event type** (e.g. Single Day Excursion) determines whether §12 outing modules apply.
- **`event_day_sessions`** rows are **auto-seeded** from `start_date`…`end_date` on save and before Confirm — no manual “Seed trip days” step.
- **`event_venue_stops`** are **auto-seeded** from **Primary venue** (one stop per calendar day with no itinerary yet) on save and before **Open** — managers may add/reorder extra hops on the **Itinerary** tab.
- **Confirm** still requires a **trip leader** (`manager_staff_id`) on every calendar day in range — assign on the **Trip days** tab.

#### 12.3.2 Roster — `event_roster_bookings` (reuse)

| Field / behaviour | Rule |
| :-- | :-- |
| Participant booking | Existing flow — revenue, medical snapshot, payments |
| **`brings_carer` / `carer_id` / `carer_transport_required`** | **Mandatory support** — carers on trips when rostered; carer appears on bus manifest when transport required |
| **Outbound transport** | `bus` \| `self` — self only on **first day inbound** |
| **Return transport** | `bus` \| `self` — self only on **last day outbound** |
| Mid-trip legs | **Bus only** — API must reject self-transport on intermediate hops |

#### 12.3.3 Itinerary — ordered hops

**`event_venue_stops`** defines the day’s sequence (e.g. Hotel → Park → Museum → Movies → Hotel). Each adjacent pair becomes **one transport trip** at runtime (§12.4).

#### 12.3.4 Trip leader assignment

**`event_day_sessions.manager_staff_id`** (UI: **Trip leader**) is required before `event_manifest.status` → **Confirmed**. **Open location** and **close location** require **Manager PIN** (`PinReauthDialog` + `isManagerProfile()`). This is the accountable leader for the **event floor** that day — they may or may not be a bus driver.

Getting participants to the venue may involve Kinship buses, multiple buses, or external/self transport — that is **transport planning**, not a substitute for trip leader assignment.

### 12.4 Event Day Session, Event Floor & Transport Accountability

#### 12.4.0 Centre parity model (authoritative)

Outings mirror Day Centre with the venue as a **temporary centre**:

| Layer | Day Centre | Outing equivalent |
| :-- | :-- | :-- |
| **Transport in** | Bus runs → centre | Bus runs / self → venue (may start before event open) |
| **Site open** | Manager opens centre | Trip leader **opens location** (hard) |
| **Arrival roll** | `client_attendance_log` — tap as each person arrives | `event_attendance_log` — tap as each person arrives (bus unload or self) |
| **During program** | Floor accountability | Trip leader at venue |
| **Overnight** | N/A at centre | **Curfew + morning** at base hotel (multi-day) — §12.5 |
| **Daily bus hops** | N/A | Check **onto bus** at boarding; group arrival at next stop (no per-person floor check-in) |
| **Departure handover** | Checkout — who is on which transport | Same — assigned return bus / self |
| **Site close** | Manager closes centre | Trip leader **closes location** (hard) |
| **Transport home** | Driver manifest | §11 return manifest — leader not blocked on last drop-off |

There is **no soft open/close** for the event floor unless a legal requirement mandates it.

#### 12.4.1 Location lifecycle — `event_day_sessions`

**`event_day_sessions`** — one row per event per **calendar day** (UI: **Trip day**, not “Day Centre session”):

| Phase | Meaning |
| :-- | :-- |
| `planning` | Roster, itinerary, trip leader assigned; location not yet open |
| `active` | Trip leader **opened location** — event floor live; arrival roll active |
| `in_transit` | *(Optional UI phase)* Group between floor sessions on a bus hop — transport layer active |
| `at_base` | Multi-day: group at base hotel between daily activities |
| `closed_orderly` | Trip leader **closed location** after departure handover; manager PIN + ledger |
| `closed_incident` | Closed with open RED — Trip Report flags incident |

**Open location (hard):**

1. On-the-day venue checks (access, toilets, lifts, exits — may reference §12.2 baseline).
2. **RED** from failed checks or open blocking issues → **cannot open**; coordinate transport turnaround / self-transport contact.
3. Manager PIN → phase `active` → ledger receipt `EVENT_LOCATION_OPENED`.

**Close location (hard):**

1. **Departure handover** complete — every rostered participant on assigned return transport (bus A / bus B / self).
2. Manager PIN → phase `closed_orderly` or `closed_incident` → ledger receipt `EVENT_LOCATION_CLOSED`.
3. Leader **may leave** — return transport reconciliation continues via §11 (does not block step 2).

Coordinators run **event-floor** and **bus boarding** rolls. Trip leader owns **open/close** and escalation clearance.

#### 12.4.2 Event-floor roll — `event_attendance_log` (planned)

Mirrors **`client_attendance_log`** (`src/lib/api/client-attendance.ts`, `attendance-roll-panel.tsx`):

| Column / concept | Purpose |
| :-- | :-- |
| `event_day_session_id` | Which trip day |
| `participant_id` / `carer_id` | Who is expected on the event floor |
| `arrival_method` | `bus` \| `private` \| `walk_in` \| `other` — from roster + operator tap |
| `status` | `expected` \| `checked_in` \| `checked_out` \| `absent` |
| `checked_in_at` / `checked_in_by` | Tap when person **arrives at the venue** — async; buses and cars at different times |
| `checked_out_at` | Tap at **departure handover** when assigned to return transport |
| Escalation fields | Optional YELLOW→RED for overdue arrival (same semantics as centre) |

**Rules:**

1. Seed from `event_roster_bookings` when trip leader opens location (or on first open).
2. **Check-in as they arrive** — multiple buses and self-transport at different times.
3. **Departure handover** at close — checkout each participant to return transport option.
4. Self-transport inbound: checked in on **event floor only** (not on bus manifest for that leg).

#### 12.4.3 Bus boarding roll — `event_bus_manifest`

Transport accountability only — keyed by `event_day_session_id` + `transport_trip_id`:

| Column | Purpose |
| :-- | :-- |
| `participant_id` / `carer_id` | Who is expected on **this bus for this leg** |
| `status` | `expected` \| `on_bus` \| `not_travelling` |
| `checked_on_at` / `checked_on_by` | Tap when **boarding** — §4.4 fat-finger cards |

**Rules:**

1. **Every venue hop = one new `transport_trip`** (`trip_kind` e.g. `event_venue_hop`). Driver uses §11 manifest for that hop only.
2. Trip leader or coordinator completes **bus boarding roll before driver Depart Stop**.
3. **Depart gate:** all expected → `on_bus`; no active RED lock on trip day; optional manager PIN on depart.
4. **Group hop:** when the whole group boards and arrives together, **no event-floor re-check-in at destination** (§12.1) — unless incident en route.
5. Bus manifest does **not** replace event-floor check-in at the **primary venue** when people arrive asynchronously.

#### 12.4.3a Outbound vs. return runs — two separate manifests

For single-day outings and every day of a multi-day tour, **transport is always two separate §11 manifests**:

| Run | `trip_return` | Leg chain | When created |
| :-- | :-- | :-- | :-- |
| **Outbound** | `none` | Depot → pickups → Venue. Bus **stays at venue**. | Coordinator / driver at run-start (select *Outbound*) |
| **Return** | `depot` | Venue → drop-offs → Depot. | Coordinator creates **after** departure handover starts |

**Rules:**

1. **Outbound manifest ends at the venue** — the driver completes the last leg (`client_to_venue`) and the bus parks/waits. No `venue_to_depot` leg is generated.
2. The bus may remain at the venue, park nearby, or reposition to another address — the coordinator updates the driver's status note if repositioning.
3. **Return manifest** is a new trip started from the "One-off Event" tab with *Return home* selected. Only participants with `return_transport_mode = 'bus'` are included in the leg chain.
4. A legacy event (not inferred as an outing) still gets the full loop (outbound + return) in a single manifest — existing behaviour is preserved.

#### 12.4.4 Single-day flow (reference — e.g. Movies)

```
Planning: roster, itinerary, trip leader assigned → Confirm event

Transport IN — outbound manifest (trip_return = none):
  → Driver: One-off Event tab → select event → direction = Outbound → start run
  → Manifest: Depot → pax1 → … → Venue   (bus stays at venue — no return leg)
  → Self-transport passengers travel direct to venue

Trip leader at venue:
  → On-the-day venue checks → RED blocks open
  → OPEN location (hard) — event starts
  → Event-floor roll: check in each person as they arrive (bus or car)

During program:
  → Trip leader accountable; LogAnomalyModal available

End of program:
  → Departure handover: each person → return bus / self
  → CLOSE location (hard) — trip leader done

Transport HOME — return manifest (separate trip, trip_return = depot):
  → Coordinator/driver: One-off Event tab → select event → direction = Return home → start run
  → Manifest: Venue → pax1 → … → Depot   (bus passengers only, per return_transport_mode)
  → Reconcile manifest / checkout (parallel to Day Centre going home)
  → Close event when trip days + finance guards satisfied
```

#### 12.4.5 Multi-day flow (reference)

| Moment | Roll / action |
| :-- | :-- |
| **Day 1 — arrive at first stop** | Transport in (bus/self) → trip leader **opens location** → **event-floor check-in** (handover from transport) |
| **Staying at venue until curfew** | No constant re-check-in — **curfew roll** (bedtime) + **morning roll** (breakfast) at base only — §12.5 |
| **Daily bus hops** | **Boarding roll** when getting on bus → drive → group arrival at next location (no per-person floor check-in at destination) |
| **Return to hotel** | Boarding roll → if no incident en route, group back at base |
| **Between days** | Repeat open/hops/curfew/morning pattern |
| **Last day** | Morning roll (if applicable) → program → departure handover → **close location** → return transport home → **close event** |

Mid-trip **self-drive is prohibited** except first inbound and last outbound (§12.3.2).

#### 12.4.6 `event_manifest.status` vs location open/close

| Concept | Table / field | Meaning |
| :-- | :-- | :-- |
| **Planning / Confirm / Open / Closed** | `event_manifest.status` | **Office lifecycle** — roster ready, trip authorised, finance lock at end |
| **Open / close location** | `event_day_sessions.phase` | **Operational floor** — trip leader has opened/closed the temporary centre that day |

`event_manifest.status` → **Open** authorises transport and coordinator workflows; **the event floor starts** only when trip leader **opens location** (`active`). Do not conflate the two.

### 12.5 Curfew & Morning Rolls — YELLOW → RED → SMS

Multi-day **curfew** and **morning** accountability mirror **`client_attendance_log`** escalation semantics (`src/lib/api/client-attendance.ts`):

| Mechanism | Rule |
| :-- | :-- |
| **Expected time** | From event config (`curfew_time`, `morning_roll_time`) |
| **YELLOW** | Approaching / soft overdue — logged; visible on event day dashboard |
| **RED** | Hard overdue — same issue row promoted (never duplicated) |
| **SMS at RED** | Dispatch via internal route (parallel to `attendance-sms` / `departure-sms` patterns) |
| **Thresholds** | `system_parameters`: e.g. `event_curfew_yellow_mins_before`, `event_curfew_red_mins_after`, `event_curfew_red_sms_recipients` |
| **Background sweep** | Same 60 s sweep pattern as Day Centre arrival — promotes rows and fires SMS once |

Curfew breach is **RED + SMS**, not a silent log entry.

Tables (when migrated): `event_curfew_log`, `event_morning_log` — columns analogous to `escalation_severity`, `escalation_issue_id`, `red_sms_dispatched_at` on `client_attendance_log`.

### 12.6 Issues, RED & ActiveIssuesRegister

- **`LogAnomalyModal`** / verbal RED path (§3) must be available on every event day coordinator screen.
- Issue context metadata must include: `event_id`, `event_day_session_id`, `transport_trip_id` (optional), `venue_id` (optional).
- **`ActiveIssuesRegister`** (§9) embeds on event day workspace — same Amber / Grey / Hidden lifecycle.
- RED lock may block **Open location**, **Depart Stop**, and **Close location** until manager resolution or documented verbal workaround.

### 12.7 Manage Actions — Resolve vs Log Note (Compliance Parity)

Outing **compliance renewals** use the same two-button pattern as Governance Manage dialogs:

| Action | Effect |
| :-- | :-- |
| **Log Note** | Timeline append or defer; evidence optional |
| **Resolve** | Note + next expiry + evidence + **archive** asset; cannot run while defer selected |
| **Cancel** | Close form with no writes (outline button — not “Close asset”) |

This § applies to `compliance_assets` tied to trip infrastructure where relevant; outing operational rolls use §12.4–§12.5 actions instead.

### 12.8 Trip Report & Finance (Reuse Event Booking)

#### 12.8.1 Finance — no duplicate ledger

| Existing asset | Trip use |
| :-- | :-- |
| `event_roster_bookings` | Attendee revenue, carer flags, transport modes |
| `event_financial_ledger` + Finance tab | Vendor expenses (venue hire, tickets, meals, transport) |
| `recordEventPaymentMilestone` | Payment tracking |

NDIS claim generation is **out of scope** for these trips. Internal P&L only.

#### 12.8.2 Trip Report (aggregate read model)

When an event moves to **`Closed`**, generate a **Trip Report** view (export/PDF later) aggregating:

1. **Summary** — title, dates, manager on duty, headcount (participants + carers)
2. **P&L** — revenue, expenses, net (from Finance tab queries)
3. **Itinerary** — completed hops + venue names from registry
4. **Attendance** — event-floor check-in/out, transport modes, bus boarding, no-shows
5. **Issues & incidents** — `site_issues_register` / hub notes filtered by event context
6. **Curfew / morning breaches** — multi-day only
7. **Venue safety** — baseline + reconfirmation refs

Trip Report is a **read model** — it must not introduce a second place to enter expenses or payments.

### 12.9 Realtime & Invalidation (extends §10)

When event-day tables ship, add to §10.5 registry:

| Table | Canonical query key | Polling floor |
| :-- | :-- | :-- |
| `event_day_sessions` | `["event-day-session", eventId, date]` | 30 s + realtime |
| `event_attendance_log` | `["event-attendance-log", sessionId]` | 30 s |
| `event_bus_manifest` | `["event-bus-manifest", tripId]` | 30 s |
| `event_curfew_log` | `["event-curfew-log", sessionId]` | 60 s |
| `event_morning_log` | `["event-morning-log", sessionId]` | 60 s |
| `venues` | `["venues", "active"]` | 5 min |

Mutations must call **`invalidateTransportCaches`** when touching `transport_trips` / `trip_legs`, and a future **`invalidateEventDayCaches`** helper for session + bus manifest keys — same pattern as §10.4.

### 12.10 Cross-Module Consistency Matrix

| Capability | Day Centre | Outing trip (§12) |
| :-- | :-- | :-- |
| Site open/close (hard) | `site_day_sessions` | `event_day_sessions` — **open/close location** |
| Arrival / departure roll | `client_attendance_log` | `event_attendance_log` @ venue |
| Bus boarding roll | *(on bus run)* | `event_bus_manifest` @ boarding |
| Driver transport | `startDayCentreRun` | One `startTrip` **per hop** |
| Manifest UX | §11 | §11 (same screen) |
| Overdue sweep + SMS | Arrival at centre | Event-floor arrival (planned) + curfew/morning at hotel |
| Issues register | §9 | §9 (event context) |
| Finance | N/A | Event Finance tab |
| Venue safety checklist | N/A | §12.2 (planning) + on-the-day open checks |
| Going home | Driver manifest + checkout | §11 return manifest + event-floor checkout — **leader close not blocked** |

**Violations:**

- Using event-floor check-in **instead of** bus boarding check (or vice versa)
- Treating transport departure as **event open**
- Requiring trip leader to wait for **last home drop-off** before close
- One multi-stop `transport_trip` spanning Hotel → Park → Museum (must be separate trips)
- Self-transport on intermediate hops
- Trip without assigned trip leader on duty
- Expense entry on Trip Report instead of `event_financial_ledger`
- Per-person event-floor check-in at **every hop destination** when group arrived together on one bus

### 12.11 Implementation Phases (Authoritative Sequence)

Build order is fixed — do not skip venue registry before outing runtime:

1. **Phase 0** — Schema + this §12 signed off  
2. **Phase 1** — Venue Management tab (templates, baseline, clone)  
3. **Phase 2** — Event planning extensions (hops, roster transport modes, trip leader)  
4. **Phase 3** — Event day session + bus boarding roll  
5. **Phase 4** — Trip Report v1 + event status lifecycle (Confirm/Open/Close)  
6. **Phase 5** — Issues context on event day + depart gate  
7. **Phase 6** — Multi-day curfew/morning rolls + SMS  
8. **Phase 7** — Venue ↔ compliance link + Trip Report print (optional)  
9. **Phase 8** — **Centre parity:** `event_attendance_log` + open/close location flows (mirror `client_attendance_log` / `site_day_sessions`)  
10. **Phase 9** — Departure handover + transport-home reconciliation (decouple leader close from last drop-off)  
11. **Phase 10** — Coordinator workspace UX (Trip day tab, rename labels, open-location gate)

Phases 0–7: **shipped or in progress** (2026-07-04). Phases 8–10 implement the **2026-07-04 §12 amendment** (Day Centre parity).

First production slice for **Movies-style single-day**: Phases 1–3 + **Phase 8 minimum** (event-floor roll + open/close location).

### 12.12 Code Anchors (Implementation Reference)

| Concern | Canonical path (existing) | Planned / extend |
| :-- | :-- | :-- |
| Events & roster | `src/routes/events.tsx`, `src/lib/data-store.ts` | Extend, do not fork |
| Event Finance | `src/components/events/event-finance-tab.tsx` | Trip Report consumes |
| Driver manifest | §11 — `src/routes/manifest.tsx` | One invocation per hop |
| Day Centre arrival roll | `src/components/site-day/attendance-roll-panel.tsx` | **Template for `event_attendance_log` UI (Phase 8)** |
| Day Centre open/close | `src/lib/api/site-day-sessions.ts`, `start-of-day-panel.tsx` | **Template for open/close location (Phase 8)** |
| Bus boarding roll | `src/components/events/bus-check-on-panel.tsx` | Transport layer only — do not treat as event-floor roll |
| Attendance sweep + SMS | `src/lib/api/client-attendance.ts` | Template for event-floor + curfew sweep |
| Event day ops | `src/lib/api/event-day-ops.ts` | Split: bus manifest vs attendance log |
| Venue admin | `src/routes/admin.tsx` → Venues tab | Built |
| Event coordinator | `src/components/events/day-sessions-tab.tsx` | Rename Trip day; add open/close + arrival roll |

### Amendment Process (§12)

> **2026-07-04 — Project owner directive (initial):** Venue registry with variable safety templates (clone structure, not answers). Each venue hop = one `transport_trip`. Carers on roster. Trip leader required per calendar day. Curfew/morning breach = YELLOW → RED + SMS (Day Centre pattern). Finance and Trip Report reuse existing Event Booking module. Self-transport only first inbound and last outbound legs.

> **2026-07-04 — Project owner directive (amendment — Day Centre parity):** Outings use the **same cadence as Day Centre** — transport is separate from the **event floor** at the venue (temporary centre). **Hard open** when trip leader opens location (RED blocks); **hard close** after departure handover — leader does **not** wait for last home drop-off. **Two rolls:** `event_attendance_log` (arrive/depart at venue, async) and `event_bus_manifest` (boarding per leg) — neither substitutes for the other. Group bus hops: boarding check only; no per-person floor check-in at destination when group moves together. Multi-day: check into event at first stop; curfew/morning at hotel; repeat daily until last-day hard close. No soft open/close unless legally required.
