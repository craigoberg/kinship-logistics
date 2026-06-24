
## Audit — every place an SMS is (or will be) dispatched

| # | Source | Trigger | Real channel today | Diagnostic popup today? |
|---|---|---|---|---|
| 1 | `src/routes/api/internal/attendance-sms.ts` → GatewayAPI `/mobile/single` | RED attendance escalation (YELLOW→RED in `client-attendance.ts` sweep, also fires on first-raise if already past RED threshold) | Real, when `LOVABLE_API_KEY` + `GATEWAYAPI_API_KEY` are set; otherwise silently returns `reason: gatewayapi_not_configured` | None |
| 2 | `src/components/manifest/dynamic-operational-form.tsx` `handleRaiseSev1` | Manifest Sev 1 "broadcast signals + backup SMS to Office Pool" | Placeholder only — toast claims SMS but no real dispatch wired | None |
| 3 | `triggerInspectionAlert(..., 'critical_no_go')` from manifest checklist (`routes/manifest.tsx`, `issue-accumulator-panel.tsx`) | Vehicle inspection critical failure | Mock only — already pops the `NotificationSimulator` smartphone modal | Yes (existing) |

So #1 and #2 currently send (or claim to send) SMS without any visible confirmation. This plan adds one uniform diagnostic popup for both, and proves the hooks exist for every future SMS sender.

## Architecture

Add a single project-wide "mock SMS" event bus that the existing `NotificationSimulator` already on `__root.tsx` subscribes to. Any code path that triggers an SMS — server-resolved or client-fired — calls `emitMockSms(...)` per recipient. Production sends and the popup are independent: real send still goes through GatewayAPI; the popup just observes.

### New file `src/lib/notifications/mock-sms.ts`

```ts
export interface MockSmsPayload {
  recipient: string;        // formatted, e.g. "Operations Manager (+61400000000)"
  body: string;
  source: string;           // 'attendance_red' | 'manifest_sev1' | …
  dispatchedAt: string;     // ISO
  reason?: string;          // 'real_send' | 'gatewayapi_not_configured' | 'placeholder'
  reference?: string;       // pass-through correlation id
}

export function emitMockSms(p: Omit<MockSmsPayload,'dispatchedAt'>): void;
export function useMockSmsListener(h: (p: MockSmsPayload) => void): void;
```

Internal `CustomEvent` name: `lovable:mock-sms`. SSR-guarded with `typeof window !== 'undefined'`.

### Update `NotificationSimulator.tsx`

- Subscribe to the new bus alongside `useInspectionAlertListener`.
- Maintain a small queue (array state) so multiple recipients (e.g. 3 managers) display one after another rather than overwriting.
- Reuse the existing smartphone-shell render; add a small badge showing `source` + `reason` (e.g. "MOCK · gatewayapi_not_configured") so testers can tell at a glance whether the real send actually fired.
- Click-through / Acknowledge advances to the next item in the queue.

### Wire SMS site #1 — RED attendance

- Server route `attendance-sms.ts`: extend its response JSON with `{ recipients, message, reason, reference }` so the client knows exactly what would be sent. Already builds `message` and `recipients`; just include them.
- Client `fireRedSmsPipeline` in `src/lib/api/client-attendance.ts`:
  - On every response (including non-OK and the `gatewayapi_not_configured` short-circuit), iterate `recipients` and call `emitMockSms({ recipient, body: message, source: 'attendance_red', reason, reference })`.
  - Also fire one synthetic popup when the server call itself throws, with `reason: 'pipeline_error'` and `recipient: 'unknown'`, so we never miss a dispatch attempt during testing.

### Wire SMS site #2 — Manifest Sev 1

- In `dynamic-operational-form.tsx` `handleRaiseSev1`, after the existing toast, call `emitMockSms({ recipient: 'Office Pool (managers)', body: <the broadcast text>, source: 'manifest_sev1', reason: 'placeholder' })`. Confirms the hook exists for when this is later wired to a real pipeline.

### Out of scope

- No changes to the real GatewayAPI/Twilio dispatch logic or recipient resolution.
- No change to the existing inspection-alert pipeline (#3) — it already pops the simulator.
- No new env vars, no schema changes.

## Files Touched

- create `src/lib/notifications/mock-sms.ts`
- edit `src/components/ui/NotificationSimulator.tsx` — subscribe to new bus + queue
- edit `src/routes/api/internal/attendance-sms.ts` — return `recipients`, `message`, `reason`, `reference`
- edit `src/lib/api/client-attendance.ts` — emit mock-SMS per recipient inside `fireRedSmsPipeline`
- edit `src/components/manifest/dynamic-operational-form.tsx` — emit mock-SMS in `handleRaiseSev1`
