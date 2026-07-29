# Trip day roll calls — operator runbook (BL-064)

**Audience:** Trip leaders, coordinators, QA.  
**Spec:** `docs/architecture/GUARDRAILS.md` §12.5, §12.13.  
**Status:** Behaviour documented 2026-07-21. Multi-day **field** confirmation still pairs with **BL-012**.

---

## Where work happens

| Surface | Role |
|---------|------|
| **Event Manage** (`/events`) | Office: Roster, Itinerary, Trip Days (leader + evening/morning clocks), Trip Report, Finance. **No** floor rolls. |
| **Event Deliver** (`/event-deliver`) | Field: Open location, Check-In, Programme, Morning/Evening rolls, Check-Out, Close day / Close trip. |
| **Manifest** (`/manifest`) | Bus hops: boarding on `event_bus_manifest` via hop boarding panel — **not** a substitute for venue Check-In. |

---

## Single-day outing

1. Event Manage → Trip Days: set **trip leader** (and any day config).
2. **Run this event** → Event Deliver → **Open location** (Manager PIN / venue gates as configured).
3. **Check-In** — event-floor arrival (`event_attendance_log`): expected → checked in / absent / later checked out.
4. **Programme** (if itinerary stops) + **Manifest** hops for bus moves — board passengers on the bus manifest.
5. **Check-Out** → hand to bus / self → **Close trip**.

**No** Morning Roll or Evening Roll tabs on a single-day outing.

---

## Multi-day tour

### Config (Event Manage → Trip Days)

- Per day: trip leader, **Evening roll call** time, **Morning roll call** time (`HalfHourTimeField`, 24h).
- Admin defaults: `default_evening_roll_call_time`, `default_morning_roll_call_time` (System Parameters). New days seed from defaults; unset days can inherit on save.

### Day 1

| Step | Tab / action |
|------|----------------|
| Open | Open location |
| Arrive | **Check-In** (arrival roll) |
| Programme / hops | Programme + Manifest boarding |
| Night | **Evening Roll** (after back at overnight base) → account / absent / defer |
| End day | **Close day** on Evening Roll (when evening complete; may be before clock) |

### Day 2 … N−1

| Step | Tab / action |
|------|----------------|
| Start | Prior day must be closed. Overnight continuity may already check people in — **Check-In** often hidden. |
| Morning | **Morning Roll** — must complete before Programme open / hop release |
| Day | Programme + Manifest |
| Night | **Evening Roll** → **Close day** |

### Final day

| Step | Tab / action |
|------|----------------|
| Morning | **Morning Roll** (if not Day 1) |
| Day | Programme / hops |
| End | **Check-Out** + **Close trip** (no Evening Roll tab) |

---

## Two rolls vs bus boarding (do not mix)

| Concern | Store | UI |
|---------|--------|-----|
| At the venue (temporary centre) | `event_attendance_log` | Check-In / Check-Out |
| On a specific bus hop | `event_bus_manifest` | Manifest hop boarding |
| Evening accountability (hotel) | `event_curfew_log` | Evening Roll |
| Morning accountability | `event_morning_log` | Morning Roll |

Morning and evening logs are **separate** — accounted on evening does not auto-clear morning.

---

## Alerts: Green → Yellow → Red + SMS

While Event Deliver is open and morning/evening tabs apply:

1. Sweep about every **60 seconds**.
2. Deadline = each person’s `expected_accounted_at` (from Config clock, or after defer).
3. **Yellow** shortly after overdue; **Red** after Admin minutes past deadline (default **30**).
4. Red fires **one** manager SMS per person per roll (`red_sms_dispatched_at`). Mock popup: `emitMockSms` / NotificationSimulator. Defer does **not** re-arm SMS.
5. Evening marking / alert pressure waits until the group is **back at the overnight base** (itinerary phase).

### Admin thresholds (`system_parameters`)

| Key | Typical default | Meaning |
|-----|-----------------|---------|
| `default_evening_roll_call_time` | `21:00` | Seed evening clock |
| `default_morning_roll_call_time` | `07:00` | Seed morning clock |
| `event_curfew_red_mins_after` | `30` | Evening Red + SMS |
| `event_morning_red_mins_after` | `30` | Morning Red + SMS |
| `event_curfew_yellow_mins_before` / `event_morning_yellow_mins_before` | `0` | Green lead-in |
| `event_roll_max_defer_minutes` | `120` | Max defer push |

---

## Deferral (BL-085)

- **Anytime on Morning/Evening Roll header:** **Defer all…** (next to Re-sync) whenever anyone is still outstanding — do **not** wait for the Yellow banner (e.g. bus late known early). Leader PIN + reason; pushes Deferred until.
- **Banner** still offers Defer everyone when Yellow/Red is already live; **Manager defer…** on header when any Red outstanding; late-return (not at base) panel still offers group defer.
- Per-person **Defer** on the row for one name.
- **Yellow:** trip leader PIN. **Red:** verbal manager consultation.
- Reason required. Open Yellow may clear when no longer overdue; Red Hub rows stay for review.
- SMS-once rule unchanged.

