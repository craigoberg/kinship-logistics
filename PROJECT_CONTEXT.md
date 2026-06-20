# PROJECT_CONTEXT.md — YADA Connect Operational Philosophy

> For immutable system rules and schema constraints, refer to **ARCHITECTURE.md**.

This document defines the non-negotiable principles of the YADA Connect system. Every task must align with these rules before any implementation detail is considered.

---

## 1. The Ledger Philosophy

The General Ledger (`public.operational_ledger`) is the single source of truth for all critical state changes.

- **Append-only.** Never update or delete a ledger row. Corrections are new rows.
- **Every state change generates a receipt.** If an action mutates operational state, it must be logged.
- **GPS is mandatory to attempt.** Coordinates may be null if permission is denied, but the attempt must happen.
- **Metadata is evidence.** Every entry carries JSONB context that can stand up to audit.

---

## 2. The Trust Model (Red / Yellow / Green)

| State | Rule |
|-------|------|
| **RED** | Absolute. Hard block. No bypass. No workaround. |
| **YELLOW** | Warning. Logged to ledger. Monitored but non-blocking. |
| **GREEN** | Normal operations. All gates open. |

- RED overrides everything. If any subsystem reports RED, the gate is closed until resolved.
- YELLOW is the early-warning signal. Ignoring it is a failure of the safety model.

---

## 3. Manager-Only Risk Acceptance

Only a Manager can resolve a RED state.

- No staff-level override exists.
- No automated unblocking exists.
- Resolution requires documented justification (e.g. Safety Clearance Notes) and is permanently receipted.
- Double-groundings are treated as one logical grounding; resolving one resolves all pending denials for that asset.

---

## 4. Dashboard Philosophy: "No News is Good News"

The UI is designed around a traffic-light visual language:
- **Green tiles** mean good — the fleet, staff, and schedule are healthy.
- **Yellow tiles** demand attention but do not halt operations.
- **Red tiles** are stop-everything events.

If a dashboard view is entirely green, the Coordinator and Manager can proceed with confidence. Silence is the signal of a well-running day.

---

## 5. Access Model

| View | Purpose | URL / Route |
|------|---------|-------------|
| **Manager Dashboard** | Interactive, secure. Escalation resolution, ledger review, roster changes. | `/manager` (auth-gated) |
| **Wall-View Dashboard** | Read-only, large-format display. For common-area screens. | Separate public route, no auth required. |

No write-capable endpoint is ever exposed on the Wall-View route. It consumes the same data layer but via read-only server functions.

---

## 6. Operational Workflow: Wheelchair Lift Access

Wheelchair lift access follows a **Yellow Flag (Workaround)** model:
1. Staff reports a lift issue.
2. System logs a **YELLOW** entry to the ledger and permits a documented workaround (e.g., manual ramp, alternate vehicle).
3. If the workaround succeeds and the trip completes safely, the entry remains **YELLOW** — no escalation required.
4. If the workaround **fails**, the flag is promoted to **RED** and the standard Escalation Loop begins (see ARCHITECTURE.md §3).

Workarounds are never silent. Every workaround attempt is receipted.

---

## 7. Integration Preference: Microsoft Graph API

All SharePoint document storage is accessed via the **Microsoft Graph API**.
- Vehicle maintenance records, incident reports, and compliance documents live in SharePoint.
- The app uses Graph API read/write endpoints via a workspace connector.
- No local file storage is used for compliance-critical documents.

---

## 8. General Policy: High-Trust / Competency-Verified

Every action in YADA Connect follows a competency-verified model:
- Staff actions are tied to authenticated sessions and GPS receipts.
- Manager overrides are tied to documented justifications in the ledger.
- The system does not trust UI state alone; it trusts the immutable ledger as the source of truth.

---

## 9. UI Conventions: Date & Time Display

All user-visible dates and times render in the **browser's local timezone** via `toLocaleString` (no explicit `timeZone` option) — the browser is the source of truth for timezone.

- Use `<ClientTime iso={...} />` or the `useClientFormattedDate(iso, options)` hook from `src/components/ui/client-time.tsx` for every user-visible timestamp. These render an SSR-safe placeholder on the server / first paint, then swap to the locale-formatted string after mount, eliminating React hydration mismatches.
- **Never** render raw `toISOString()` strings to users — that always reads in UTC and skews the wall-clock display (e.g. AEST appears ~10–11 hours behind).
- Storage stays UTC ISO. All `new Date().toISOString()` writes to Supabase (`updated_at`, `timestamp`, ledger entries, etc.) are correct and unchanged. Only the **display** layer is localized.
- Do not introduce a project-level timezone override or per-user TZ preference unless explicitly requested.

---

## 10. Compliance Governance Engine (registry-driven dashboard)

Every "thing that expires" — vehicle registrations, staff certifications, insurance policies, equipment audits, council inspections — lives in a single table **`public.compliance_assets`** (SQL: `docs/sql/2026-07-06_compliance_governance.sql`).

Each asset carries:
- `category` (drives the dashboard tile it appears under)
- `action_module` (dispatch key — picks the Resolve modal: `vehicle_rego`, `vehicle_service`, `staff_cert`, `formal_audit`, `insurance_renewal`, `generic_resolve`)
- `config` JSONB — RYGE thresholds (`yellow_days`, `red_days`), handshake mode (`single` / `dual`), optional `checklist_category` for formal audits.

**Rules:**
- Adding a new compliance category is a **data-only** change — insert a row with a new `category` value and a dashboard tile lights up. No code change required.
- All CRUD goes through `src/lib/api/compliance-assets.ts` and the Admin → **Governance Hub** tab. Manager-only (`is_manager()`), justification required (min 10 chars).
- Every `INSERT/UPDATE/DELETE` appends a `COMPLIANCE_ASSET_<OP>` row to `operational_ledger` with full `before` / `after` snapshots via the `log_compliance_asset_change` trigger.
- Resolve flows must include `compliance_asset_id` in their ledger metadata so an asset's full lifecycle (created → warned → resolved → renewed) is queryable from one ledger view.

Dashboard tiles consume `useComplianceExceptions()` (registry-driven) alongside the legacy per-source hooks during rollout. Legacy hooks are removed once parity is verified.

---

## 11. Reference

- **ARCHITECTURE.md** — Implementation details, table schemas, escalation loops, module patterns, and enforcement rules.


