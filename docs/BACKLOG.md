# Kinship Logistics — Product & Engineering Backlog

**Persistent backlog** — survives chat sessions. Stored in-repo so humans and agents can recall it on request.

## How to use

| You say | Agent should |
|--------|----------------|
| *"What's on the backlog?"* | Read this file and summarise open items by section |
| *"Add … to the backlog"* | Append or extend the relevant section; set status **discuss** unless spec is clear |
| *"Mark … done"* | Move item to **Done** with date, or strike through with completion note |
| *"Prioritise …"* | Update **Priority** column / ordering in that section |

**Status key:** `discuss` · `ready` · `blocked` · `deferred` · `done`

**Do not confuse with:** `docs/architecture/GUARDRAIL-DRIFT-REPORT.md` (technical drift audit) or GUARDRAILS § directives (locked build rules).

---

## Policy & design — needs discussion

Items that need a product/ops decision **before** implementation.

| ID | Topic | Question / notes | Status |
|----|--------|------------------|--------|
| BL-001 | **Trip expense vendors** | **Done 2026-07-11.** Simple `vendors` registry (Admin → Vendors). Log expense uses type-ahead picker; unknown names prompt to add to list. Vendor name stored on ledger row for MYOB alignment — no in-app AP tracking. SQL: `docs/sql/2026-07-11_vendors_registry.sql`. | **done** |
| BL-002 | **Security RBAC mode** | **Deferred until last** — do not block other backlog on this. **Target two-tier session (locked 2026-07-12):** (1) **Day session** — email + password (Supabase Auth) at start of day; long timeout Admin-configurable (`system_parameters`, e.g. `auth_day_session_hours`). (2) **Screen lock** — idle timeout (e.g. 15 min, `auth_idle_lock_minutes`); same staff unlocks with PIN via `PinReauthDialog`; resume same route/state; **exempt active manifest run**. (3) **Action step-up** — existing `PinEntryDialog` / `verifyCoordinatorPin` for high-impact sign-offs (unchanged). **Scope:** menu/`role_menu_access` enforcement, trip leader vs manager capabilities, Hub/Admin gates, tighten RLS around `auth.uid()` + `staff_registry.auth_user_id`. **Build constraints until BL-002:** GUARDRAILS §2.4 + `.cursor/rules/rbac-forward-compat.mdc` — no auth-only gates, no authenticated-only RLS on operational tables, no duplicate identity stores, no irreversible menu hacks. **Existing hooks:** `staff_registry.auth_user_id`, `menu-access-matrix.tsx`, `PinReauthDialog`, `AUTH_PROTECTED_TABLES`, `is_manager` RPC. | **deferred** |
| BL-003 | **Event-day RED verbal auth** | **Done 2026-07-11 (revised).** Shared `EventDayVerbalAnomalyFlow` wires `LogAnomalyModal` → `VerbalConsultationDialog` (manager by name, operator PIN only) → `[VERBAL WORKAROUND]` issue on trip days and Manage Event **Log Issue**. Manager confirms in Hub later. | **done** |

---

## Infrastructure & platform

Cross-cutting setup — not feature-complete until provider accounts, credentials, and ops runbooks exist.

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-050 | **SMS provider setup** | GUARDRAILS reference internal routes (`/api/internal/attendance-sms`, `transport-pickup-sms`, `departure-sms`, event curfew RED). Code has mock/stub paths today. Needs: provider choice (Twilio/etc.), env secrets, recipient lists in `system_parameters`, production routing. Ops runbook for who receives what. **Prerequisite:** BL-063 done — see `docs/architecture/SMS-MOCK-AUDIT.md`. | **discuss** |
| BL-063 | **SMS mock popup hook audit** | **Done 2026-07-20.** Checklist: `docs/architecture/SMS-MOCK-AUDIT.md`. Wired gap: pickup cancel → `emitMockSms` (`transport-pickup.ts`). Hardened event roll RED non-OK path. Covered: Day Centre arrival/departure RED, event morning/evening RED, walkaround Sev1 via `triggerInspectionAlert`. N/A: unsafe drop (Hub only), dead `dynamic-operational-form`. | **done** |
| BL-051 | **SharePoint integration setup** | GUARDRAILS §5.2 — compliance PDFs, vehicle servicing slips, certification docs live on SharePoint. App references links in compliance UI but no live sync/API. Needs: tenant/site mapping, auth (app registration / service principal), which document types sync to `compliance_assets`, failure handling, and whether read-only links vs automated ingest. **Also required for BL-065** onboarding signed-form archive (per-person folder, audit retrieval). | **discuss** |
| BL-074 | **Secrets management** | Controlled remote access to operational secrets that must **not** live in plain checklist text or shared docs (e.g. centre alarm codes, vendor/portal logins, insurance policy numbers for accidents, emergency/after-hours contact numbers, key-safe codes). **Intent:** PIN- or role-gated vault (or Admin-managed secret store) readable in the field when needed; audit who viewed what; no secrets in itinerary/Open Centre copy. **Discuss:** vault vs encrypted `system_parameters` vs SharePoint-restricted list; what belongs here vs BL-002 day-session auth; retention; offline/field access; which roles can view vs edit. **Defer detailing until multi-day basics settle** — capture so it is not forgotten. | **discuss** |
| BL-082 | **Offline / weak-signal field mode** | **Manifest mid-run Alpha done 2026-07-26** (web outbox, not native app). IndexedDB snapshot + ordered outbox (`src/lib/manifest-offline/`): Depart/Arrive (+ GPS), leg confirm, hop boarding while offline; auto-flush on reconnect; banner on `/manifest`; **Close Run blocked** until queue empty. Start/walkaround/Close/PIN/cancel-pickup/RED stay **online** → **BL-102**. Maps deep-link unchanged. **DEV:** Simulate offline switch on DEV bar (`src/lib/simulated-offline.ts`, `IS_TEST_BUILD` only). Remaining field offline → **BL-101 / BL-102 / BL-103**. Capacitor/TestFlight shell if Safari storage proves weak (discuss). Runbook: `docs/architecture/MANIFEST-OFFLINE.md`. | **done** (Manifest Alpha) |
| BL-101 | **Offline — Event Deliver / Trips floor** | Extend BL-082 outbox pattern to trip-day floor: Check-In / arrival, Programme (venues, meals, meds), morning/evening rolls, hop release gates, Check-Out. Reuse IndexedDB outbox + optimistic snapshot; PIN/Close day stay online until separately scoped. **Discuss:** which writes queue vs must-live; conflict if two tablets. | **discuss** |
| BL-102 | **Offline — Manifest walkaround / Start Run** | Pre-active Manifest: vehicle clearance ticks, walkaround PIN, Start Run / Start hop while weak signal. Needs prefetched asset/roster/hop cards before leaving coverage. Complements BL-082 mid-run (already shipped). | **discuss** |
| BL-103 | **Offline — Day Centre arrival / Check-In** | Day Centre floor Check-In (and likely Activities meal/med taps) when centre Wi‑Fi dies. Same outbox family as BL-082/101. **Discuss:** Open/Close Centre online-only vs queued; visitor add offline. | **discuss** |
| BL-099 | **Environments: DEV → TEST → PROD promotion** | **Alpha host live 2026-07-29** — `crm-test.yada.org.au` + TEST Supabase; SSL via Vercel. Promote: `docs/sql/` per lane + merge `main`→`test`. Runbook: `docs/architecture/ENV-LANES.md`. **Next week:** smoke core ops (not new features). PROD = 2nd project later (no data wipe). Schema drift patches as found. Lovable abandoned. RBAC=BL-002 last. | **ready** (TEST live; Alpha smoke) |
| BL-100 | **Day Centre Check-In / Activities / Check-Out shell** | **Built 2026-07-26.** Active Day tabs mirror Event Deliver IA (site_day_* kept). Activities = meals + med round (`site_day_activities`). SQL: `docs/sql/2026-07-26_site_day_activities.sql`. Pairs BL-073/076/077. | **done** |

