
# Yada Connect — Foundation Plan

A mobile-first PWA for community care service coordination. This plan establishes the workspace baseline: layout, navigation, four core modules with sample data, and offline-ready state primitives. Supabase wiring is deferred to a follow-up turn (per your "structure to accept" wording).

## Design direction

- Clean, clinical, high-contrast. Calm neutral surfaces with a single trust-blue accent and semantic colors for status (success/warn/danger).
- Typography: Inter (body) + a slightly heavier display weight for headings. No purple gradients, no generic SaaS feel.
- Generous tap targets (≥44px), visible focus rings, WCAG AA contrast via semantic tokens in `src/styles.css`.
- Lucide React for all icons.

## Navigation & layout

- `src/routes/__root.tsx` wraps the app in an `AppShell`:
  - **Desktop (≥md):** persistent left sidebar (collapsible) with Dashboard, Participants, Transport Logs, Sync Queue + sync status indicator at bottom.
  - **Mobile (<md):** fixed bottom navigation bar (4 tabs, same destinations), top app bar with title + sync indicator.
- Active route highlighting via TanStack `useRouterState`.
- Routes created: `/` (Dashboard), `/participants`, `/transport`, `/sync`.

## Modules

### 1. Dashboard (`/`)
Overview cards: total participants, today's transport runs, pending sync items, IDDSI alerts. Recent activity list. Quick-action buttons (Log transport, Add participant).

### 2. Participants Directory (`/participants`)
- Searchable, filterable table (name, NDIS ID, care indicators as colored badges: IDDSI level, mobility, allergies).
- Row click → **Care Profile Modal**:
  - Tabs: Overview, IDDSI Matrix, Contacts, Notes.
  - **IDDSI Matrix editor:** two segmented selectors — Liquids (Level 0 Thin → 4 Extremely Thick) and Foods (Level 3 Liquidised → 7 Regular/Easy to chew). Visual color-coded chips per IDDSI spec, with selected level prominent. Save persists to local state (and queues for sync).
- Mobile: list cards instead of table columns.

### 3. Transport & Attendance Logger (`/transport`)
- Large-tap form optimized for drivers in the field:
  - Participant picker (searchable, recent-first).
  - Pickup / Dropoff odometer (number pads).
  - Passenger present toggle, arrival status (En route / Arrived / No-show) as big segmented buttons.
  - Timestamp auto-captured, optional notes.
- Submitted entries appear in a "Today's runs" list below; if offline, marked queued.

### 4. Sync Queue (`/sync`)
- Technical status board listing queued items: type (participant_update / transport_log / iddsi_change), created timestamp, payload preview, status (pending / retrying / failed), manual **Retry** and **Discard** buttons.
- Header shows online/offline state and counts.

## Offline-ready primitives

- `src/hooks/use-online-status.ts` — `navigator.onLine` + `online`/`offline` listeners.
- `src/hooks/use-local-storage.ts` — typed, SSR-safe localStorage state hook.
- `src/lib/sync-queue.ts` — store-and-forward queue API: `enqueue(item)`, `list()`, `retry(id)`, `discard(id)`, persisted to localStorage under `yada.syncQueue.v1`. Stubbed `flush()` that will later call Supabase.
- `src/lib/data-store.ts` — local CRUD over participants/transport logs, persisted to localStorage, seeded with sample data on first load. Designed so a future Supabase adapter slots in behind the same interface.

## Sample data

- ~8 participants with realistic names, NDIS IDs (e.g. `430 123 456`), IDDSI levels, care flags.
- ~5 transport log entries across today/yesterday.
- ~3 queued sync items in mixed states for the Sync Queue view.

## PWA scope

Per PWA guidance, this turn delivers the app structure and offline state primitives only — **no service worker or manifest** is added now (you didn't ask for installability or true offline caching). When you want "Add to Home Screen" or real offline shell caching, that's a separate, focused turn.

## Tech notes

- Stack: TanStack Start (already scaffolded), React 19, Tailwind v4, shadcn/ui (Button, Card, Dialog, Input, Table, Tabs, Badge, Sidebar already present), Lucide React.
- New design tokens added in `src/styles.css` for IDDSI level colors and status colors (semantic, dark-mode aware).
- No backend calls yet; all data flows through `data-store.ts` + `sync-queue.ts` so swapping in Supabase later is a single adapter change.

## Files to create

```
src/components/app-shell.tsx
src/components/app-sidebar.tsx
src/components/bottom-nav.tsx
src/components/sync-indicator.tsx
src/components/participants/participant-table.tsx
src/components/participants/care-profile-modal.tsx
src/components/participants/iddsi-matrix.tsx
src/components/transport/transport-form.tsx
src/components/transport/transport-list.tsx
src/components/sync/queue-table.tsx
src/hooks/use-online-status.ts
src/hooks/use-local-storage.ts
src/lib/sync-queue.ts
src/lib/data-store.ts
src/lib/sample-data.ts
src/lib/iddsi.ts                (level metadata + colors)
src/routes/participants.tsx
src/routes/transport.tsx
src/routes/sync.tsx
```

Files to modify: `src/routes/__root.tsx` (mount AppShell, head meta), `src/routes/index.tsx` (replace placeholder with Dashboard), `src/styles.css` (add tokens).

Approve and I'll build it.
