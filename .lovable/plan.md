# Plan: Emergency Carer & Bus Transport Expansion

## 1. Schema additions (migration)

Add columns required by the spec (raise red toast if missing — but we will create them):

- `carers_registry.is_primary_contact` (boolean, default false)
- `carers_registry.relationship` (text, nullable) — if not already present
- `carers_registry.address` (text, nullable) — if not already present
- `event_roster_bookings.brings_carer` (boolean, default false)
- `event_roster_bookings.carer_id` (uuid, nullable, FK → `carers_registry.id`)
- `event_roster_bookings.carer_transport_required` (boolean, default false)

Partial unique index on `carers_registry (participant_id) WHERE is_primary_contact`
so each participant has at most one primary contact. Standard `GRANT`s on touched
tables.

## 2. Data layer (`src/lib/data-store.ts` + `src/hooks/use-supabase-data.ts`)

- Extend `Carer` interface with `isPrimaryContact`, `relationship`, `address`.
- Extend `RosterBooking` interface with `bringsCarer`, `carerId`, `carerTransportRequired`.
- Add `listCarersForParticipant(participantId)` query helper.
- Add `upsertPrimaryCarer(participantId, payload)` — sets all others to
  `is_primary_contact = false` first, then inserts/updates the primary.
- Map the new booking columns in roster fetch + insert + update payloads.
- New hook: `usePrimaryCarer(participantId)`.

## 3. Participants — Primary Carer section

`care-profile-modal.tsx` (Care Profile tab) and `add-participant-modal.tsx`:

- Add **“Primary Carer & Emergency Network”** card under the address field.
- Fields: Name, Phone, Email, Address, Relationship.
- On save, call `upsertPrimaryCarer` alongside the participant patch in the same
  try/catch (red toast on failure, invalidate `['participants']` + `['carers_registry']`).

## 4. Event Roster modals

`add-roster-booking-modal.tsx` and `edit-roster-booking-modal.tsx`:

- Add two Switches:
  1. **Carer Attending Event?** → `bringsCarer`. When on, show a dropdown
     populated from `listCarersForParticipant(participantId)` with the primary
     carer pre-selected; stored as `carerId`.
  2. **Carer Requires Bus Transport Seat?** → `carerTransportRequired`
     (disabled unless `bringsCarer` is true).
- Persist all three fields in the booking insert/update payload.

## 5. Roster table display (`roster-tab.tsx`)

Under each participant row’s name, when `bringsCarer === true` render:

```
+1 Carer: <carer name>   [🚌 seat] (only if carer_transport_required)
```

Update the header summary “Total Seats Occupied” chip to:

```ts
const totalSeatsOccupied =
  activeBookings.length +
  activeBookings.filter(b => b.carerTransportRequired).length;
```

Apply the same formula anywhere transport capacity is summed (transport list
totals if present — left untouched if not currently bus-aware).

## 6. No-Show Countdown overlay

New component `src/components/attendance/no-show-countdown-modal.tsx`:

- Trigger: a red “Trigger No-Show Countdown” button on each roster row and on
  each attendance row.
- Modal:
  - Big monospaced **MM:SS** clock counting down from 5:00 (uses `setInterval`,
    cleared on close; auto-flashes red in last 60s).
  - Loads `usePrimaryCarer(participant.id)`; displays Name, Relationship,
    Phone in large type.
  - **Click to Call** button → `tel:` link with phone number.
  - Empty-state when no primary carer is on file.

Wire into `roster-tab.tsx` row actions and `attendance-tab.tsx` row actions.

## 7. Cache invalidation

On any mutation success, invalidate the relevant keys:
`['participants']`, `['carers_registry']`, `['event_manifest']`,
`['events']`, `['attendance']`.

## Out of scope

- Bus route assignment UI (only the seat-count formula is updated as requested).
- Push notifications when countdown hits zero (modal stays open, staff dial out).

---

**Files touched**

- new migration (carers/bookings columns + grants)
- new `src/components/attendance/no-show-countdown-modal.tsx`
- edit `src/lib/data-store.ts`, `src/hooks/use-supabase-data.ts`
- edit `src/components/participants/care-profile-modal.tsx`,
  `src/components/participants/add-participant-modal.tsx`
- edit `src/components/events/add-roster-booking-modal.tsx`,
  `src/components/events/edit-roster-booking-modal.tsx`,
  `src/components/events/roster-tab.tsx`
- edit `src/components/attendance/attendance-tab.tsx`

Approve and I’ll implement straight through.