**RBAC:** **BL-002** (deferred until last). All interim builds must follow GUARDRAILS §2.4 and `.cursor/rules/rbac-forward-compat.mdc`.

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-052 | **Mobile / field UX programme** | **Implemented 2026-07-07.** `MobileFieldButton` + `MobileOptionButton` on manifest active leg. Sticky confirm CTA in footer (leaves scroll area free). `BottomSheet` component — no-show countdown, not-travelling, all dialogs slide up from bottom. Hop expand headers min-h-14. Checkout popover h-11 options. Event modal full-screen on phones + min-h-11 tabs. Safe-area footer padding on `/manifest`. Day Centre attendance roll min-h-[56px] rows already done. Remaining (future): verbal auth BottomSheet, driver-mode nav split (tied to BL-002 RBAC). | **done** |
| BL-053 | **Shared PinPad + project-wide PIN migration** | **Implemented 2026-07-07.** `PinPad`, `PinEntryDialog`, `PinEntryTrigger`, `pin-verify.ts`; GUARDRAILS §2.3. All auth PIN surfaces migrated off OS keyboard. | **done** |

---

## Driver manifest — context-sensitive leg card

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-040 | **Return-run leg card** (drop-off mode) | **Implemented 2026-07-06.** `ReturnBoardingRoll` gates first-leg departure — driver taps every passenger "On Bus" by name; all must be confirmed before "Depart Stop" activates. State persisted in localStorage per trip, ledger write on confirm. `ArrivedChecklist` context-aware: replace "Passenger Present & Boarded" with "Passenger safely at drop-off"; toggle-off = unsafe drop dialog (no countdown); hide medication panel + "Log Unexpected Med Bag" on all return legs. `startTrip` already sets `medication_expected = false` on all return-run legs. Signal: `trip.tripReturn !== "none"` (Day Centre afternoon + event return). | **done** |
| BL-054 | **Close Run PIN** (manifest reconciliation) | **Implemented 2026-07-07.** `CloseRunCard` replaces odometer-only finalize: run summary, cancelled-pickup ack, open-RED gate, operator PIN (`PinEntryDialog`), ledger `TRANSPORT_RUN_CLOSED`, then `completeTrip`. API: `src/lib/api/transport-run-close.ts`. | **done** |
| BL-055 | **Touch-friendly km / odometer entry** | **Implemented 2026-07-07.** `NumericEntryPad` + `NumericEntryDialog` + `NumericEntryTrigger` (sibling to PinPad, not an extension). Manifest: starting odometer, logged leg km (0.5 km ▲/▼), ending odometer. Admin surfaces deferred — reuse same components later. | **done** |
| BL-056 | **Manifest navigation map — Phase 0 + 0.5** | **Implemented 2026-07-07.** `ManifestRouteMap` placeholder + Google Maps deep link (`manifest-route.ts`). Shown when `leg.status === en_route` (after Depart Stop); upcoming stops hidden during navigation; compact leg header; footer hint. Same UX for Day Centre runs + event outings. Live embed + coordinator optimisation → **BL-015** phases 1–2. | **done** |
| BL-096 | **Manifest odometer suggest + Fleet current KM** | **Done 2026-07-23.** Per-vehicle start prefill (`current_odometer_km`); legs stay distance; Close Run suggests start+Σ logged; soft-warn thresholds `manifest.odo_*` (no Hub issue); Fleet column + Correct odometer + ledger `TRANSPORT_ODOMETER_CORRECTED`. SQL: `docs/sql/2026-07-23_manifest_odometer_suggest.sql`. | **done** |

---

