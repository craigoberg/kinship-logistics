# NDIS Audit Pack (BL-061 / BL-087)

USB-ready evidence dump for Approved Quality Auditors (Practice Standards / duty of care).  
**Not** MYOB claim generation. Outing trips remain non-NDIS for claiming but are included as duty-of-care evidence.

## Date / time display (GUARDRAILS §5.3)

All pack CSVs and PDFs use the app regional formats via `src/lib/audit-pack/format.ts`:

| Kind | Format | Example |
|------|--------|---------|
| Calendar date | `dd-Mmm-yy` | `23-Jul-26` |
| Instant (timestamp) | `dd-Mmm-yy / hh:mm` | `23-Jul-26 / 09:17` |
| Clock-only (roll times) | `HH:mm` 24h | `21:00` |

**Exception:** `02_Day_Centre/attendance_billing.csv` keeps MYOB-style `YYYY-MM-DD` on the Date column so the same builder can feed accounting import.

Trip Report V1 (Event Manage) already uses `formatDate` / `formatDateTime` on screen.

## Where to run it

| Surface | Action |
|---------|--------|
| **Admin → System parameters** | **NDIS Audit Pack** — date range, section toggles, manager PIN → ZIP |
| **Event Manage → Trip Report** | **Trip evidence ZIP** — single-event deep pack (same `03_Trips/` shape) |

## ZIP layout

```text
Yada_AuditPack_YYYYMMDD/
  00_INDEX.pdf
  00_README.txt
  01_Incidents_Complaints/
    register.csv                 # resolvedBy / resolutionNote / noteCount
    notes_timeline.csv           # Hub append/defer/resolve: who, when, text
    resolution_ledger.csv        # governance.issue_resolved receipts
    incidents_summary.pdf
  02_Day_Centre/
    sessions.csv
    attendance_billing.csv
    ledger_slice.csv
    issues.csv                   # Day Centre RYGE + resolution trail
    issue_notes_timeline.csv
    manifest_trips.csv           # §11 non-event transport runs
    manifest_legs.csv            # pickup/drop chain + timestamps
    day_centre_summary.pdf
  03_Trips/
    trips_index.csv
    <YYYY-MM-DD>_<slug>/
      trip_evidence.pdf            # HOME (BL-095) + venue safety (BL-094)
      attendance_timeline.csv      # arrival/return bus run (R1/R2)
      home_completion_matrix.csv   # BL-095 planned vs actual HOME
      venue_safety_baselines.csv   # BL-094 primary/stops + baseline evidence
      venue_open_walkthrough.csv   # BL-070/094 Open ticks from ledger
      venue_reconfirmations.csv    # per-event reconfirm (may be empty)
      boarding_rolls.csv          # event_bus_manifest + busRunCode
      morning_evening.csv
      issues.csv
      issue_notes_timeline.csv
      day_close_matrix.csv
      manifest_trips.csv           # event hops / return buses
      manifest_legs.csv
  04_Compliance/
    assets_register.csv
    compliance_summary.pdf
    ledger_resolutions.csv
  05_Policies_Procedures/
    README.txt                 # stub until BL-092 + SharePoint (BL-051)
  06_Onboarding_Training/
    README.txt                 # stub until BL-065 + BL-051
    Clients/
    Staff/
    Volunteers_Carers/
```

### Evidence trail (required)

Auditors need **implementation evidence**, not just the opening complaint/issue. Each RYGE / incident row should show:

1. Who logged it and when  
2. Workaround / safety plan (if any)  
3. Hub timeline notes (`notes_timeline.csv`) — append, defer, resolve — with staff + timestamp  
4. Final resolution note + who resolved (`resolutionNote` / `resolvedByName`, plus `resolution_ledger.csv`)

If a row has `noteCount=0` and no resolution, that is a real data gap (never Hub-resolved), not a pack omission.

### Manifest (§11)

Yes — you should see manifest evidence:

| Surface | Files | Contents |
|---------|-------|----------|
| Day Centre | `02_…/manifest_trips.csv` + `manifest_legs.csv` | Morning/return runs with `event_id` null |
| Outing | `03_…/manifest_trips.csv` + `manifest_legs.csv` | Event hops / return buses; legs = from→to, boarded, times |
| Outing boarding | `boarding_rolls.csv` | `event_bus_manifest` passenger on-bus status |

Empty manifest files usually mean no `transport_trips` in range for that scope (or only cancelled).

## Document libraries (reserved)

| Folder | Backlog | Status in this ship |
|--------|---------|---------------------|
| `05_Policies_Procedures` | BL-092 | Stub README only |
| `06_Onboarding_Training` | BL-065 (+ BL-051) | Stub README + empty role folders |

