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

## Remaining field offline (backlog)

| ID | Scope |
|----|--------|
| BL-101 | Event Deliver / Trips floor |
| BL-102 | Manifest walkaround / Start Run |
| BL-103 | Day Centre arrival / Check-In |

## Driver smoke (Alpha)

1. Start Day Centre or event hop run **online** at base.
2. Turn **DEV → Simulate offline ON** (or Airplane Mode) → Depart → Arrive → board/confirm → enter km.
3. Turn simulate offline **OFF** → banner clears; hard refresh — legs match server.
4. With pending outbox (simulate offline, depart once) → try Close Run → blocked until sync.
5. Kill Safari mid-offline, reopen, turn simulate offline OFF → outbox flushes.
6. Maps button still opens Maps with start/end.