## Outing trips & events (GUARDRAILS §12)

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-068 | **Event Deliver — mobile-first trip execution** | **Spec locked 2026-07-13 in GUARDRAILS §12.13.** Three-phase model: office Setup (**Event Manage** `/events`) → field Deliver (`/event-deliver`) → office Report (Trip Report V1 tab). **SIM smoke A/B/C done 2026-07-21** (see BL-064). Harden gaps BL-090 / BL-091 / BL-070 **done**. Deep audit pack **BL-087 done** (inside BL-061). **Live-clock field sign-off parked 2026-07-23** (bench SIM OK). Multi-bus → **BL-069**. | **done** (SIM) |
| BL-010 | Movies / single-day outing **end-to-end test** | **Done 2026-07-12.** Field-tested full loop including **return home** manifest and event close. Outbound manifest (pickup reorder) → venue drop-off → close run → event floor (arrival roll, close location) → return manifest → close event. Fixes during test: `transport_trips` anon RLS, `PointerSortableList` setState-in-render, return-after-close recovery path. Order locked in §12.4.4. | **done** |
| BL-011 | **Trip leader warning** when location already open | **Done 2026-07-12.** Stale collapsed-row warning not reproduced in field test. Added multi-day convenience: saving a trip leader on one day propagates to all still-unassigned days (`propagateTripLeaderToUnassignedDays`); per-day overrides unchanged. | **done** |
| BL-059 | **Multi-day evening/morning roll calls** | **Done 2026-07-12.** Renamed Curfew → Evening roll call (UI). `HalfHourTimeField` — 24h clock, half-hour picker + exact HH:mm input. Admin → System Parameters defaults (`default_evening_roll_call_time`, `default_morning_roll_call_time`); seeded on trip day creation; save propagates to unset days. SQL: `docs/sql/2026-07-12_tour_roll_call_defaults.sql`. | **done** |
| BL-064 | **Trip day roll calls — behaviour doc + field test** | **Doc done 2026-07-21.** **SIM smoke A/B/C done 2026-07-21.** **Live-clock field parked 2026-07-23** — treat as SIM OK for bench testing. | **done** (SIM) |
| BL-012 | **Multi-day tour** flows | **SIM multi-day pass 2026-07-23** (incl. Left-trip carry Day N→N+1 + return Manifest floor filter). **Live-clock field parked 2026-07-23** — SIM OK until something breaks. | **done** (SIM) |
| BL-060 | **UI style guide audit** | **Living doc:** `docs/architecture/UI-STYLE-GUIDE.md` + `.cursor/rules/ui-style-guide.mdc`. **Phase 1 — Hub (done 2026-07-12):** `HubListCard`, `ManageItemShell` footer, `operationToasts`, RYGE chips. **Phase 2 — Manifest (done 2026-07-12):** `FieldActionButton`, `MobileFieldButton` pickers, walkaround chips, `AlertDialog` log-out. **Phase 3 — Day Centre (done 2026-07-13):** `FieldActionButton` CTAs, `MobileOptionButton` absence reasons, `BottomSheet` check-out, `RYGE_SEVERITY_CHIPS` unified, `isSignedIn` / `isActiveUserManager()` RBAC, dismiss-unblock all 3 Hub dialogs, dev diagnostic toggle. **Phase 4 — Events (done 2026-07-13):** trip leader + close outcome → `MobileFieldButton` tap list; bus boarding → `MobileFieldButton`; departure handover → `BottomSheet`; accountability roll 56px; RYGE chips unified; Cancel → Close across all event modals; dashed empty states. **Phase 5 — Admin (done 2026-07-21):** office Select + Switch; inline panel Save; sheet Close+Save; Venues `Table` aligned to Vendors; native colour; Admin `type=number`; baseline Yes/No → `MobileOptionButton`; Cancel only on destructive `AlertDialog`; counted justifications; Menu Access matrix left for BL-002. | **done** |
| BL-070 | **Pre-open venue safety walkthrough for Event Deliver** | **Done 2026-07-23.** Open location dialog uses `MandatedChecksList` + `event_deliver.venue_open_checks` (string array; seed empty = high-trust until Admin fills). PIN gated until all ticked. Completed labels → `EVENT_LOCATION_OPENED` ledger metadata `venue_open_checks`. **Admin edit:** `MandatedChecksAdminPanel` (Venue Safety template–style; not JSON). SQL: `docs/sql/2026-07-23_event_deliver_venue_open_checks.sql`. **Pack inclusion → BL-094 done 2026-07-26.** | **done** |
| BL-071 | **Event & Attendance SMS alerts (Leader / coordinator)** | When participants are late or absent at events, automatically notify the trip leader by SMS. Scope: (1) **Late arrival alert** — triggered when `expected_arrival_by` gate passes with expected participants still unaccounted for (builds on `event_day_sessions.expected_arrival_by` added 2026-07-14); (2) **Absence confirmation SMS** — notify when a participant is marked absent in the Event Deliver Check-In roll; (3) **Configurable thresholds** — `event_arrival_window_minutes` in system_parameters; escalation delay before alert fires. Infrastructure: builds on existing `attendance-sms.ts` / `departure-sms.ts` internal route pattern + `emitMockSms` hook (BL-063). **Prerequisite:** BL-050 SMS provider live. **Decisions needed:** recipient list (trip leader only vs. coordinator CC), opt-out / number management, message templates, which roles receive alerts, server-side scheduling vs. client-triggered route call. | **discuss** |
| BL-072 | **Accommodation gate for overnight event days** | **Built 2026-07-18 (BL-T3).** **SIM smoke covered 2026-07-21** (hotel end-of-day itinerary in multi-day path). | **done** (SIM) |
| BL-085 | **Roll call deferral + late-return / bus-delay gate** | **Built 2026-07-18.** **SIM smoke 2026-07-21:** defer-all anytime on roll header; Yellow→Red + SMS once. Optional later: separate en-route bus muster ≠ hotel roll. | **done** (SIM) |
| BL-086 | **Event Deliver Reset Start of Day (test)** | **Built 2026-07-18.** **SIM smoke 2026-07-21** (used in C path). | **done** (SIM) |
| BL-088 | **Multi-day lifecycle sequencing gates** | **Built 2026-07-18.** **SIM smoke 2026-07-21** (Day N+1 blocked while Day N open; Close day after evening). | **done** (SIM) |
| BL-089 | **Event Manage ↔ Event Deliver surface split** | **Built 2026-07-19.** **SIM smoke 2026-07-21** (Run this event → Deliver; Open PIN immediate). | **done** (SIM) |
| BL-090 | **Trip-day Absent → Yellow (safety disposition) + Check-Out** | **Done 2026-07-21.** Shared `TripAbsentDispositionDialog` (disposition + safety plan ≥20 + Yellow/Red + leader PIN). Morning/evening `markAbsent` opens Hub `[LEFT TRIP]`, syncs floor to `absent`, excludes open activity/bus expected rows. Check-In Not Attending uses same dialog. Absent stays on lists as read-only placeholder with reason. Check-Out **Left trip** section (no assign) + Reinstate (PIN + reason → `checked_in`). Group Status: “roll complete” (not “all accounted”) when any Absent. **2026-07-23:** prior-day Left trip carried onto Day N+1 overnight continuity (`carryPriorDayLeftTripAbsences`) so they do not reappear on Morning Roll / HOME. | **done** |
| BL-091 | **Programme — read-only completed activity** | **Done 2026-07-21.** Completed stops stay tappable (chevron + “tap to review”). Expand shows read-only summary: opened/closed times, movement method, bus hop note or activity check-in roster, trip-day issues logged while the activity was open (±5 min after close). Touch: `activity-loop-tab.tsx` `CompletedActivityDetail`. | **done** |
| BL-069 | **Multi-bus event runs (IN + HOME)** | **Done 2026-07-23.** Admin `bus_runs` → event labels R1/R2/Rx. Office plans outbound/return run on roster; floor override at Check-In/Check-Out; Manifest one Transport IN/HOME card per run. SQL: `docs/sql/2026-07-23_event_multi_bus_runs.sql`. Legacy null run code = single shared bus. **SIM smoke pass 2026-07-26** (roster badges + IN/HOME per Rx). | **done** |
| BL-013 | **Arrival method vs planned outbound** | **Done 2026-07-26.** Planned ≠ actual arrival/return. **UX locked + SIM smoke 2026-07-26:** floor **embedded method chip + wide-row confirm** (Day Centre + Event Deliver in/out; Event Manage unchanged). Style guide: *Floor row embedded method override*. SQL: `docs/sql/2026-07-26_day_centre_arrival_bus_run.sql`. | **done** |
| BL-097 | **Day Centre floor visitors (non-registered)** | **Done 2026-07-26 (SIM smoke).** Day Centre only: non-registered floor visitors (`site_day_visitors`); Close Centre blocks while present. Event floor add forbidden — see **BL-098**. SQL: `docs/sql/2026-07-26_site_day_visitors.sql`. | **done** |
| BL-098 | **Event planned guest / bring-a-friend** | **Done 2026-07-26 (SIM smoke).** Guests = real `participants` (`participant_kind=guest`) + `event_roster_bookings` (`is_guest_booking`). Event Manage Roster **Add guest**; reuse/archive lifecycle; non-NDIS `Private` funding; host link; Confirm amber / Open location hard-block. DOB uses `getDobDatePickerProps()`. **Close event** silently archives that trip’s guests (skips if still on Open/Confirmed). Day Centre visitor **Add to event…** → pick event → Add guest prefilled. SQL: `docs/sql/2026-07-26_event_guest_participants.sql`. | **done** |
| BL-014 | **Pickup when meds not required on trip** | **Implemented 2026-07-07.** Outings: per-booking `transport_med_bag_required` (yes/no/not_set) + `transport_med_notes` on roster; driver manifest prompts only when `yes`; Day Centre unchanged (schedule-based). Confirm blocked until bus passengers assessed. SQL: `docs/sql/2026-07-07_event_roster_transport_med_bag.sql`. | **done** |
| BL-015 | **Google Maps route optimisation** | **Phase 1 (deferred):** Maps JavaScript API + DirectionsRenderer live embed in `ManifestRouteMap` — needs API key, billing, geocoding for leg-level addresses. **Phase 2 (deferred):** Coordinator drive-time ordering, traffic-aware ETAs on roster/manifest. Until then: drag-sort roster (`pickup_order`), in-manifest reorder, Phase 0 placeholder + deep link (**BL-056** done). SQL: `docs/sql/2026-07-07_event_roster_pickup_order.sql`. | **deferred** |

