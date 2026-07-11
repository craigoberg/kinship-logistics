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
| BL-001 | **Trip expense vendors** | On **Finance & P&L → Log event expense**, should vendor be **free text** (current: optional field, stored in description prefix `[Vendor: …]`) or **must link to a vendor registry** (existing or new table)? Implications: reporting, GST, duplicate names, venue registry overlap. | **discuss** |
| BL-002 | **Security RBAC mode** | Role-based access control model not yet defined. Scope likely includes: who can open/close events, trip leader vs manager PIN, manifest driver vs coordinator, Governance Hub, system parameters. Needs stakeholder workshop. Menu access matrix exists in code but live enforcement TBD. | **discuss** |
| BL-003 | **Event-day RED verbal auth** | Outing **Incident / Fault** on manage-event modal opens `LogAnomalyModal` but **VerbalAuthOverrideDialog** for RED may not be wired at modal level (Config tab has smaller path). Align with GUARDRAILS §3 site-day pattern? | **discuss** |

---

## Infrastructure & platform

Cross-cutting setup — not feature-complete until provider accounts, credentials, and ops runbooks exist.

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-050 | **SMS provider setup** | GUARDRAILS reference internal routes (`/api/internal/attendance-sms`, `transport-pickup-sms`, curfew RED dispatch). Code has mock/stub paths today. Needs: provider choice (Twilio/etc.), env secrets, recipient lists in `system_parameters`, production routing for pickup cancel, curfew RED, Sev1 escalation, unsafe-drop alerts. Ops runbook for who receives what. | **discuss** |
| BL-051 | **SharePoint integration setup** | GUARDRAILS §5.2 — compliance PDFs, vehicle servicing slips, certification docs live on SharePoint. App references links in compliance UI but no live sync/API. Needs: tenant/site mapping, auth (app registration / service principal), which document types sync to `compliance_assets`, failure handling, and whether read-only links vs automated ingest. | **discuss** |

**RBAC:** already tracked as **BL-002** (Policy & design section).

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

---

## Outing trips & events (GUARDRAILS §12)

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-010 | Movies / single-day outing **end-to-end test** | Manifest outbound vs return, trip days, arrival roll, close location, trip report. In progress during Jul 2026 test. | **ready** |
| BL-011 | **Trip leader warning** when location already open | Collapsed trip-day row can still show *"No trip leader assigned"* if leader was assigned after Open or save not refreshed. | **ready** |
| BL-012 | **Multi-day tour** flows | Curfew / morning roll / multi-session transport aggregation on trip report — coded but not field-tested. | **blocked** (needs multi-day event) |
| BL-013 | **Arrival method vs planned outbound** | Floor roll seeds `arrival_method` from booking; no UI to record self inbound when roster said bus. Report uses seed unless we add check-in method picker. | **discuss** |
| BL-014 | **Pickup when meds not required on trip** | **Implemented 2026-07-07.** Outings: per-booking `transport_med_bag_required` (yes/no/not_set) + `transport_med_notes` on roster; driver manifest prompts only when `yes`; Day Centre unchanged (schedule-based). Confirm blocked until bus passengers assessed. SQL: `docs/sql/2026-07-07_event_roster_transport_med_bag.sql`. | **done** |
| BL-015 | **Google Maps route optimisation** | **Phase 1 (deferred):** Maps JavaScript API + DirectionsRenderer live embed in `ManifestRouteMap` — needs API key, billing, geocoding for leg-level addresses. **Phase 2 (deferred):** Coordinator drive-time ordering, traffic-aware ETAs on roster/manifest. Until then: drag-sort roster (`pickup_order`), in-manifest reorder, Phase 0 placeholder + deep link (**BL-056** done). SQL: `docs/sql/2026-07-07_event_roster_pickup_order.sql`. | **deferred** |

---

## Schema & live DB alignment

Frontend must match **live Supabase** before drift remediation (see `.cursor/rules/guardrails-drift-gate.mdc`).

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-020 | `event_financial_ledger.vendor_name` | Live DB has **no** column; app uses description prefix. Optional migration: `docs/sql/2026-07-06_event_financial_ledger_vendor_name.sql` | **deferred** |
| BL-021 | Venue registry & outing SQL phases | Apply / verify: `2026-07-16_venue_registry_*`, `2026-07-04_event_attendance_log_phase8.sql` on all environments | **ready** |
| BL-057 | **Admin full DB backup / restore** | **Implemented 2026-07-11 (UI + server routes).** Admin → Backup & Restore tab. Dynamic `list_backup_tables` RPC scan; filename `yyyymmdd - Yada Connect - Full Backup.json`. Restore truncates public tables then reloads; **preserve local login** switch skips `staff_registry` (DEV dummy PINs safe on PROD→DEV restore). Requires: apply `docs/sql/2026-07-11_backup_restore_rpcs.sql`, add `SUPABASE_SERVICE_ROLE_KEY` to server `.env`. Future RBAC (`auth.users`, `role_menu_access`) → extend `AUTH_PROTECTED_TABLES` when BL-002 lands. | **done** |
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
| — | Trip report: actual return transport from `event_attendance_log` | 2026-07-06 |
| — | Trip report / roster: transport badge colours (bus blue, self slate) | 2026-07-06 |
| — | Trip report P&L matches Finance tab (`listEventPaymentLedgerForEvent`) | 2026-07-06 |
| — | Log event expense without `vendor_name` column | 2026-07-06 |
| — | Manifest outbound vs return direction | 2026-07-06 |
| — | Inner trip-day tabs active styling + Incident button on manage modal | 2026-07-06 |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-07 | BL-056: manifest navigation map Phase 0 + 0.5 — placeholder route panel, Google Maps deep link, en_route hide/show stops |
| 2026-07-07 | BL-015: Phases 1–2 (live Maps embed, coordinator optimisation) deferred; Phase 0+0.5 delivered as BL-056 |
| 2026-07-07 | BL-052: mobile field UX — sticky confirm CTA, BottomSheet dialogs, safe-area, hop headers, event tab min-height |
| 2026-07-07 | BL-052: manifest active leg — big tap buttons for on-board/no-show, unexpected med, med handover; event arrival roll + bus check-on touch targets |
| 2026-07-07 | BL-054: Close Run PIN — manifest reconciliation + operator PIN + `TRANSPORT_RUN_CLOSED` ledger |
| 2026-07-07 | BL-053: PinPad + PinEntryDialog — all PIN surfaces migrated; GUARDRAILS §2.3 |
| 2026-07-07 | BL-050 SMS provider setup; BL-051 SharePoint integration setup; RBAC (BL-002) confirmed on backlog under Infrastructure & platform |
| 2026-07-06 | BL-040: return-run leg card fully implemented — per-person boarding roll + context-sensitive drop-off mode
| 2026-07-06 | BL-014: pickup workflow when medication not required during trip |
| 2026-07-06 | Initial backlog — vendor policy, RBAC, §12 test items, schema notes, drift deferrals |
