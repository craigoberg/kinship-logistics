# Manifest mid-run offline (BL-082 Alpha)

**Shipped 2026-07-26.** Web IndexedDB outbox — not a native app. Maps deep-link unchanged.

## What works offline (after Start Run online)

- Depart / Arrive (+ GPS stamps)
- Leg confirm (present, km, med bag fields that patch the leg)
- Hop boarding: on bus / not travelling
- UI keeps the active trip from a durable snapshot

## Online only

- Walkaround clearance + Start Run / Start hop
- Close Run (PIN + RED + odometer)
- Cancel pickup, RED verbal, unsafe drop, SMS

## Code

| Piece | Path |
|-------|------|
| Outbox + snapshot | `src/lib/manifest-offline/` |
| Hook | `src/hooks/use-manifest-offline.ts` |
| Banner | `src/components/manifest/manifest-offline-banner.tsx` |
| Close Run gate | `src/components/manifest/close-run-card.tsx` |

## DEV: Simulate offline (no Airplane Mode)

On `IS_TEST_BUILD` only (DEV and TEST), the amber **SIM** strip is one row: tap left for clock · **Offline** `Switch` on the right.

- **ON** → app treats the device as offline (`isAppOnline()` / `useOnlineStatus()`). Manifest mid-run writes go to the IndexedDB outbox. Label shows `· OFFLINE`.
- **OFF** → normal online behaviour; pending outbox auto-flushes when the switch clears (real network still required to reach Supabase).

Code: `src/lib/simulated-offline.ts` · control on `DevOperationalClockBar`.

**Not a secret:** `VITE_SHOW_TEST_TOOLS` / `VITE_APP_LANE` are public Vite flags in `.env` (see `.env.example`). Until BL-099 PROD exists, published `*.lovable.app` DEV also shows these tools. Future PROD: set `VITE_IS_PRODUCTION=true`.

## Force-start before Release (2026-10-16)

While Manifest can reach the server it stores today’s venue hops and who is expected on each one (checked-in clients, carers with them, checked-in support).

On **Not released to the bus yet**, the driver can tap **Start this leg anyway**:

- Last-known names on the tablet → confirm, then mark each person on the bus or not travelling. A name that was not on the list can be added; the office confirms it from the activity log.
- No names on the tablet → **System offline. Write who is on the bus on the paper roll for this leg and start?** That sheet is the headcount and is filed against this trip and this leg.

The upload creates or matches **one** hop trip and applies the marks. A later Release joins that trip. Activity log action `EVENT_HOP_FORCE_STARTED`. Procedure for the policy pack: `docs/architecture/OFFLINE-BUS-HEADCOUNT.md`.

## Remaining field offline (backlog)

| ID | Scope |
|----|--------|
| BL-101 | Event Deliver / Trips floor |
| BL-102 | Manifest walkaround / Day Centre Start Run still open. Unreleased **venue hop** force-start is built (above). |
| BL-103 | Day Centre arrival / Check-In |

## Driver smoke (Alpha)

1. Start Day Centre or event hop run **online** at base.
2. Turn **DEV → Simulate offline ON** (or Airplane Mode) → Depart → Arrive → board/confirm → enter km.
3. Turn simulate offline **OFF** → banner clears; hard refresh — legs match server.
4. With pending outbox (simulate offline, depart once) → try Close Run → blocked until sync.
5. Kill Safari mid-offline, reopen, turn simulate offline OFF → outbox flushes.
6. Maps button still opens Maps with start/end.