---

## Reporting & office outputs

NDIS audit trail + coordinator/office report suite. Per-event **Trip Report V1** (office skim in Event Manage) is separate from the deep trip folder inside the **NDIS Audit Pack**.

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-061 | **NDIS & office reporting programme** | **Programme home for USB Audit Pack (v1+; BL-093/094/095 2026-07-26).** Admin → System parameters → **NDIS Audit Pack**: date-range ZIP + Named/De-id toggle; Trip Report same. Runbook: `docs/architecture/NDIS-AUDIT-PACK.md`. **Parked 2026-07-26** with Documentation / SOP / onboarding review (BL-065, BL-051, BL-092) — pack shell stays; deeper policy/docs into ZIP waits on that pass. | **deferred** |
| BL-087 | **Event trip Auditing Package (Trip Report V2)** | **Done** as `03_Trips/` inside BL-061 + Trip Report **Trip evidence ZIP**. Attendance, boarding, rolls, day-close, issues + Hub notes, §11 manifest, **HOME matrix (BL-095)**, **venue safety (BL-094)**; PDF + CSVs; regional stamps. | **done** (2026-07-21; harden 2026-07-23; HOME/venue 2026-07-26) |
| BL-092 | **Policies & Procedures library** | Practice Standards–aligned org policies (incident, complaints, privacy, HR, etc.): review drafts, version control, SharePoint home (**BL-051**), map to standards. **Audit Pack:** approved set dumps into ZIP folder `05_Policies_Procedures/` (currently stub README only). Distinct from Hub compliance certs (`04_`), onboarding Word packs (BL-065 → `06_`), and in-app **Help How-To (BL-105)**. **Includes belongings/valuables SOP (BL-079)** — policy-first; no dedicated custody UI unless losses force it. Later: deep-link approved policies into Help (`kind: policy`). | **discuss** |
| BL-105 | **In-app Help — searchable How-To** | **Built 2026-07-31 (Alpha).** `/help` searchable operator how-to (repo topics under `src/lib/help/`). Soft role filter via topic `roles` + manager-sees-all; hard RBAC at **BL-002**. Expand later: `kind: policy` (BL-092), `kind: form` / online forms (BL-065). Not a substitute for formal P&P. | **done** (Alpha) |
| BL-093 | **Audit Pack — de-identified auditor mode** | **Done 2026-07-26 (SIM pass).** Toggle on Admin Audit Pack + Trip evidence ZIP: **Named (default, authoritative)** vs **De-identified**. De-id: stable `P-###` / `S-###` for names + id columns; venues/dates/process kept; ZIP `*_deid.zip`; README + index state mode. Free-text (issue notes, ledger JSON) **not** scrubbed — warned. No sealed key file. Code: `src/lib/audit-pack/identity.ts`. | **done** |
| BL-094 | **Audit Pack — venue safety checklist evidence** | **Done 2026-07-26 (SIM pass).** Trip pack: `venue_safety_baselines.csv` (primary/stops + latest baseline evidence_ref), `venue_open_walkthrough.csv` (BL-070 `EVENT_LOCATION_OPENED` checks), `venue_reconfirmations.csv` (table may be empty until Confirmed-gate UI), PDF **Venue safety** section. Code: `src/lib/audit-pack/venue-safety.ts`. | **done** |
| BL-095 | **Audit Pack — Transport HOME completion matrix** | **Done 2026-07-26 (SIM pass).** `03_Trips/…/home_completion_matrix.csv` + PDF section: planned vs actual return mode/run (R1/R2), check-out stamps, mode/run mismatch flags, incomplete reasons (`still_with_group`, `no_return_trip_for_run`, etc.). Attendance timeline + boarding CSVs include bus run codes. | **done** |
| BL-104 | **Hub issue print / one-pager** | Printable single-issue summary for office/auditor: who/what/when, severity, timeline notes, stand-down debrief, resolution. From Manage issue (and maybe Audit Pack slice). Complements BL-061 ZIP (bulk) — this is **one ticket, paper-ready**. | **discuss** |

---

