# SMS mock popup audit (BL-063)

**Date:** 2026-07-20  
**Goal:** Every outbound SMS path surfaces a preview in `NotificationSimulator` (`__root.tsx`) via `emitMockSms` (`lovable:mock-sms`) and/or `triggerInspectionAlert` (`lovable:inspection-alert`).

Production GatewayAPI sends (when configured) remain on the server routes. The popup is observational and independent of real send success.

---

## Checklist

| Trigger | Client caller | Server route | Mock popup | Source / notes |
|--------|---------------|--------------|------------|----------------|
| Day Centre arrival RED | `client-attendance.ts` → `fireRedSmsPipeline` | `/api/internal/attendance-sms` | **Y** `emitMockSms` | `attendance_red` |
| Day Centre departure RED | `client-attendance.ts` → `fireRedDepartureSmsPipeline` | `/api/internal/departure-sms` | **Y** `emitMockSms` | `attendance_red` (departure) |
| Event morning / evening roll RED | `event-day-ops.ts` → `fireEventRedSms` | `/api/internal/attendance-sms` | **Y** `emitMockSms` | `event_red` — non-OK path hardened 2026-07-20 |
| Manifest pickup cancel (RED verbal) | `transport-pickup.ts` → `cancelTripPickupLeg` | `/api/internal/transport-pickup-sms` | **Y** `emitMockSms` | `transport_pickup_cancel` — requires VerbalConsultationDialog; Hub RED |
| Walkaround / clearance Sev 1 (critical) | `issue-accumulator-panel.tsx` → `triggerInspectionAlert` | *(none — mock only until BL-050)* | **Y** via `lovable:inspection-alert` | Simulator SMS card; Sev 2 = email toast |
| Legacy manifest Sev 1 form | `dynamic-operational-form.tsx` | *(none)* | **Y** `emitMockSms` + inspection alert | **Dead path** — not mounted in active Manifest; keep for archaeology |
| Return-trip unsafe drop | `transport-unsafe-drop.ts` → Hub only | — | **N/A** | No SMS by design — Hub incident / site issue |
| `raiseOperationalEscalation` | `data-store.ts` | External worker (comment only) | **N/A** live | Only called from dead `dynamic-operational-form` |

---

## Fixes delivered with this audit

1. **`cancelTripPickupLeg`** — after `/api/internal/transport-pickup-sms`, emit mock SMS for each recipient (or no-recipients / error placeholders), matching attendance/departure pipelines.
2. **`fireEventRedSms`** — emit on HTTP non-OK and abort before marking `red_sms_dispatched_at` (parity with Day Centre arrival pipeline).

---

## How to smoke

1. Hard refresh with `NotificationSimulator` mounted (test/dev build).
2. **Pickup cancel:** Manifest → cancel a pending pickup → expect mock SMS card (`transport_pickup_cancel`).
3. **Day Centre arrival RED:** SIM clock past red threshold with expected client → mock SMS (`attendance_red`).
4. **Departure RED:** checked-in client past expected departure → mock SMS.
5. **Event roll RED:** multi-day morning/evening overdue → mock SMS (`event_red`).
6. **Walkaround Sev 1:** fail a critical checkpoint on clearance → mock SMS via inspection alert.

---

## Follow-on

- **BL-050** — real SMS provider, env secrets, recipient `system_parameters`, ops runbook.  
- **BL-071** — event late/absent leader SMS (new paths must call `emitMockSms`).