---

## Hard gates (remember these)

| Gate | Rule |
|------|------|
| Morning → Programme / hop | Cannot open venue stop or release hop until morning roll has no open `expected` rows (vacuous OK if nobody checked in and arrival reconciled). |
| Close day (non-final) | Evening roll complete (or all absent). May close **before** scheduled curfew clock. |
| Open Day N+1 | Day N must be closed. |
| Close trip | Final Check-Out: nobody still checked in. |

Trip morning/evening REDs go to the **Hub**; they must **not** block Day Centre Open Centre.

---

## Code anchors

| Area | Path |
|------|------|
| Deliver tabs | `src/routes/event-deliver.tsx` |
| Arrival | `event-arrival-roll-panel.tsx`, `event-attendance.ts` |
| Morning / evening | `accountability-roll-panel.tsx`, `event-day-ops.ts` |
| Alerts / sweep | `event-roll-alerts.ts`, `event-deliver-roll-alert-banner.tsx` |
| Defer | `roll-call-defer-dialog.tsx` |
| Gates | `event-lifecycle-gates.ts` |
| Hop boarding | `hop-boarding-panel.tsx`, `manifest.tsx` |
| Admin defaults | `tour-roll-call-defaults-panel.tsx` |
| SIM clock | DEV operational clock bar + Deliver day scroller |

SQL seeds: `docs/sql/2026-07-12_tour_roll_call_defaults.sql`, `docs/sql/2026-07-18_event_roll_alert_thresholds.sql`.

---

## Smoke tests

Use a **test build** + **SIM clock**. Hard refresh after clock changes.

### A — Single-day

1. SIM = event date. Confirm/Open event → Event Deliver → Open location.
2. Check-In all expected → Group status reflects all in.
3. If Programme: open stop / release hop; board on Manifest.
4. Confirm **no** Morning / Evening tabs.
5. Check-Out all → Close trip → Trip Report.
6. Confirm no morning/evening roll SMS toasts.

### B — Multi-day Day 1 evening

1. SIM = Day 1 morning. Open location → Check-In all.
2. Programme / hops; return to overnight base.
3. SIM → evening roll time; leave **one** person unaccounted.
4. Within ~1 min: Yellow banner/issue; after Red minutes: Red + **one** mock SMS; later sweeps do **not** re-SMS.
5. Defer group +15–30 → “Deferred until” moves; finish accounting → **Close day**.
6. Confirm Close day blocked while evening incomplete.

### C — Multi-day Day 2 morning → programme

1. Day 1 closed. SIM = Day 2 ~07:00 (or Reset Start of Day). Open Day 2.
2. Morning Roll present; Check-In often hidden after overnight continuity.
3. Leave one outstanding; advance past morning time → Yellow then Red/SMS once.
4. Try open Programme / Release hop → **blocked**; complete morning roll → allowed.
5. Non-final night: Evening + Close day. Final day: Evening gone; Check-Out + Close trip.

---

## Two-tier absent (BL-090)

### A — Still on the trip (not at this activity)

- Programme UserX → `ProgrammeAbsentDialog` (defaults to **Still on the trip**).
- Reasons: Sick · Doesn't want to go · Resting in room / hotel (who with them) · Other.
- Floor stays `checked_in`. **Still on Evening / Morning** to mark Safe.
- **Back to activity** undoes skip (no PIN). Check-Out still needs return transport.

### B — Left the trip (gone home)

- Same dialog → tap **Left the trip**, or Morning/Evening Absent / Check-In Not Attending → full welfare (disposition · plan ≥20 · Yellow/Red · PIN).
- Hub `[LEFT TRIP]`; floor → `absent`; hotel/Check-Out placeholders until **Reinstate**.

### Smoke

1. Mounties: skip as Sick → still on Evening roll → mark Safe.
2. Mounties: Left the trip → evening shows Left trip placeholder; Close day OK with open Yellow Hub.
3. Reinstate Left trip → back on trip for activities / Check-Out.

---

## Known gap (do not treat as pass)

| Item | Notes |
|------|--------|
| **BL-091** Programme completed detail | **Done** — tap completed stop to review times, roll, issues. |

---

## Field test status (BL-012)

| Item | Status |
|------|--------|
| Runbook + smoke steps (this doc) | **Done** 2026-07-21 |
| SIM smoke A/B/C | **Done** 2026-07-21 (chat) — BL-090 / BL-091 hardened after smoke |
| Live multi-day field confirmation | Still open — real tour, not only DEV clock (BL-012) |

When live field-tested, note date + event name in `docs/BACKLOG.md` under BL-064 / BL-012.
