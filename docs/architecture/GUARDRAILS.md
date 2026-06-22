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

## 3. The Single-Rail Escalation Matrix

### 3.1 Architecture Rules

All high-severity anomalies, RED states, and manager-level interventions must converge on a singular, unified architectural pathway. Fragmented alert schemas, parallel notification tables, or local-only component states are strictly forbidden.

Flow Graph:
[Subsystem Flags RED] ---> Inserts to public.operational_escalations
---> Triggers Server-Side RPC (claim_operational_escalation)
---> Broadcasts globally via a single Postgres Realtime Feed

- Deduplication & Multi-Grounding: An asset (vehicle or facility room) is a single logical entity. If multiple concurrent RED errors are logged against the same target, the coordinator workspace deduplicates the active panel view to show only the latest active denial.
- Atomic Super-Resolution: When a Manager acts on an escalation, the single resolving transaction must flip the primary record to resolved_approved and automatically mark all stale, older pending denials for that specific asset target as resolved_superseded. This guarantees assets cannot immediately re-ground themselves on historic, unresolved cache parameters.
- The Claim Guarantee: Reusing the claim_operational_escalation RPC ensures atomic concurrency control. If two managers tap "Claim" at the same moment, the database locks the row cleanly; one wins, and the other's modal instantly vanishes globally without a race condition.

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