## Council escalations & governance

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-062 | **Council escalations & management** | **Locked + mailto path shipped 2026-07-28; Admin panel 2026-07-30.** Escalate → pre-fill **mailto** → log email_dispatched_to_council + ledger. Admin → System Parameters → **Council email**: To, optional From (shared mailbox), template. Blank From = operator account. SQL: `docs/sql/2026-07-30_council_email_params.sql`. **No** server SMTP. DEV/TEST To = internal; PROD = real council. **Later discuss:** council-eligible types; response/ack; reporting. | **ready** (mailto + Admin done; workflow polish later) |
| BL-067 | **Wall monitor display — read-only dashboard** | Standalone full-screen dashboard showing only Exception Hub tiles + calendar. No login, no menu, no interactive elements. Tiles read-only with auto-refresh. Discuss: public anon URL vs PIN-gated kiosk route, display resolution target (TV/monitor vs large iPad), refresh interval. Prerequisite: finalise tile bands + sizing (BL-066 done). | **discuss** |
| BL-066 | **Hub weekly update SLA + dashboard Maintenance tile** | **Done 2026-07-12.** 8 tiles across 4 NDIS Duty of Care bands. New tiles: No-Show/Missing, Roll Call Breach, Active RED Incidents, Hub Human Issues (stale), Maintenance. SQL: `docs/sql/2026-07-12_dashboard_tile_params.sql`. Band layout replaces flat tile grid. BL-067 spun out for wall monitor. | **done** |

---

## Meals, Day Centre ops & care delivery

Parked for discussion after multi-day basics — do not drop. Related: BL-070 (venue walkthrough), BL-065 (onboarding/consents), BL-074 (secrets), BL-082 (offline).

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-073 | **Meals — prep, delivery & management** | **Done 2026-07-26 (ops slice).** Plan slot → Open (source/menu) → cooked/packed: preparer PIN attest + prep checklist OR guest + MoD PIN; **SFH missing/expired = Manager PIN approval** (strict); serve roll = **checked-in only** (Centre + Trips); **hard Complete** until every recipient dispositioned (Served/Modified/Own order/Declined/N/A) — serving others not blocked mid-meal. SQL: `…_meal_open_preparer.sql`, `…_meal_prep_checks.sql`, `…_meal_prep_attestation.sql`, `…_meal_sfh_manager_approval.sql`. Kitchen WHS/stock deferred if ever needed. | **done** |
| BL-075 | **Day Centre Open / Close checklist** | Admin list UI shipped (`MandatedChecksAdminPanel` for open/close keys). **Parked 2026-07-26** until wider Documentation / SOP / Policy & Templates review (NDIS Audit) — richer Bonnyrigg-style SOP content/grouping plugs in then. Secrets (alarm codes) stay via BL-074, not checklist text. | **deferred** |
| BL-076 | **Participant clinical flags on rolls** | **v1 built 2026-07-26.** Allergy + Diet/IDDSI chips (`ClinicalFlagChips` / `clinical-flags.ts`) on Day Centre Check-In/Out, Event Check-In, meal service; tap → short sheet. SoT = `participants.allergies_notes` + IDDSI (BL-065 onboarding still parked). Office edit only. | **done** (v1) |
| BL-077 | **Medication — Day Centre & trip-day parity** | **Built 2026-07-26.** Programme **Medication round** row (auto-seeded, RYG like Day Centre). Presence = trip checked-in minus alternate plans. Give Dose: **dual PIN** or **sole-carer PIN + justification**. Hard Complete on timed doses (PRN does not block). Alternate med plan PIN sheet. SQL: `docs/sql/2026-07-26_event_medication_round.sql`. Ops: no coded activity times — leader cancels activity if client refuses outing without alternate plan. | **done** |
| BL-078 | **End-of-day / shift handover** | Short structured handover: who is still on site, open issues, meds/meals outstanding, notes for next shift / office. **Pairs with** Hub stale SLA (BL-066) and Close Centre (BL-075). **Discuss:** Day Centre vs trip-day; required fields vs free note; PIN sign-off. | **discuss** |
| BL-079 | **Belongings & valuables** | **Parked under BL-092 (policy/procedure).** Default MVP: policy (“participants retain own valuables; staff do not store cash/phones”) + Hub **Lost property** issue when needed. **No dedicated custody/locker code** unless ops prove need. Money custody stays with BL-083 once office practice is known. | **deferred** (→ BL-092) |
| BL-080 | **Consent / contact currency** | **Fold into BL-065 Client Onboarding + periodic review**, not a separate floor product. Capture at intake (photo, outing, medical treatment, emergency contacts, etc.) with **expiry / review dates**; Hub (compliance-style) tracks currency; Confirm/Open can later warn/block from those dates. SharePoint for signed artefacts (BL-051). Keep ID until onboarding slice lands, then close into BL-065. | **discuss** (→ BL-065) |
| BL-081 | **Staffing vs headcount** | Light check that floor/trip staffing matches rostered participant numbers / ratio expectations for that day. **Not** full rostering/HR. **Discuss:** ratio rules source; warn vs block Open; multi-bus / multi-venue split. | **discuss** |
| BL-083 | **Money handling on trips** | **Leave until office practice known.** Possible MVP: policy “no cash / no petty cash — reimbursements + receipts only” (then almost no app beyond existing expenses). Else: float / personal cash custody. Links BL-001 vendors, expenses, Trip Report P&L, BL-079. | **discuss** |
| BL-084 | **Infection control, site close & emergencies** | **Design locked 2026-07-27 (A→B→C).** **Phase A + A.1 done.** **Phase B + C MVP built 2026-07-29.** **Entry locked 2026-07-29:** Big Red third lane **Health & Safety** → `GlobalHealthSafetyFlow` (everywhere); no duplicate H&S/Emergency chips on Day/Event/Manifest. **B:** do-not-open; lockdown/early close; programme suspend. **C:** Drill\|Live activate + sticky banner + light muster + stand-down. **Stand-down does not auto-resolve Hub.** SQL: `2026-07-29_operational_emergencies_mvp.sql`. Notify = mock SMS (BL-050). Later: Policies (BL-092); Hub print **BL-104**. | **ready** (A–C MVP; Big Red H&S entry locked 2026-07-29) |

---

## Onboarding & competency (high-trust)

