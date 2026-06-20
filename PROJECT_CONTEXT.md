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

## 4. Reference

- **ARCHITECTURE.md** — Implementation details, table schemas, escalation loops, module patterns, and enforcement rules.
