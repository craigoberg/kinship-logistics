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
| BL-002 | **Security RBAC mode** | Role-based access control model not yet defined. Scope likely includes: who can open/close events, trip leader vs manager PIN, manifest driver vs coordinator, Governance Hub, system parameters. Needs stakeholder workshop. | **discuss** |
| BL-003 | **Event-day RED verbal auth** | Outing **Incident / Fault** on manage-event modal opens `LogAnomalyModal` but **VerbalAuthOverrideDialog** for RED may not be wired at modal level (Config tab has smaller path). Align with GUARDRAILS §3 site-day pattern? | **discuss** |

---

## Driver manifest — context-sensitive leg card

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-040 | **Return-run leg card** (drop-off mode) | **Implemented 2026-07-06.** `ReturnBoardingRoll` gates first-leg departure — driver taps every passenger "On Bus" by name; all must be confirmed before "Depart Stop" activates. State persisted in localStorage per trip, ledger write on confirm. `ArrivedChecklist` context-aware: replace "Passenger Present & Boarded" with "Passenger safely at drop-off"; toggle-off = unsafe drop dialog (no countdown); hide medication panel + "Log Unexpected Med Bag" on all return legs. `startTrip` already sets `medication_expected = false` on all return-run legs. Signal: `trip.tripReturn !== "none"` (Day Centre afternoon + event return). | **done** |

---

## Outing trips & events (GUARDRAILS §12)

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-010 | Movies / single-day outing **end-to-end test** | Manifest outbound vs return, trip days, arrival roll, close location, trip report. In progress during Jul 2026 test. | **ready** |
| BL-011 | **Trip leader warning** when location already open | Collapsed trip-day row can still show *"No trip leader assigned"* if leader was assigned after Open or save not refreshed. | **ready** |
| BL-012 | **Multi-day tour** flows | Curfew / morning roll / multi-session transport aggregation on trip report — coded but not field-tested. | **blocked** (needs multi-day event) |
| BL-013 | **Arrival method vs planned outbound** | Floor roll seeds `arrival_method` from booking; no UI to record self inbound when roster said bus. Report uses seed unless we add check-in method picker. | **discuss** |
| BL-014 | **Pickup when meds not required on trip** | If a participant does **not** need medication during the outing, how should **home pickup** (manifest / roster) behave? Open questions: skip med-bag handover flags on legs, roster snapshot still required?, driver UX (no med prompt vs explicit “no meds today”), event vs Day Centre parity, ledger receipt if waived. Needs ops + clinical policy before build. | **discuss** |

---

## Schema & live DB alignment

Frontend must match **live Supabase** before drift remediation (see `.cursor/rules/guardrails-drift-gate.mdc`).

| ID | Item | Notes | Status |
|----|------|-------|--------|
| BL-020 | `event_financial_ledger.vendor_name` | Live DB has **no** column; app uses description prefix. Optional migration: `docs/sql/2026-07-06_event_financial_ledger_vendor_name.sql` | **deferred** |
| BL-021 | Venue registry & outing SQL phases | Apply / verify: `2026-07-16_venue_registry_*`, `2026-07-04_event_attendance_log_phase8.sql` on all environments | **ready** |
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
| 2026-07-06 | BL-040: return-run leg card fully implemented — per-person boarding roll + context-sensitive drop-off mode
| 2026-07-06 | BL-014: pickup workflow when medication not required during trip |
| 2026-07-06 | Initial backlog — vendor policy, RBAC, §12 test items, schema notes, drift deferrals |
