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
| Textarea Input & Validation | `src/components/ui/character-counted-textarea.tsx`            | Enforces the 20-char rule, live X/Y tracker, blue progress line, and thick red required borders. |
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

- High-Visibility Outlines: Do not rely on small red asterisks (\*) alone to mark mandatory inputs. Any required input field, dropdown, or textarea that is empty or invalid must be outlined with a prominent, thick red border to give the operator an unmistakable visual indication of what is missing.

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

- Display Layer Timezones: All user-facing dates and timestamps must interpret using the client browser's local timezone context. Timestamps must be wrapped inside the SSR-safe <ClientTime iso="{...}"/> component or the useClientFormattedDate hook found in src/components/ui/client-time.tsx to completely safeguard against React hydration mismatches. Never render raw toISOString() strings directly to users.
- Storage Layer Timezones: All persistence vectors, database indices, and Supabase hooks strictly utilize UTC ISO string formats (new Date().toISOString()).

---

## 6. Upcoming Module Context (Future Horizons)

When architecting or laying data foundations for upcoming features, you must automatically inject all existing guardrails (Session derivation, 20-character limits, thick red borders, and automated NDIS ledger writing):

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