Hub compliance certs (`04_`) are **not** policy Word docs.

## Transport HOME completion (BL-095)

Per outing folder:

| File / section | Contents |
|----------------|----------|
| `home_completion_matrix.csv` | One row per attendance: planned vs actual return mode + run, check-out who/when, `homeComplete` yes/no/n/a, incomplete reason, linked return trip id/status, mode/run mismatch flags |
| `trip_evidence.pdf` | Summary counts Complete / Incomplete / N/A + incomplete lines |
| `attendance_timeline.csv` | `arrivalBusRun` / `returnBusRun` short labels |
| `boarding_rolls.csv` | `direction` + `busRunCode` on each boarding row |

Incomplete reasons include `still_with_group`, `never_arrived`, `checkout_missing_return_mode`, `no_return_trip_for_run`, `left_trip_or_absent` (n/a).

## Venue safety (BL-094)

| File / section | Contents |
|----------------|----------|
| `venue_safety_baselines.csv` | Primary + itinerary venues; latest `venue_safety_baseline_signoffs` (who/when/`evidence_ref`) |
| `venue_open_walkthrough.csv` | Each `EVENT_LOCATION_OPENED` for the event — completed `venue_open_checks` labels (BL-070) |
| `venue_reconfirmations.csv` | Rows from `event_venue_reconfirmations` when present (often empty until Confirmed-gate UI) |
| `trip_evidence.pdf` | **Venue safety** section: baselines, walkthrough ticks, reconfirm summary |

Empty walkthrough checklist = high-trust open (Admin left `event_deliver.venue_open_checks` empty). Empty reconfirmations CSV is normal today — not a pack bug.

## Identity modes (BL-093)

| Mode | When to use | ZIP name | Contents |
|------|-------------|----------|----------|
| **Named** (default) | Authoritative archive / on-site sample | `Yada_AuditPack_YYYYMMDD.zip` | Real participant + staff names and UUIDs |
| **De-identified** | Desktop review, consultant laptop, external USB preview | `…_deid.zip` | Stable `P-001` / `S-001` codes (joinable across CSVs); venues, dates, process evidence unchanged |

Toggle: Admin → NDIS Audit Pack **Switch**, and Event Manage → Trip Report **Named ZIP / De-id ZIP**.

**Not scrubbed in de-id (v1):** free-text issue descriptions, Hub notes, ledger `metadata` JSON — may still contain names. README warns. Archive the **named** pack as the evidence of record; de-id is not a second audit.

## Open follow-ups (backlog)

| ID | Gap |
|----|-----|
| BL-092 / BL-065 / BL-051 | Real docs into `05_` / `06_` |

## Code map

| Path | Role |
|------|------|
| `src/lib/audit-pack/build-pack.ts` | Orchestrator + ledger `AUDIT_PACK_EXPORTED` |
| `src/lib/audit-pack/incidents.ts` | `listAuditIncidents` + section |
| `src/lib/audit-pack/day-centre.ts` | Sessions / MYOB billing rows / ledger |
| `src/lib/audit-pack/trips.ts` | BL-087 trip evidence + BL-095 HOME + BL-094 venue safety |
| `src/lib/audit-pack/venue-safety.ts` | BL-094 baselines / walkthrough / reconfirmations |
| `src/lib/audit-pack/identity.ts` | BL-093 Named vs De-id identity book |
| `src/lib/audit-pack/compliance.ts` | Assets + resolution ledger |
| `src/lib/audit-pack/documents.ts` | Policy / onboarding stubs |
| `src/components/admin/audit-pack-workspace.tsx` | Admin UI |

## Live anon read probes (agent, 2026-07-21)

All returned **200** with rows via publishable key: `operational_incidents`, `site_issues_register`, `operational_ledger`, `compliance_assets`, `event_manifest`, `site_day_sessions`, `event_attendance_log`, `event_morning_log`, `event_curfew_log`, `event_bus_manifest`, `transport_trips`.

No SQL migration required for this ship.

## PII

**Named** packs: full participant/staff records — USB or secure portal only; do not email unencrypted.  
**De-id** packs: safer for preview hand-off, but free-text may still identify — still confidential.

## Smoke tests (targeted)

1. Hard refresh → Admin → System parameters → **NDIS Audit Pack**.
2. Leave **Named** → Generate ZIP → PIN → confirm no `_deid` and real names in CSVs.
3. Toggle **De-identified auditor copy** → Generate → `*_deid.zip`; `P-00x` / `S-00x`; README free-text warning.
4. Open ZIP: `00_INDEX.pdf`, trip HOME + venue safety CSVs when a SIM trip is in range.
5. Event Manage → Trip Report → **Named ZIP** / **De-id ZIP** → PIN → single-trip pack.