Competency-based onboarding for **participants (clients)**, **staff**, and **volunteers/carers**. Distinct from post-onboarding **certification compliance** (WWC, First Aid, driver's licence, etc.) which creates `compliance_assets` / Hub entries **after** intake.

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-065 | **Onboarding — clients, staff, volunteers/carers** | **Workflow (locked intent):** (1) **Online form** — completed by the person directly **or** interview-style by office admin/manager on their behalf. (2) **Print** completed form → **wet sign** → **scan/photo** uploaded back into Yada as permanent record; **signed paper copy given to the person**. (3) **SharePoint** = authoritative document store for audits and office admin (**depends on BL-051** — folder taxonomy per person type, link from app record). (4) **Online submission** feeds operational data — e.g. participant profile, medical, emergency contacts (`participants`, medications, alerts) — separate from the signed PDF artefact. (5) **Certifications** (WWC, First Aid, driver's licence, etc.) captured **after** onboarding intake; each cert creates/updates **Compliance Hub** entries (`compliance_assets`, `staff_compliance_and_certs`). (6) **Role catalogue in Admin** — each role (participant client, support worker, coordinator, volunteer/carer, etc.) has defined **onboarding form template** + **post-onboarding compliance requirements**; Hub tracks requirement fulfilment per individual. **(7) Consent / contact currency (absorbs BL-080):** photo, outing, medical treatment, emergency contacts, etc. with review/expiry dates; Hub tracks stale; Confirm/Open can warn/block later; periodic review cycle. **Audit Pack (BL-061):** induction/training materials + signed artefacts feed ZIP folder `06_Onboarding_Training/` (Clients / Staff / Volunteers_Carers) — stub until this + BL-051 ship; sample selection rules for auditors TBD. **Existing hooks:** `staff_registry`, `participants`, `carers_registry`, `compliance_assets` panel, `staff-form-sheet` (PIN onboarding today is dev-only). **Discuss:** form builder vs fixed templates per role; e-signature vs print-sign-scan only; mobile photo upload UX; RBAC who can start/complete onboarding (BL-002); competency field model (parallel to `venue_template_fields` §12.2.2?). **Not in scope yet:** automated NDIS plan ingest. | **discuss** |

---

## Schema & live DB alignment

Frontend must match **live Supabase** before drift remediation (see `.cursor/rules/guardrails-drift-gate.mdc`).

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-020 | `event_financial_ledger.vendor_name` | Live DB has **no** column; app uses description prefix. Optional migration: `docs/sql/2026-07-06_event_financial_ledger_vendor_name.sql` | **deferred** |
| BL-021 | Venue registry & outing SQL phases | **Verified 2026-07-12** on live Supabase via anon REST probes: all §12 tables/columns present (`venues`, `event_day_sessions`, `event_attendance_log`, `event_venue_stops`, `event_bus_manifest`, curfew/morning logs, roster transport modes, system_parameter seeds). `site_issues_register.event_id` + `event_day_session_id` present. Validation script: `docs/sql/2026-07-16_bl021_verification.sql`. Optional: run commented `trip_kind` backfill in that file. | **done** |
| BL-057 | **Admin full DB backup / restore** | **Implemented 2026-07-11 (UI + server routes).** Admin → Backup & Restore tab. Dynamic `list_backup_tables` RPC scan; filename `yyyymmdd - Yada Connect - Full Backup.json`. Restore truncates public tables then reloads; **preserve local login** switch skips `staff_registry` (DEV dummy PINs safe on PROD→DEV restore). Requires: apply `docs/sql/2026-07-11_backup_restore_rpcs.sql`, add `SUPABASE_SERVICE_ROLE_KEY` to server `.env`. Future RBAC (`auth.users`, `role_menu_access`) → extend `AUTH_PROTECTED_TABLES` when BL-002 lands. | **done** |
| BL-058 | **Venue safety baseline compliance gate** | **Implemented 2026-07-11.** (1) Admin → Venues list shows per-row badge: Signed off · No baseline · Review overdue · Review deferred. (2) Hard gate blocks adding an unsigned/overdue venue to any outing (create modal, event-details primary venue, itinerary stops). Deferral grace window (max 1 month) allows use with amber warning. (3) New baseline sign-off auto-resets annual compliance asset expiry +1 year. Auto-creates compliance asset on venue create/clone. Requires: run `docs/sql/2026-07-11_venue_compliance_assets.sql` to backfill existing active venues. | **done** |
| BL-022 | `participant_financial_ledger` event linkage | No `event_id` FK — payments tagged via `[event:<uuid>]` in description. Documented in code; do not add `.eq("event_id")` queries. | **done** (2026-07-06) |

---

## GUARDRAILS drift remediation

**Explicitly deferred** until frontend sync complete **and** user approves. Full list: `docs/architecture/GUARDRAIL-DRIFT-REPORT.md`.

| ID | Item | Status |
|----|------|--------|
| BL-030 | Ledger abort-on-failure (`writeToLedger` must throw) | **deferred** |
| BL-031 | Unify ActiveIssuesRegister vs IssuesRegisterCard | **deferred** |
| BL-032 | Remove legacy RED / `operational_escalations` paths from new code | **deferred** |
| BL-033 | Automated RED bypasses (attendance sweep, med bag) → verbal flow | **deferred** |

---

## Done (recent)

| ID | Item | Completed |
|----|------|-----------|
| BL-063 | SMS mock popup hook audit — checklist + pickup-cancel emit | 2026-07-20 |
| — | Trip report: actual return transport from `event_attendance_log` | 2026-07-06 |
| — | Trip report / roster: transport badge colours (bus blue, self slate) | 2026-07-06 |
| — | Trip report P&L matches Finance tab (`listEventPaymentLedgerForEvent`) | 2026-07-06 |
| — | Log event expense without `vendor_name` column | 2026-07-06 |
| — | Manifest outbound vs return direction | 2026-07-06 |
| BL-010 | Movies single-day outing end-to-end test (outbound, venue, return, close event) | 2026-07-12 |
| BL-059 | Multi-day evening/morning roll calls — admin defaults, 24h picker, propagate | 2026-07-12 |
| — | Inner trip-day tabs active styling + Incident button on manage modal | 2026-07-06 |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-31 | BL-105 Help — RYGE philosophy, Hub three streams, Defer across Hub/check-ins/rolls |
| 2026-07-31 | BL-105 Help expanded — Vendors, Venues, overnight hotel, event open checks, meals, meds, Participants/Staff, Admin overview |
| 2026-07-31 | BL-105 Help How-To Alpha — `/help` searchable topics; soft role filter; distinct from BL-092 P&P |
| 2026-07-28 | BL-062 mailto-only shipped — removed Lovable/server email path; Hub escalate opens mail |
| 2026-07-28 | BL-062 locked — council via mailto only (user mail client); Hub notes + RYG stale; no Postmark |
| 2026-07-29 | BL-099 — TEST bootstrap SQL from DEV OpenAPI (`2026-07-29_test_bootstrap_create_tables.sql`) |
| 2026-07-29 | BL-099 — TEST Supabase stood up (AU); ENV-LANES.md promote/load checklist written |
| 2026-07-28 | BL-099 thin day login built — email/password then PIN; AuthGate requires both |
| 2026-07-28 | BL-099 partial lock — Lovable + custom domain intent; TEST thin day-login (no IP whitelist); full RBAC still last |
| 2026-07-29 | BL-084 Big Red third lane Health & Safety locked — `GlobalHealthSafetyFlow`; GUARDRAILS §13.2 / §14; removed Day/Event/Manifest H&S entry chips |
| 2026-07-29 | BL-084 Hub review UX — stand-down leaves issue Open; Hub sticky banner + Open issue; LIVE/DRILL sort to top; BL-104 Hub print one-pager added (discuss) |
| 2026-07-29 | BL-084 Phase B+C MVP built — do-not-open/lockdown/suspend + Drill\|Live activate/muster/stand-down; SQL `2026-07-29_operational_emergencies_mvp.sql`; Hub Emergency & Site Hold tile |
| 2026-07-28 | BL-084 — office drill capture + Phase C paper-first MVP notes (Drill vs Live, ask-list, disability-safe practice); full B/C plan after office meeting |
| 2026-07-27 | BL-084 A.1 locked+built — Centre+Trip entry; home-safe disposition + PIN when in care (non-prescriptive) |
| 2026-07-27 | BL-084 Phase A built — infectious exclusion + return-to-care (SQL + Day Centre + Hub + Band 2 tile) |
| 2026-07-27 | BL-084 design locked — manager-only declare; A→B→C; Hub Human/Maintenance + Health & Safety area/tiles; clearance attestation vs cert by illness; billing = closed/absent only |
| 2026-07-27 | BL-079 → BL-092 policy (no custody UI); BL-080 → BL-065 onboarding/Hub expiry; BL-083 wait on office money practice; BL-084 prioritise infection + emergency design |
| 2026-07-26 | IS_TEST_BUILD — Lovable published DEV shows test tools until PROD; `VITE_APP_LANE` / `VITE_SHOW_TEST_TOOLS` documented (not secrets) |
| 2026-07-26 | BL-101/102/103 added — remaining field offline (Trips floor, Manifest walkaround/Start, Day Centre arrival); DEV Simulate offline switch |
| 2026-07-26 | BL-082 Manifest mid-run Alpha — IndexedDB outbox + snapshot; Close Run blocked until sync; Event Deliver offline still later |
| 2026-07-26 | BL-073 done — preparer PIN attest, Manager SFH approval, checked-in serve rolls, hard Complete; SQL `…_meal_prep_*.sql`, `…_meal_sfh_manager_approval.sql` |
| 2026-07-26 | BL-073 live meal Open + preparer/SFH + serve-roll outcomes (Centre + Trips); SQL `2026-07-26_meal_open_preparer.sql` |
| 2026-07-26 | BL-100 Day Centre tabs + BL-073/076/077 phases A–F (meals, clinical chips, med round on Activities) |
| 2026-07-26 | BL-099 added — DEV → TEST → PROD environments + promotion workflows (discuss); UI tweaks parked for Alpha on TEST |
| 2026-07-26 | BL-098 leftovers — archive guests on Close event; Day Centre visitor → Add to event prefill |
| 2026-07-26 | BL-098 SIM smoke pass — Add guest + DOB year/month dropdowns; marked done |
| 2026-07-26 | BL-098 build — Add guest modal + schema + Confirm/Open gates |
| 2026-07-26 | BL-098 locked — guest = participant_id + roster booking; archive after; reuse on return |
| 2026-07-26 | BL-097 SIM smoke pass — Day Centre floor visitors done; BL-098 discuss expanded (treat as client once on trip) |
| 2026-07-26 | BL-097 locked Day Centre–only visitors (ready); BL-098 added — Event planned bring-a-friend (discuss) |
| 2026-07-26 | Floor row embedded method override — locked in UI Style Guide; Day Centre + Event in/out SIM smoke pass (BL-013 UX) |
| 2026-07-26 | BL-013 Day Centre parity — Check-In arrival Bus/Self sheet + `arrival_bus_run_code` |
| 2026-07-26 | BL-013 SIM pass — Event Check-In arrival method (bus vs self) |
| 2026-07-26 | BL-097 added — floor visitors/guests (non-registered; discuss) |
| 2026-07-26 | BL-013 done — Check-In arrival method picker (bus vs self; planned ≠ actual) |
| 2026-07-26 | BL-093 DEID SIM pass — Named vs De-id Audit Pack toggle |
| 2026-07-26 | BL-093 done — Named vs De-id Audit Pack toggle (P-/S- codes; free-text warn) |
| 2026-07-26 | BL-094 SIM pass — venue baselines + Open walkthrough in Audit Pack |
| 2026-07-26 | BL-094 done — Audit Pack venue baselines + Open walkthrough ticks + reconfirmation CSV |
| 2026-07-26 | BL-095 done — Audit Pack HOME completion matrix (+ bus-run columns); BL-069 SIM pass confirmed |
| 2026-07-23 | BL-069 done — multi-bus event IN+HOME (R1/R2); live-field BL-012/064/068 parked as SIM OK |
| 2026-07-23 | Park live-field BL-012/064/068 as SIM OK; BL-069 multi-bus IN+HOME (R1/R2) in build |
| 2026-07-23 | Multi-day SIM pass (park build) — Left-trip→HOME Manifest floor filter; BL-012 still needs live field sign-off |
| 2026-07-23 | BL-096 done — Manifest odo suggest (start+Σ) + soft-warn params + Fleet current KM correct |
| 2026-07-23 | BL-070 done — Event Deliver Open location venue walkthrough (`event_deliver.venue_open_checks` + MandatedChecksList); ledger metadata for BL-094 |
| 2026-07-23 | Audit Pack harden — Hub notes/resolution trail + §11 manifest in ZIP; regional date stamps; follow-ups BL-093 (de-id), BL-094 (venue safety), BL-095 (HOME matrix) |
| 2026-07-21 | BL-061 Audit Pack v1 + BL-087 trip evidence ZIP shipped; BL-092 Policies & Procedures library added (discuss); BL-065 note → pack folder `06_` |
| 2026-07-21 | BL-090 done — left-trip Absent welfare (disposition/PIN/Hub) + Check-Out Left trip placeholders + reinstate |
| 2026-07-21 | BL-091 done — Programme completed activity read-only expand |
| 2026-07-21 | SIM smoke A/B/C complete — BL-072/085/086/088/089 → done (SIM); BL-064 SIM done / live field still open; next harden BL-090 then BL-091 |
| 2026-07-21 | BL-091 added — Programme completed activity read-only expand (times, method, issues) |
| 2026-07-21 | BL-090 extended — left-trip Absent must clear Check-Out assign list; reinstate with PIN allowed |
| 2026-07-21 | BL-090 added — trip-day Absent must raise Yellow (+ disposition/safety plan); not free-text-only orderly close |
| 2026-07-21 | BL-060 Phase 5 Admin done — office Select/Switch, Venues Table≈Vendors, Close+sheet footers, AlertDialog deletes, counted justifications; Menu Access left for BL-002 |
| 2026-07-21 | BL-064 runbook shipped — `docs/TRIP-DAY-ROLL-CALLS.md` (smoke A/B/C); field test still blocked on BL-012 |
| 2026-07-20 | BL-063 done — SMS mock popup audit (`SMS-MOCK-AUDIT.md`); wired pickup-cancel `emitMockSms`; event RED non-OK harden |
| 2026-07-19 | BL-089 built — Manage/Deliver surface split; overnight Close day in Deliver; strip Manage floor tabs; Run this event; Close Trip → Trip Report |
| 2026-07-18 | BL-072 / BL-T3 built — multi-day non-final nights must end at Hotel / accommodation; hard block Confirm/Open/Open location; Itinerary overnight UI |
| 2026-07-18 | BL-088 built — lifecycle gates (sequential open, evening/checkout close, event departure + status repair); GUARDRAILS §12.4.5a |
| 2026-07-18 | BL-088 day-close rule locked — close when evening roll done (may be before scheduled curfew); high-trust + timestamp accountability; no clock hard-gate |
| 2026-07-18 | BL-087 Auditing Package (Trip Report V2); BL-061 clarified — Trip Report V1 = office-sufficient; BL-088 multi-day lifecycle sequencing gates; nav Events → Event Manage under Event Deliver |
| 2026-07-18 | Trip Day Hub issues — roll Yellow/Red carry event_id + System reporter; reported_by → text; SQL `2026-07-18_trip_day_issue_reporter.sql` |
| 2026-07-18 | BL-086 built — Event Deliver Reset Start of Day (test): wipe day floor ops + DEV clock 07:00; stay on Day N |
| 2026-07-18 | BL-085 built — roll deferral dialog (Yellow PIN / Red verbal), banner + panel CTAs, late-return defer path, Admin max defer minutes |
| 2026-07-18 | BL-085 added — roll call Yellow/Red deferral (PIN + workaround) + late-return/bus-delay gate vs hotel evening roll (discuss) |
| 2026-07-17 | BL-075–BL-084 parked for later discuss: Open/Close checklist, clinical flags on rolls, med Day/trip parity, handover, belongings, consent currency, staffing vs headcount, offline field, trip money handling, infection/weather close |
| 2026-07-17 | BL-073 added — Meals prep/delivery/management (Day Centre + trip itinerary B/L/D); BL-074 Secrets management (alarm codes, logins, insurance, emergency contacts vault); cleaned orphaned BL-066 draft text |
| 2026-07-14 | BL-072 added — accommodation gate for overnight event days; requires venue type tagging in venue_registry (discuss) |
| 2026-07-14 | BL-071 added — Event & Attendance SMS alerts for late/absent participants; builds on arrival gate (discuss) |
| 2026-07-13 | BL-070 added — pre-open venue safety walkthrough for Event Deliver (discuss) |
| 2026-07-16 | DEV operational clock shipped — `operational-clock.ts` + sticky bar; gates multi-day / curfew YELLOW·RED QA without waiting for wall clock |
| 2026-07-13 | BL-069 added — multiple return bus routes for Event Deliver Check-Out (discuss) |
| 2026-07-13 | BL-068 added — Event Deliver mobile-first field workflow; GUARDRAILS §12.13 locked (Extended Golden Rule, three-phase model, Phase A–E build sequence) |
| 2026-07-12 | BL-067 added — wall monitor read-only dashboard (discuss) |
| 2026-07-12 | BL-066 — Hub weekly update SLA (7d yellow / 14d red) + dashboard Maintenance tile |
| 2026-07-12 | BL-065 — high-trust onboarding (clients/staff/volunteers): online form → print/sign/scan → SharePoint; certs post-onboarding; role requirements in Admin/Hub |
| 2026-07-12 | BL-010 return run confirmed complete; added BL-061 (NDIS/office reports), BL-062 (council escalations), BL-063 (SMS mock audit), BL-064 (trip day roll call doc + test) |
| 2026-07-12 | BL-060 Governance Hub — card rows, ManageItemShell footer, toasts, RYGE chips |
| 2026-07-12 | BL-060 + `UI-STYLE-GUIDE.md` — pattern registry, ask-first agent rule, phased audit plan |
| 2026-07-12 | BL-002 — two-tier session spec locked (day email login + idle PIN lock + action step-up); GUARDRAILS §2.4 + `.cursor/rules/rbac-forward-compat.mdc`; status **deferred** until last |
| 2026-07-12 | BL-059 done — evening/morning roll call labels, 24h half-hour picker, admin defaults, trip-day seed + propagate |
| 2026-07-12 | BL-011 done — multi-day trip leader propagates to unassigned days; stale warning not reproduced |
| 2026-07-12 | BL-010 done — Movies outing E2E; transport_trips RLS, return-after-close manifest path, event close guard |
| 2026-07-07 | BL-056: manifest navigation map Phase 0 + 0.5 — placeholder route panel, Google Maps deep link, en_route hide/show stops |
| 2026-07-07 | BL-015: Phases 1–2 (live Maps embed, coordinator optimisation) deferred; Phase 0+0.5 delivered as BL-056 |
| 2026-07-07 | BL-052: mobile field UX — sticky confirm CTA, BottomSheet dialogs, safe-area, hop headers, event tab min-height |
| 2026-07-07 | BL-052: manifest active leg — big tap buttons for on-board/no-show, unexpected med, med handover; event arrival roll + bus check-on touch targets |
| 2026-07-07 | BL-054: Close Run PIN — manifest reconciliation + operator PIN + `TRANSPORT_RUN_CLOSED` ledger |
| 2026-07-07 | BL-053: PinPad + PinEntryDialog — all PIN surfaces migrated; GUARDRAILS §2.3 |
| 2026-07-11 | BL-003: event-day RED verbal auth — LogAnomalyModal + VerbalConsultationDialog (remote, operator PIN only) on trip days and Manage Event |
| 2026-07-11 | BL-001: vendor registry — Admin → Vendors, type-ahead on log expense, prompt-to-add for unknown names |
| 2026-07-11 | BL-058: venue safety baseline compliance gate — list badge, hard event picker block, auto compliance asset creation/renewal |
| 2026-07-07 | BL-050 SMS provider setup; BL-051 SharePoint integration setup; RBAC (BL-002) confirmed on backlog under Infrastructure & platform |
| 2026-07-06 | BL-040: return-run leg card fully implemented — per-person boarding roll + context-sensitive drop-off mode
| 2026-07-06 | BL-014: pickup workflow when medication not required during trip |
| 2026-07-06 | Initial backlog — vendor policy, RBAC, §12 test items, schema notes, drift deferrals |
