# Yada Connect — UI Style Guide

**Status:** Living document. **Normative companion:** `docs/architecture/GUARDRAILS.md` §4 (components), §5.3 (dates/times).  
When this guide and GUARDRAILS disagree, **GUARDRAILS wins** until both are updated together.

**Purpose:** One place to answer *“what does Submit look like?”*, *“dropdown or tap list?”*, *“how do we show time?”* — so agents and humans do not invent one-off UI per feature.

---

## How to use this guide

### For humans (Craig)

| You want to… | Do this |
|--------------|---------|
| See what is already decided | Scan **Pattern registry** below |
| Agree a new pattern | Say *“add to style guide”* after a mockup or field test you like |
| Catch up undocumented UI | Run the **Audit backlog** (BL-060) one screen at a time |

### For agents (Cursor)

1. **Before** adding a Submit button, dropdown, date/time control, modal footer, field picker, or mobile dialog — check the **Pattern registry**.
2. If the pattern is **Defined** → use the canonical component and rules; do not improvise.
3. If **TBD** or the use case is not listed → **stop and ask**: *“Is this what you want?”* with a short description or ASCII mock of the control. Do not ship a new variant silently.
4. After user confirms → add a row to **Pattern registry** + **Changelog** in this file (and GUARDRAILS §4 if it is a global primitive).

**Agent rule:** `.cursor/rules/ui-style-guide.mdc`

---

## Design principles (field-first)

1. **High visibility** — solid semantic fills + white text on selected/active field controls (§4.5). Readable in sunlight on bus tablets.
2. **Fat-finger proof** — min ~56px tap targets on operational checklists and rolls; full-width row toggles, not tiny checkboxes (§4.4).
3. **24-hour time** — display `hh:mm`; dates `dd-Mmm-yy`; never raw ISO or 12-hour AM/PM (§5.3).
4. **Required fields scream** — thick red border + live counter until valid (§4.3). Save disabled until compliant (§4.2). **Mandatory on every new form** — see registry row below and agent rule.
5. **Reuse, don’t reinvent** — one canonical component per pattern; extend it if needed, don’t fork.

**Tokens:** `src/styles.css` — vibrant status colours (`--info`, `--success`, `--warning`, `--destructive`) always paired with foreground white on active fills.

### New forms — validation is automatic (locked)

Every **new** Dialog / Sheet / BottomSheet / Save panel must include §4.3 validation in the first ship — not as a follow-up:

| Control type | Use |
|--------------|-----|
| Required multi-line | `CharacterCountedTextarea` |
| Required short text | `CharacterCountedInput` |
| Required date / select / plain Input / tap group | `requiredFieldOutline(invalid)` from `required-field.ts` |
| Primary CTA | `disabled` until all required fields valid |
| Why disabled | Prefer a compact missing-fields list (destructive callout) above the footer |

Silent “button disabled, no red outlines” is a **ship blocker**.

---

## Pattern registry

| Pattern | Status | Canonical component / rule | Use when | Notes |
|---------|--------|---------------------------|----------|-------|
| **New form validation (mandatory)** | **Defined** | GUARDRAILS §4.3 + `CharacterCounted*` + `required-field.ts` | **Every new** Dialog/Sheet/form with required fields | Live red outline while invalid; CTA disabled until valid; missing-list recommended. Agent rule enforces — do not defer. |
| **Dialog footer (save)** | Defined | `DialogFooter` + §4.2 | Any dialog tab with save | Left: `Close` (outline). Right: primary Save, disabled until dirty + valid |
| **Dialog footer (read-only)** | Defined | §4.2 | View-only dialog tabs | Close only (outline), right side |
| **Required multi-line text** | Defined | `CharacterCountedTextarea` | Justifications, anomaly notes | Min 20 chars default; see `MIN_*` constants |
| **Required single-line text** | Defined | `CharacterCountedInput` | Evidence refs | Min 6 chars (`MIN_EVIDENCE`) |
| **Required custom control** | Defined | `required-field.ts` helpers | Date/select wrappers | Same red border + counter contract |
| **Date (calendar)** | Defined | `DatePicker` | Any operator-facing date | Display `dd-Mmm-yy`; storage `YYYY-MM-DD`. Default caption = label + ‹ › |
| **Date of birth** | Defined | `DatePicker` + `getDobDatePickerProps()` | Guest DOB and any DOB field | Month + year dropdowns (`captionLayout="dropdown"`), years newest-first, last 120 years through today, future days disabled. Do not chevron-step decades. |
| **Close event guest archive** | Defined | `archiveGuestParticipantsForEvent` via `promoteEventStatus` | Event Manage → Closed | Silent; toast archived/skipped counts; skip guests still on Open/Confirmed |
| **Day Centre visitor → event guest** | Defined | `PromoteVisitorToEventDialog` + `AddGuestBookingModal` prefill | Visitor card **Add to event…** | Command event pick (Planning/Confirmed/Open, end ≥ today) → Add guest with name/host/note seeded; DOB/emergency/allergies still required |
| **Day Centre Active Day tabs** | Defined | `ActiveDayPanel` Tabs | `/day` active session | Check-In · Activities · Check-Out · Issues — same IA as Event Deliver; `site_day_*` data |
| **Check-off list order** | **Defined** | `sort-participants.ts` — surname A–Z, then given name, then id | Day/Event check-in, roll call, bus boarding, activity, meal, muster tap lists | **Never** re-sort by status after tap — style/badge only. Do not move checked-off people into a second section mid-list. Exception: return boarding may stay route/`legIndex` order. Display name may stay `First Last`. |
| **Clinical flag chips** | Defined | `ClinicalFlagChips` + `clinical-flags.ts` | Day/Event rolls, meal service | Allergy + Diet chips; tap BottomSheet detail; office edits profile |
| **Programme meal activity** | Defined | Itinerary meal stop + `MealServiceRoll` | Event Manage itinerary / Event Deliver Programme | `activity_kind=meal`; no bus hop; light Served/Declined/N/A roll |
| **Time display** | Defined | `formatTime()` / `<ClientTime />` | Showing instants | 24h `hh:mm`, no seconds. Stamps must be SIM-aware (`operationalNowIso`) — GUARDRAILS §5.3 |
| **SIM / operational clock (all date-time work)** | **Defined** | `operationalNowIso()` / `todayLocalIso()` / `useOperationalTodayIso()` | Any feature that uses a date or time | Honour amber SIM TIME. Never `new Date()` for floor stamps or “today”. Ledger `created_at` + outbox `savedAt` may stay wall clock. |
| **Time entry (half-hour + exact)** | Defined | `HalfHourTimeField` | Roll call times, tour defaults | Single `HH:mm` input + clock popup (24h half-hour slots). **Not** separate dropdown + second field |
| **Occurred at (vs Logged at)** | **Defined** | `OccurredAtFields` (`DatePicker` + `HalfHourTimeField`) | Big Red Human/Asset, Log Anomaly, any late-filed issue | Operator when-it-happened; system `created_at` = logged. No future; Hub shows both |
| **Numeric entry (km, odometer)** | Defined | `NumericEntryPad` / `NumericEntryDialog` / `NumericEntryTrigger` | Manifest km, odometer | Sibling to PinPad — not for PIN |
| **PIN capture** | Defined | `PinPad` / `PinEntryDialog` / `PinEntryTrigger` | Login, step-up auth | GUARDRAILS §2.3 — never OS keyboard PIN |
| **Day session login** | Defined | `DayLoginForm` (`day-login-form.tsx`) | Thin Auth gate before PIN (BL-099) | Email + password Inputs (not PinPad); Supabase Auth only; then Operator PIN step |
| **Staff day-login password set** | **Defined** | `StaffFormSheet` section + `setStaffDayLoginPassword` | Edit personnel — set/reset Auth password | Password + confirm Inputs (`requiredFieldOutline`); **Set day-login password** → `PinEntryDialog` manager step-up; server `createServerFn` + service role (create/update Auth user, link `auth_user_id`). Not PIN. Interim until BL-002. |
| **Field single-select (list)** | Defined | `MobileFieldButton` | Vehicle picker, start point, primary choices | Solid fill when selected (§4.5) |
| **Field single-select (compact)** | Defined | `MobileOptionButton` | Enum rows, med status | Same visual contract |
| **Mobile overlay panel** | Defined | `BottomSheet` | Phone dialogs (no-show, options) | Slide up; `max-h-[92dvh]` + `overflow-y-auto` (built into `BottomSheet` / bottom `SheetContent`) |
| **Desktop/mobile dialog** | Defined | `Dialog` / `AlertDialog` | Standard modals | Primitives: `max-h-[90dvh] overflow-y-auto` so footers stay reachable. Sticky header/footer shells override with `overflow-hidden` + inner scroll. `PinEntryDialog` uses bottom sheet on mobile |
| **Issue / anomaly declaration** | Defined | `IssueDeclarationPanel` / `LogAnomalyModal` | RYGE gates | Do not hand-roll severity forms |
| **RED verbal consultation** | Defined | `VerbalConsultationDialog` | RED path | Manager by name; operator PIN only |
| **Manifest sticky CTA** | Defined | Footer pattern in manifest routes | Confirm depart, close leg | Primary action in footer, scroll body free |
| **Office `Select` (shadcn)** | **Defined** | `Select` from `ui/select.tsx` | Admin filters/enums (status, asset type, venue type, manager) | Admin-wide. Field routes still prefer tap lists when ≤6 options (§4.5); long field pickers may use Select (existing exception). |
| **Page-level Submit (non-dialog)** | **Defined** | Inline primary on card/row | Tour roll, site addresses, MYOB, centre-hours row Save | Sticky page footer not required on Admin |
| **Admin date-range export pack** | **Defined** | `AuditPackWorkspace` (+ MYOB sibling pattern) | NDIS Audit Pack ZIP, MYOB CSV | `DatePicker` from/to · section `Switch`es · **Named vs De-id `Switch` (BL-093)** · primary Generate · `PinEntryDialog` step-up · progress text. See `docs/architecture/NDIS-AUDIT-PACK.md` |
| **Event Deliver Open location walkthrough** | **Defined** | `MandatedChecksList` (same as Day Centre Open) | Open location dialog before trip-leader PIN | Admin list `event_deliver.venue_open_checks`; empty = high-trust; PIN disabled until all ticked (BL-070) |
| **Event Deliver pre-open Log Venue Issue** | **Defined** | `FieldActionButton` caution + `EventDayVerbalAnomalyFlow` | Pre-open panel + Open location dialog (Day Centre parity) | Walkthrough fails → venue RYGE (blocks open on RED). Big Red Button = INCIDENT only (does not block open). Pre-open `EventIssuesCard` below location panel |
| **Programme activity Log issue** | **Defined** | `FieldActionButton` caution + `EventDayVerbalAnomalyFlow` (`activityLabel`) | Event Deliver Programme — each **Active** stop card | **Always first** in the expanded card (yellow). Then activity check-in / meal / med, then leave/movement. Same trip-day RYGE path as Log Venue Issue; subject includes stop name. Completed expand always shows **Issues during this activity** (list or empty dashed state). |
| **Programme activity open/complete times** | **Defined** | `opened_at` / `closed_at` via `formatTime` (SIM/`operationalNowIso`) | Programme stop card header + completed summary | Active: **Opened**. Completed header + summary: **Opened · Completed**. Ledger already has `ACTIVITY_OPEN` / `ACTIVITY_CLOSE` / hop finalize. |
| **Programme leave movement picker** | **Defined** | `MobileFieldButton` list → `LeaveMovementConfirmPanel` | Leave for {next} / Close & leave | **Below** check-in. Ask every hop: Bus · Walk · Other · On-site (**plan only**). Confirm panel: embedded **Method** + **Undo** chips (Check-In parity). Bus confirm = Release (Manifest then); Walk/Other/On-site confirm = open next. Never assume bus from DEFAULT/reset. |
| **Admin mandated walkthrough editor** | **Defined** | `MandatedChecksAdminPanel` (Venue Safety template list: Add field / prompt / Yes·No·Required badges / trash) | Day Centre Open/Close + Event Deliver Open + Meal prep lists | Admin → System Parameters; persists string arrays; hidden from raw JSON table |
| **Admin Council email (mailto)** | **Defined** | `CouncilEmailAdminPanel` | Hub / Route to Council escalate | Admin → System Parameters: To, optional From (shared mailbox), subject/body templates. Blank From = operator account. Hidden from raw JSON table. SQL: `2026-07-30_council_email_params.sql` |
| **Meal prep walkthrough (Open meal)** | **Defined** | `MandatedChecksList` on `OpenMealSheet` | Cooked / packed meal open only (Centre + Trip Programme) | Admin key `meal.prep_checks`; empty = high-trust; skipped for takeaway / venue / own food; fridge temp stays on Open Centre |
| **Meal prep PIN attest** | **Defined** | `PinEntryTrigger` + `verifyNamedStaffPin` / `verifyManagerPin` | Open meal cooked/packed seal | Preparer PIN (not day login) OR Manager guest override + justification; PIN success opens; API re-verifies PIN |
| **Meal SFH Manager approval** | **Defined** | `PinEntryTrigger` + `verifyManagerPin` before preparer attest | Open meal when preparer SFH missing/expired | Strict — Manager justification + PIN; then hand tablet to preparer |
| **Medication Give Dose PIN** | **Defined** | `GiveDoseModal` dual PIN or sole-carer PIN + justification | Day Centre + Trip Programme med rounds | Never client witness; sole mode when one carer |
| **Manifest odometer soft-warn** | **Defined** | Caution callout (`CAUTION_CALLOUT_*`) + Accept checkbox / Use suggested | Init start vs last; leg logged vs GPS; Close Run end vs start+Σ | Soft only — no Hub issue. Thresholds `manifest.odo_*`. Fleet Correct odometer = Admin number + justification (BL-096) |
| **Manifest offline / pending sync banner** | **Defined** | `ManifestOfflineBanner` | Active `/manifest` run | Amber when offline; blue while syncing; Retry via `FieldActionButton`; Close Run blocked until outbox empty (BL-082) |
| **DEV/TEST simulate offline** | **Defined** | `Switch` on same amber SIM row as clock (`DevOperationalClockBar`) | `IS_TEST_BUILD` only (DEV + TEST) | Forces `isAppOnline()` false for Manifest outbox QA — not a production control (BL-082) |
| **DEV/TEST lane badge on SIM bar** | **Defined** | Centre label `DEV` / `TEST` from `getAppLaneBadge()` (`VITE_APP_LANE`) | Amber SIM row only | Distinguishes Cursor/DEV host vs Vercel TEST; not a security control |
| **Event bus run (R1/R2)** | **Defined** | `MobileFieldButton` + `eventBusRunOptions` (`event-bus-runs.ts`) | Roster outbound/return run; Check-Out Hand to Rx; Check-In arrival bus | Reuse Admin `bus_runs` codes; event short labels R1/R2/Rx. Day Centre keeps “Run 1” labels. Self clears run code. |
| **Day Centre schedule transport (Self + runs)** | **Defined** | Pill tap row: **Self** first, then Admin `bus_runs` | Participant Directory → Schedules add/edit IN/OUT | Stores `TRN-SELF` or the run code. No general-transport dropdown. Existing self/private/family codes still light Self. |
| **Day Centre default run route** | **Defined** | `PointerSortableList` + run/direction pills (`RunRoutePanel`) | Participants Directory | Office drag order per run + morning/afternoon. Seeds Manifest; driver may still reorder. Same grip as Event Roster. |
| **Day Centre Off today** | **Defined** | `OffTodayExemptionDialog` + outline **Off today** | Participant → Schedules (today's row) **and** Default run routes (column left of live status) | Operational today only. Sick/Cancelled pills + `CharacterCountedTextarea` (20). Recurring schedule stays. Live Manifest skip + driver banner — not driver RED cancel. Route-list buttons share a fixed column so they align down the page. **Exception** stays on every active schedule row (any date). |
| **Care Profile Support & risk** | **Defined** | `SupportPlanTab` + `ClientSupportPlanFields` | Organisational support plan / comms / risk (BL-114) | Care Profile tab **Support & risk**; Client onboarding pack uses the same fields (required). Hub dates reset only on Onboarding Review/Update re-file. |
| **Day Centre run live status** | **Defined** | `RunLiveStatusBadge` from `trip_legs` | Schedules **Run today** + Default run routes | Awaiting PU · Traveling-To · Stopped-At · On-Bus · Off today · Dropped. 24h `HH:mm` under the chip (`ClientTime`) = when that status was set. Office read-only. |
| **Manifest office run notice** | **Defined** | `OfficeRunNoticeBanner` + caution callout | Active `/manifest` Day Centre run | Amber **Office update** + **Seen**. Written when office marks Off today on an open trip. |
| **Floor row embedded method override** | **Defined** | `EmbeddedMethodButton` + `TransportMethodPickerSheet` + big-row confirm (`floor-transport-method.ts`) | Day Centre + Event Deliver **floor** arrival & departure only | Wide row tap = confirm with **current** method (one tap when planned is right). Embedded method chip opens picker that **only saves selection** (does not check-in/out); chip updates; then tap wide row. Defer/clock stays sibling to method chip on Day Centre. Event Manage office unchanged. **Checked-in = hi-vis** solid `bg-success text-success-foreground` (§4.5) — not pale emerald tint. |
| **Event Check-In arrival method** | **Superseded** | Use **Floor row embedded method override** | Event Deliver Check-In | Was BottomSheet-on-Check-In (BL-013). Picker still Bus (Rx) vs Self; finalize is the wide row. |
| **Day Centre Check-In arrival method** | **Superseded** | Use **Floor row embedded method override** | Day Centre attendance roll | Was BottomSheet-on-Check-In. Day Centre chips use Admin displayName (Run 1); Event uses R1/R2. |
| **Checkbox lists (office)** | Deferred (BL-002) | shadcn `Checkbox` matrix | Menu Access | Keep disabled placeholder until RBAC; do not invent a new matrix UI in feature PRs |
| **Toggle / switch** | **Defined (Admin/office)** | `Switch` | Admin booleans (fleet flags, preserve login, bool params) | Field-route operational yes/no may still use `MobileOptionButton` / `Checkbox` — ask if unclear |
| **Admin colour picker** | **Defined** | Native `<input type="color">` | Lookup badge colours | Keep native until a shared palette ships |
| **Admin CMS rich text editor** | **Defined** | `CmsRichTextEditor` (`cms-rich-text-editor.tsx`) | Admin → Public website page body | Visual + HTML tabs. Toolbar: undo/redo, heading, bold/italic/underline, lists, link, image, document, YouTube, table, media library. Insert dialogs: `CharacterCountedInput` + URL outline + missing-fields list. Library is `cms_media` URLs (no upload). Sanitize via `sanitizeCmsHtml` on save and public render. Uploads = BL-119. |
| **Admin lookup edit** | **Defined** | `AdminLookupWorkspace` Edit dialog | Lookups (Day Centre Bus Runs, codes, names) | Actions: **Edit** + **Remove**. Dialog uses `CharacterCountedInput` for code + display name; Save disabled until dirty + valid. Bus run code change cascades assignments (`update_lookup_parameter`) so Manifest / Clients keep the run. |
| **Admin numeric fields** | **Defined** | `Input type="number"` | Roll thresholds, odometer, capacities | `NumericEntryTrigger` remains field-only (BL-055) |
| **Admin registry list** | **Defined** | shadcn `Table` + action column | Fleet, Vendors, Venues | Column layout like Vendors; actions via icon buttons — not whole-row “dead” click chrome |
| **Admin Yes/No (2-option)** | **Defined** | `MobileOptionButton` | Baseline sign-off yes/no | Same compact enum contract as Day Centre |
| **Sheet footer (save)** | **Defined** | `SheetFooter` + §4.2 | Fleet / Venue sheets | Close (outline, left) + Save right; Close never `disabled={pending}` |
| **Icon-only action tooltip** | **Defined** | `IconActionButton` (`ui/icon-action-button.tsx`) | Table/row action icons (Open, Edit, Clone, Archive, Remove…) | Required hover label + `aria-label`. App-wide `TooltipProvider` in `AppShell`. Do not ship bare `size="icon"` actions without a tooltip. Status-only icons (e.g. hoist) may use `Tooltip` without a button. |
| **Event Finance expense row** | **Defined** | `IconActionButton` Edit + Delete + `AlertDialog` confirm; `LogEventExpenseModal` create/edit | Events Manage → Finance | Writable until Closed (`billing_locked`). Locked: banner + no money actions. §4.3 on expense form. |
| **Event Roster payment history** | **Defined** | `BookingPaymentHistory` Edit/Delete + edit dialog; `$` Record payment / Record refund | Events Manage → Roster | Same finance lock. Refund via `RecordRefundMilestoneModal`. Paid balance recomputed from ledger. |
| **Tables (dense data)** | Defined (office) | `Table` | Admin matrices, export views | Field routes + Governance Hub: use card rows |
| **Governance Hub list row** | **Defined** | `HubListCard` + `HubListCardBody` | Human Incidents, Maintenance | Status badge + chevron **pinned top-right**; severity badges left; meta rows below |
| **Hub list issue body** | **Defined** | `parseHubIssueBody` / `HubListCardBody` | Human + Maintenance cards | **Green:** `Issue:` only · **Yellow:** + `Workaround:` · **Red:** + `Authorising manager:` + `Plan:` (always 3 lines; empty → `—`) |
| **Hub Public web voice** | **Defined** | Indigo `Public web` badge + Issue preview | `/public/forms` → Human Incidents | Not an Incident badge. Complaints stay **Yellow**; compliments/enquiries **Green**. Card = **Issue preview only** (~140 chars of the message) — no empty Workaround. Open Manage for full text + ref. |
| **Office manage dialog (multi action)** | **Defined** | `ManageItemShell` | Hub resolve, compliance, maintenance | **Footer** = bottom button bar inside Manage dialog: **Close** (left, outline) + Log Note + Resolve (+ defer/council toggles in body) |
| **RYGE severity chips** | **Defined** | `RYGE_SEVERITY_CHIPS` in `ryge-severity-chips.ts` | Log Anomaly, maintenance add | Green/yellow/red pill selectors — see §RYGE colours below |
| **Trip left-trip / Not Attending** | **Defined** | `TripAbsentDispositionDialog` + `TripReinstateDialog` | Morning/Evening Absent, Check-In Not Attending | Disposition · safety plan ≥20 · Yellow/Red · Leader PIN. Floor → absent. |
| **Programme Absent (mode toggle)** | **Defined** | `ProgrammeAbsentDialog` | Programme activity UserX | Large tap mode: **Still on the trip** (default) vs **Left the trip**. Hydrates skip vs left-trip reason lists. Field / touch-first. |
| **Toast feedback** | **Defined** | `operationToasts` in `operation-toasts.ts` | After save/defer/resolve in Hub manage flows | Standard copy; `sonner` toast |
| **Empty states** | Defined | Dashed border card | No rows in a list | `rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground` — no shared component needed |
| **Field route CTA** | Defined | `FieldActionButton` | Large primary actions on manifest, events, day centre | `h-14 w-full rounded-xl font-bold` — variants: `primary` (blue), `success` (green), `caution` (amber, use `pulse`), `destructive` (red), `secondary` (muted). `fullWidth={false}` for toolbar chips. See `src/components/ui/field-action-button.tsx` |
| **Manager ops toolbar** | **Defined** | `ManagerOpsChip` → `FieldActionButton` solid fills | Emergency / lockdown / infectious / do-not-open / suspend chips **inside** H&S sheet or Start-of-Day | **Never** thin outline on dark UI. Tones: `emergency`=solid red, `caution`=solid amber+black, `neutral`=muted. `layout="chip"` or `stack`. |
| **Big Red → Health & Safety** | **Defined** | `IncidentIntakeDialog` lane 3 → `GlobalHealthSafetyFlow` | Every screen via Big Red | Third lane opens H&S BottomSheet (Emergency · site hold · Infectious). **No** INCIDENT write. **No** duplicate H&S/Emergency chips on Day Centre Active, Event Deliver, or Manifest. Log anomaly / Close / Log Venue Issue stay on primary bars. Start-of-Day **Do not open** may remain on that panel. |
| **Big Red Incident shell (mobile)** | **Defined** | `IncidentIntakeDialog` + `VerbalConsultationDialog`: `BottomSheet` mobile / `Dialog` desktop; sticky Close-left + `FieldActionButton` primary; multi-select lists `min-h-14` solid selected | Phone-first Big Red Human/Asset + RED verbal | Same fields; no wizard. H&S lane already sheets. Filter + tall tap lists (not `Select`) for clients/staff/managers. |
| **Raise ticket (GREEN)** | **Defined** | Green pill `GlobalRaiseTicketDrawer` + `FormTicketChromeButton` on Dialog/Sheet; `RaiseTicketDialog` | App / form problems (TEST + PROD) | Not a Big Red lane. Hub → **App tickets**. Description ≥20; context auto-attached. Hide on PIN / Incident / Raise ticket (`hideTicket`). |
| **Exception Hub App tickets tile** | **Defined** | Existing `StatusTile` in `OperationsExceptionHub` Band 3 | Dashboard inbox for open app tickets | Same tile chrome as Human Issues. 0 rows = green all-clear; any open = warning. Drill **Open in Hub** → `/governance?tab=app_tickets`. Not a new tile visual. |
| **Exception Hub Onboarding review tile** | **Defined** | Existing `StatusTile` in `OperationsExceptionHub` Band 3 | Signed packs inside Admin yellow/red review window | Same chrome. 0 rows = all-clear. Drill **Open in Hub** → `/governance?tab=onboarding`. Thresholds: Admin → System Parameters → Onboarding review windows. |
| **Field multi-option picker** | Defined | `MobileFieldButton` with `badgeWhenIdle` | Start point, return depart point, 3-option layouts | Use `tone="success"` for location pickers; `badgeWhenIdle="Default"` or `"Recommended"` for the pre-selected option. No hand-rolled `optionClass`. |
| **Field select (many items)** | Defined (exception) | shadcn `Select` | Bus run picker, event picker when list > ~6 items | Acceptable exception to tap-list rule when the option set is too long for cards. Field routes with ≤6 options must use `MobileFieldButton`. |
| **Walkaround severity display** | Defined | `SEVERITY_DISPLAY` constant | Walkaround issue chips in `IssueAccumulatorPanel` | Colours match `RYGE_SEVERITY_CHIPS` active state. Also used for ledger text (emoji + label). Do not hand-roll a local `severityChip()`. |
| **Destructive confirm** | Defined | `AlertDialog` | Log out, delete, irreversible actions | Never use browser `confirm()` — always `AlertDialog` with explicit Cancel + destructive Action labels. |
| **Long searchable list picker** | Defined | shadcn `Command` + `CommandInput` | Participant search, long dropdown lists | Acceptable exception to tap-list rule when list is too long for cards. |
| **Boolean confirm (inline)** | Defined | shadcn `Checkbox` | Med bag, unexpected med flag | Yes/no context toggle — not a selector, no need for `MobileOptionButton`. |
| **Departure vector / quick inline choice** | Defined | `BottomSheet` + `MobileFieldButton` rows | Check-out departure method, 2–4 quick options | Slide-up sheet, `tone="neutral"`, immediate action on tap — no persistent selected state needed. |
| **Dialog dismiss during save** | Defined | Always allow Close — no `isPending` guard | All modals | Remove `if (isPending) return` from `onOpenChange`; do not `disabled={busy}` the Close button. |
| **Loading states** | Partial | `Loader2` inline, `Skeleton` | Fetches | Prefer inline spinner on buttons; skeleton for tables TBD |
| **DEV operational clock** | Defined | `DevOperationalClockBar` + `operational-clock.ts` | QA only (`IS_TEST_BUILD`) | Sticky amber bar; sheet with `DatePicker` + exact `HH:mm` (native time input allowed **DEV-only** for minute-precise YELLOW/RED tests). Not for production operator forms. **All date/time code must honour this clock** (GUARDRAILS §5.3). |

---

## Quick reference — buttons

| Context | Variant | Label rules |
|---------|---------|---------------|
| Primary action (save, confirm, depart) | `default` | Verb + object: “Save changes”, “Depart stop”, “Close run” |
| Secondary / escape | `outline` | “Close” in dialogs (not “Cancel”) |
| Destructive confirm | `destructive` | Explicit: “Delete trip day” |
| In-progress | same + `disabled` | “Saving…”, “Verifying…” |
| Icon-only (clock picker, etc.) | `ghost` `size="icon"` | Must have `aria-label` |

**Field routes:** primary CTAs should be large enough to tap (`min-h-11` / `h-11` where manifest already does).

---

## Quick reference — dates & times

| | Format | Example |
|--|--------|---------|
| Date only | `dd-Mmm-yy` | `12-Jul-26` |
| Time only | `hh:mm` (24h) | `21:30` |
| Date + time | `dd-Mmm-yy / hh:mm` | `12-Jul-26 / 21:30` |

**Do not use:** `<input type="date">`, `<input type="time">`, `toLocaleString()` defaults, 12-hour AM/PM.

**Helpers:** `src/lib/utils.ts` (`formatDate`, `formatTime`, `formatDateTime`, `todayLocalIso`).  
**Write “now” / “today”:** `operationalNowIso()` / `useOperationalTodayIso()` — never `new Date()` on floor paths (GUARDRAILS §5.3).

---

## Quick reference — colours (active / selected)

Use Tailwind semantic tokens from `styles.css` — **solid fill + white text**:

| Meaning | Token |
|---------|--------|
| Primary / brand action | `primary` |
| Informational | `info` |
| Success / on-bus / checked | `success` |
| Caution / yellow | `warning` |
| Danger / RED / no-show | `destructive` |

Selected row: `border-2`, `ring-2`, `shadow-md` (see §4.5).

### Caution callouts (tinted banners — not solid fills)

Canonical: `src/lib/ui/caution-callout.ts`. Use for office warnings that must stay readable in **dark mode**.

| Do | Don’t |
|----|--------|
| `text-amber-900 dark:text-amber-100` (title) | `text-amber-950` or `text-amber-900` with no `dark:` |
| `dark:bg-amber-500/20` on panels | Pale `/5` tint + near-black text |
| Solid `bg-warning text-warning-foreground` when the whole control is a caution CTA | Invent one-off brown/orange hex |

Same rule as Manifest `close-run-card` / Hub amber panels: always pair light + dark text classes.

### RYGE severity chips (field + Hub)

Canonical: `src/lib/ui/ryge-severity-chips.ts` — used by `LogAnomalyModal`, maintenance add dialog, etc.

| Severity | Idle (unselected) | Selected (`data-state=on`) |
|----------|-------------------|---------------------------|
| **Green** | `border-green-600/60 bg-green-600/10 text-green-700` | `bg-green-600 text-white` |
| **Yellow** | `border-yellow-500/60 bg-yellow-500/10 text-yellow-700` | `bg-yellow-400 text-black` |
| **Red** | `border-red-600/60 bg-red-600/10 text-red-700` | `bg-red-600 text-white` |

Submit button on Log Anomaly follows `RYGE_SUBMIT_BUTTON_CLASS` (solid fill matching selected severity).

---

## Prohibited interaction patterns

These patterns are **banned app-wide** — do not use in any new code, and remove them when encountered.

| Pattern | Why prohibited | Replacement |
|---------|---------------|-------------|
| **Long-press / hold gestures** | Unreliable on desktop/mouse. No visual affordance — users cannot discover hidden actions. `setTimeout`-based hold is broken by scroll and multi-touch. | Use an explicit visible icon button (e.g. `UserX`, `MoreHorizontal`) that opens a `BottomSheet` or secondary action panel. |
| **Right-click context menus** | Not available on mobile/touch surfaces. Breaks accessibility. Invisible to users who don't know to right-click. | Use explicit visible buttons or `BottomSheet` option lists for secondary actions. |

**Agent rule:** If you encounter `onMouseDown` + `setTimeout` long-press logic, `onContextMenu`, or "Hold for options" hint text anywhere in the codebase, remove it and replace with a visible button before shipping.

---

## BL-060 audit — Governance Hub & RYGE (2026-07-12)

**Reference screen:** Governance Hub — all three tabs use the same **card row** pattern.

### Shipped (user confirmed 2026-07-12)

- **Card rows** — `HubListCard` on Human Incidents, Maintenance, Compliance (replaces table + off-screen Manage button).
- **Whole card opens Manage** — tap/click/Enter/Space; chevron on right; read-only Compliance when `!canManage`.
- **Manage dialog footer** — bottom bar in `ManageItemShell`: **Close** (outline, left) + action buttons (right): Log Note, Resolve, Start Work, etc.
- **Standard toasts** — `operationToasts` for note/defer/resolve across issues, maintenance, compliance.
- **RYGE chip colours** — documented above; shared via `ryge-severity-chips.ts`.
- **Page width** — `/governance` `max-w-6xl`.

### Component inventory (Defined in this flow)

| UI element | Component | Style guide |
|------------|-----------|-------------|
| Hub list (all tabs) | `HubListCard` | Governance Hub list row |
| Severity | `Badge` / RYGE chips | RYGE tokens |
| Category | `Badge` per source colour | Hub category badges |
| Timestamps | `FormattedDateTime` | 24h `dd-Mmm-yy / hh:mm` |
| Filters | shadcn `Select` + `Input` | Office `Select` OK on Hub |
| Tabs | `Tabs` Active / Awaiting / Deferred | — |
| Manage dialog shell | `ManageItemShell` | Dialog footer §4.2 (multi action) |
| Manage dialog footer | `DialogFooter` in `ManageItemShell` | Close left; Log Note + Resolve right |
| Timeline note | `CharacterCountedTextarea` | `MIN_TIMELINE_NOTE` (10) |
| Defer / Council | `Checkbox` + `Input` datetime + `Select` Sev | Office-only |
| Success/error feedback | `operationToasts` | Toast feedback |
| PIN step-up | `PinReauthDialog` | §2.3 |
| RYGE log (field) | `LogAnomalyModal` + `RYGE_SEVERITY_CHIPS` | Issue declaration |
| RED verbal (field) | `VerbalConsultationDialog` | Manager by name; operator PIN |

### Remaining TBD (other modules)

| UI element | Question |
|------------|----------|
| Hub on narrow tablet | Card layout OK at all breakpoints — revisit if horizontal scroll appears |

---

## BL-060 audit — Admin (2026-07-21)

**Reference screen:** `/admin` — Lookups, Fleet, Venues, Vendors, System Parameters, Centre Hours, Menu Access, Backup.

### Decisions locked

| Pattern | Decision | Component / rule |
|---------|----------|------------------|
| Office `Select` | Accept shadcn `Select` Admin-wide for filters/enums | Pattern registry |
| Admin `Switch` | Accept for fleet flags, preserve-login, boolean system params | Pattern registry |
| Menu Access checkbox matrix | Leave as BL-002 placeholder (disabled Checkbox grid) | Do not redesign now |
| Page / panel Save | Inline primary on card/row is OK | Tour roll, addresses, MYOB, centre-hours |
| Sheet footers | Match dialog §4.2 — Close left + Save right | `fleet-asset-form-sheet`, venue form sheet |
| Lookup colour | Keep native `type="color"` | Lookups |
| Venues list chrome | Match Vendors `Table` column layout + action icons | `venues-workspace.tsx` |
| Admin numbers | Unchanged — `Input type="number"` | Not NumericEntry on Admin |
| Baseline Yes/No | Standardize on `MobileOptionButton` | Baseline sign-off |
| Escape labels | **Close** on ordinary dialogs/sheets; **Cancel** only on destructive `AlertDialog` | §4.2 + Destructive confirm |
| Dialog dismiss while pending | Always allow Close — no `disabled={pending}` on escape | All Admin modals/sheets |
| Destructive remove/archive | `AlertDialog` (never instant delete) | Lookups Remove, Vendor Archive |
| Justifications | `CharacterCountedTextarea` / `Input` with min chars | Params, centre hours, venue compliance |
| Maintenance severity chips | `RYGE_SEVERITY_CHIPS` | `maintenance-panel.tsx` |

### Pattern registry additions (Admin)

See registry rows: Office Select, Page-level Submit, Toggle/switch (Admin), Admin colour picker, Admin numeric fields, Admin registry list, Admin Yes/No, Sheet footer (save). Checkbox matrix remains **Deferred (BL-002)**.

---

## BL-060 audit — Day Centre (2026-07-13)

**Reference screen:** `/day` — Start of Day walkthrough → active day → attendance roll → closure.

### Decisions locked

| Pattern | Decision | Component |
|---------|----------|-----------|
| Start of Day primary CTAs (`h-16 w-full`) | Use `FieldActionButton` — same rule as manifest | `start-of-day-panel.tsx` — `success` when ready, `secondary` when blocked; `caution` (amber) for "Log Anomalies" |
| Absence reason picker (6 options, field route) | `MobileOptionButton` tap list — ≤6 options on field routes must use tap list (same rule as manifest) | `adjust-expected-time-modal.tsx` |
| Participant search (Add Attendee) | Accept shadcn `Command` + `CommandInput` — canonical pattern for long searchable lists | Added to pattern registry |
| Boolean confirms in Add Attendee (med bag, unexpected med) | Accept `Checkbox` — boolean confirm is not a selector; does not need `MobileOptionButton` row | Pattern registry |
| Check-out departure method (Bus / Family / Independent) | `BottomSheet` + `MobileFieldButton` rows — matches mobile overlay + tap-list rules | `check-out-popover.tsx` |
| Dialog dismiss while mutation pending | Always allow Close — remove `isPending` guards from `onOpenChange` and Close/Cancel buttons | All site-day modals |
| RBAC gate for `LogAnomalyModal` | `isSignedIn = !!user \|\| !!getActiveUserProfile()` — not `user` only | `active-day-panel.tsx` |
| Manager role check | `isActiveUserManager()` from `data-store` — not ad-hoc `.includes("manager")` string | `day-centre-page.tsx` |
| Severity badges in issue lists | Colours from `RYGE_SEVERITY_CHIPS.activeClass` — no local duplicate constants | `issues-register-card.tsx`, `start-of-day-panel.tsx` |
| Severity chips in `LogAnomalyModal` | Use `chip.activeClass` / `chip.idleClass` directly — no inline ternary branches | `log-anomaly-modal.tsx` |

### Pattern registry additions (Day Centre)

| Pattern | Status | Canonical | Use when |
|---------|--------|-----------|----------|
| **Long searchable list picker** | Defined | shadcn `Command` + `CommandInput` | Participant search, any list too long for cards | Acceptable exception to tap-list rule; doc the list size rationale in component comment |
| **Boolean confirm in modal** | Defined | shadcn `Checkbox` | Med bag required, unexpected med flag — yes/no toggles in context | Not a selector; does not need `MobileOptionButton` |
| **Check-out departure vector** | Defined | `BottomSheet` + `MobileFieldButton` rows | 2–4 departure options at bottom of screen | `tone="neutral"`, no active state — immediate action on tap |
| **Open Centre Check Leader PIN** | Defined | `PinEntryTrigger` + `verifyOperatorPin` in confirm dialog | Declare Site Safe & Open — successful PIN **opens immediately** (no second Confirm tap) |
| **Infectious exclusion / clear to return** | Defined | `InfectiousExclusionSheet` / `InfectiousClearanceSheet` | BL-084 A/A.1 manager declare + Hub clearance | Entry via Big Red → Health & Safety (centre/trip context); if in care → home-safe + Manager PIN; Hub Clear to return; Band 2 tile |
| **Infectious home-safe disposition** | Defined | `MobileFieldButton` outcome classes (`HOME_SAFE_DISPOSITIONS`) | Leaving care when infectious exclude | Family/carer · Staff escorted · Transport/taxi · Other — **not** a logistics plan; optional note |
| **Emergency activate (Drill\|Live)** | Defined | `EmergencyActivateSheet` | BL-084 C manager activate | Entry via Big Red → Health & Safety. Drill\|Live `MobileFieldButton` + Yellow\|Red + `CharacterCountedTextarea` + Manager PIN |
| **Emergency sticky banner** | Defined | `FloorAnnouncementStrip` → `EmergencyOpsBanner` (hub) | Active Drill/Live only | Global AppShell strip on **every** signed-in page while `status=active`. Live = pulsing siren/label; Drill = solid amber. Actions: Open issue → `/governance?issue=`, Muster, Stand down. **Clears on stand-down.** Post-stand-down review = open Health & Safety card on Active (no banner) |
| **Emergency Dashboard floor alert** | Defined | `EmergencyFloorAlert` | Dashboard `/` only | Informational fire-alarm panel (no buttons). Yellow = **STANDBY**; Red = **EVACUATE TO MUSTER POINT**. Live pulses; Drill solid amber. Side menu stays usable. Replaces normal Dashboard tiles while active |
| **Message of the Day strip** | Defined | `FloorAnnouncementStrip` MOTD | Admin `floor_motd` non-empty | Solid sky-500 banner (high contrast on dark UI) on every page when no emergency. Empty/cleared = off. Priority: Emergency > (future Med) > MOTD |
| **MOTD Admin** | Defined | `MotdAdminPanel` | Admin → System Parameters | Text box + Save / Clear → `system_parameters.floor_motd` |
| **Light muster taps** | Defined | `EmergencyOpsBanner` muster sheet | Account for people in care | Yellow/Standby = “light muster”. **Red** = “Evacuate — muster at muster point” + EVACUATE callout; same Expected / Accounted / Missing taps for the care roll (not a whole-site visitor list). Empty roll when activated without Day Centre / trip day context |
| **Emergency stand-down** | Defined | Stand-down sheet in `EmergencyOpsBanner` | Close Drill/Live | Debrief `CharacterCountedTextarea` (≥10) + Manager PIN → Hub debrief + clear banner (issue stays Open) |
| **Site ops declare (do-not-open / lockdown / suspend)** | Defined | `SiteOpsDeclareSheet` | BL-084 B | Entry via Big Red H&S (or Start-of-Day do-not-open chip). Free-text + Yellow\|Red + Manager PIN |
| **Day Centre open-block Resolve** | Defined | `DayCentreBlockingRedResolveButton` → `ManageIssueDialog` | Pre-open RED gate + Start of Day **Cannot open** card (managers) | Lists each blocker with **Resolve** (Hub manage in place). Deferred + resolved + accepted workaround unlock Open Centre. Outline Hub link secondary. |

### Component inventory (Defined in Day Centre flow)

| UI element | Component | Notes |
|------------|-----------|-------|
| Open Day CTA | `FieldActionButton variant="success"` | Disabled + `secondary` until all checks ticked |
| Open Day PIN | `PinEntryTrigger` + `verifyOperatorPin` | Check Leader sign-off; PIN success opens centre |
| Close Centre CTA | `FieldActionButton variant="success"` in closure dialog | Big green “Finalise & sign with PIN”; footer **Close** only (no small blue primary) |
| Close Centre mandated checks | `MandatedChecksList` + `useMandatedCloseChecks` | Same big green ticks as Open; Admin key `site_management.mandated_close_checks`; empty = high-trust close |
| Log Anomalies CTA | `FieldActionButton variant="caution" size="sm"` | Amber — secondary field action |
| Severity badges (lists) | `RYGE_SEVERITY_CHIPS.activeClass` lookup | `issues-register-card`, `start-of-day-panel` |
| Severity chips (modal) | `chip.activeClass` / `chip.idleClass` from `RYGE_SEVERITY_CHIPS` | `log-anomaly-modal` |
| Attendance roll rows | Full-width `button` min-h-[56px] | §4.4 field checklist; not changed |
| Check-out | `BottomSheet` + `MobileFieldButton` | Slide-up 3-option |
| Absence reason | `MobileOptionButton` rows | Tap list, ≤6 items |
| Participant search | shadcn `Command` + `CommandInput` | Searchable long list |
| Boolean confirms | shadcn `Checkbox` | Inline yes/no context |
| Closure justification | `CharacterCountedTextarea` min 20 | Existing |
| Reopen reason | `CharacterCountedTextarea` min 10 | Existing |
| Operator PIN (mark absent) | `PinEntryTrigger` | Existing |
| Manager PIN (reopen) | `PinEntryTrigger` | Existing |
| Day Centre close | `PinReauthDialog` | Existing |
| RED anomaly | `LogAnomalyModal` → `VerbalConsultationDialog` | Existing |
| Dialog dismiss | Always allows Close — no `isPending` guard | Per G5 |
| Infectious exclusion (BL-084 A/A.1) | `InfectiousExclusionSheet` via Big Red H&S | Manager-only; home-safe block when `checked_in` |
| Manager ops toolbar (BL-084) | `ManagerOpsChip` solid fills | Chips inside `GlobalHealthSafetyFlow` / Start-of-Day — not outline ghosts |
| Infectious home safe | Outcome `MobileFieldButton` + `CharacterCountedInput` handover + optional note + Manager PIN | Attests left care; floor checkout / trip absent; no second Hub LEFT TRIP ticket |
| Clear to return (BL-084 A) | `InfectiousClearanceSheet` — attestation vs medical cert `MobileFieldButton` + Manager PIN | Hub Manage issue footer when exclusion active |
| Emergency activate (BL-084 C) | `EmergencyActivateSheet` via Big Red H&S | Manager-only Drill\|Live; free-text why; Yellow\|Red |
| Emergency banner / muster / stand-down | `FloorAnnouncementStrip` + `EmergencyOpsBanner` | Global AppShell strip; Dashboard `EmergencyFloorAlert` |
| Message of the Day | `MotdAdminPanel` + MOTD strip | `floor_motd` system parameter |
| Site do-not-open / lockdown / suspend | `SiteOpsDeclareSheet` | Big Red H&S · Start of Day do-not-open chip |

---

## BL-060 audit — Manifest (2026-07-12)

**Reference screen:** `/manifest` — vehicle select → clearance → start point → active trip → close run.

### Decisions locked

| Pattern | Decision | Component |
|---------|----------|-----------|
| Large field-route CTAs (h-14) | Create `FieldActionButton` shared primitive | `src/components/ui/field-action-button.tsx` |
| Start point / return depart picker | Refactored to `MobileFieldButton` (`tone="success"`, `badgeWhenIdle`) | `manifest.tsx` |
| Bus run / event picker (many items) | Accept `Select` on field routes when list is long — documented exception | Pattern registry |
| Walkaround severity chips | Replace local `severityChip()` with `SEVERITY_DISPLAY` constant (colours = RYGE active state) | `issue-accumulator-panel.tsx` |
| Empty states | Dashed border card — document existing pattern, no new component | Pattern registry |
| Log Out confirm | Replace browser `confirm()` with `AlertDialog` | `manifest.tsx` |

### TBD — remaining manifest questions

| Element | Question / Notes |
|---------|-----------------|
| Return boarding roll passenger rows | Custom tap cards — look like `MobileFieldButton` but are not wired through it. Acceptable for now; revisit if styling drifts. |
| `DynamicOperationalForm` | Inactive legacy form — preserved on disk. Contains conflicting patterns (inline PIN, legacy severity chips, shadcn `Sheet`). Do not mount; remove under GUARDRAILS drift remediation (BL-032). |
| Unexpected med notes `Textarea` | No character count — low risk (operational notes, not public-facing). Accept as-is. |

### RYGE recording paths (for audit traceability)

1. **Day Centre floor** — `LogAnomalyModal` (site-day) → G/Y → register; RED → `VerbalConsultationDialog`
2. **Trip day** — `EventDayVerbalAnomalyFlow` → same pattern + `event_id` context
3. **Manifest / pre-trip** — walkaround accumulation; RED verbal
4. **Hub manage** — `ManageIssueDialog` → note / defer / council / resolve
5. **Automated** — attendance sweep, curfew sweep (YELLOW→RED) — bypass verbal (BL-033 drift)

---

## BL-060 audit — Events (2026-07-13)

**Reference screens:** `/events` (office list) → `ManageEventModal` (hybrid Dialog/Sheet) → Trip Days inner tabs (field floor).

### Decisions locked

| Pattern | Decision | Component |
|---------|----------|-----------|
| Office modal escape buttons | `Close` everywhere (not `Cancel`) — matches §4.2 | All event `Dialog` footers |
| Dialog dismiss while mutation pending | Always allow Close — no `disabled={saving}` on `AlertDialogCancel` | `log-event-expense-modal.tsx` |
| Close outcome picker (orderly / incident) — 2 options, field floor | `MobileFieldButton` tap list — field-route ≤6 options rule | `event-location-panel.tsx`, `event-status-panel.tsx` |
| Trip leader picker (3–8 managers, field floor) | `MobileFieldButton` tap list — list short enough for cards | `day-sessions-tab.tsx` |
| Accountability roll tap targets | `MobileFieldButton` min-h-14 + nested Defer/`UserX` — §4.4 / field person confirm pattern | `accountability-roll-panel.tsx` |
| Departure vector (Bus / Self) at end of event day | `BottomSheet` + `MobileFieldButton` rows — consistent with Day Centre check-out pattern | `event-arrival-roll-panel.tsx` |
| Bus check-on "Mark on bus" per-passenger button | `MobileFieldButton` (selected = on bus) — touch-friendly, consistent with manifest boarding | `bus-check-on-panel.tsx` |
| Severity chips in accountability roll | `RYGE_SEVERITY_CHIPS.activeClass` — no local `severityBadge()` function | `accountability-roll-panel.tsx` |
| Empty state for stops list, trip days list, payment history | Dashed border card + icon — canonical pattern | `itinerary-tab.tsx`, `day-sessions-tab.tsx`, `booking-payment-history.tsx` |
| Office `Switch` for transport/carer (roster modals) | Accept `Switch` — office modal, not field route | `add-roster-booking-modal.tsx`, `edit-roster-booking-modal.tsx` |

### What is already correct (no changes needed)

- All operator-facing dates use `DatePicker`; roll-call times use `HalfHourTimeField`
- No native `<input type="date">` / `<input type="time">`, no `confirm()`, no raw ISO in visible UI
- `PinEntryTrigger` on location open/close
- `BottomSheet` for bus "not travelling" confirmation
- `LogAnomalyModal` / `VerbalConsultationDialog` wired correctly for trip-day RED path
- `ClientTime` / `formatDate` / `formatDateTime` used throughout
- Clone-from-prior-event uses `Command` searchable picker

### Pattern registry additions (Events)

| Pattern | Status | Canonical | Use when |
|---------|--------|-----------|----------|
| **Field select — outcome (2 options)** | Defined | `MobileFieldButton` tap list | Any 2-option binary choice on field floor (orderly/incident, open/close) |
| **Field trip leader picker** | Defined | `MobileFieldButton` tap list | Short staff list (≤8) on field-floor config — not `Select` |
| **Bus boarding per-person toggle** | Defined | `MobileFieldButton` `tone="success"` (selected = on-bus) | Manifest pickup “Passenger on board” + boarding roll rows — green, not `info` blue |
| **Field person confirm + nested absent** | Defined | `MobileFieldButton` (`tone="success"`) + `trailing` `UserX` | Whole name row = Confirm/toggle; **Not attending** sits **inside** the row chrome. **Second tap undoes** confirm → waiting (fat-finger / GUARDRAILS §4.4). Shell `div` + primary button + nested `UserX`. |
| **Departure vector (events)** | Defined | `BottomSheet` + `MobileFieldButton` | Same pattern as Day Centre check-out; 2 options: Bus / Self |
| **Event Deliver trip-day scroller** | Defined | Header under event title: `‹ date / Day N of M ›` chevrons | Multi-day only; switches `event_day_sessions` in Deliver. Test builds also move SIM clock date (keep time). Single-day: date text only. |
| **Event Deliver activity check-in row** | Defined | `MobileFieldButton` + nested `UserX` (`trailing`) | Programme Walk / On-site roll: tap name row = confirmed; **Not attending** inside the Confirm chrome. Same as **Field person confirm + nested absent**. |
| **Programme activity check-in status chip** | **Defined** | Header status button (hi-vis red/green) | Next to **Activity check-in** | Red while any `expected`; solid success green when all accounted. List auto-collapses only when complete; chip toggles expand/collapse (cannot collapse while outstanding). |
| **Programme activity Log issue** | Defined | `FieldActionButton` caution + `EventDayVerbalAnomalyFlow` (`activityLabel`) | Each **Active** Programme stop: Log issue scoped to stop name; completed expand always lists **Issues during this activity** (or empty dashed state) |
| **Programme activity times** | Defined | `opened_at` / `closed_at` + `formatTime` | Active header: Opened. Completed header + summary: Opened · Completed (SIM-aware stamps) |
| **Event Deliver default tab** | Defined | `deriveEventDeliverSuggestedTab` + Group Status current step | Wake → Morning Roll; overnight return → Evening Roll; final day done → Check-Out; Day 2+ hide Check-In when arrival complete |
| **Event Deliver roll-call row** | Defined | `MobileFieldButton` + nested **Defer** + `UserX` (`trailing`) | Morning/Evening: whole name row = **Mark accounted**; **Defer** + **No show** inside. **Second tap undoes** accounted → awaiting (fat-finger / §4.4). Deferred until / Yellow / Red timing unchanged. Notes kept. |
| **Event Deliver roll-call group alert** | Defined | `EventDeliverRollAlertBanner` + `RollCallDeferDialog` (no `participantId`) | Bands use **Deferred until** (`expected_accounted_at`). Grace (muted): no Yellow while before Deferred until. Yellow after Deferred until; Red at Deferred until + Admin `*_red_mins_after` (default 30). Primary **Defer everyone…**; `Group Deferred +Nm until HH:mm — reason` on banner only. |
| **Itinerary overnight hotel cue** | Defined | Caution callout + `BedDouble` Overnight badge | Multi-day non-final nights; hard gate via Confirm/Open (BL-072) |
| **Caution callout (banner/strip)** | Defined | `caution-callout.ts` classes | Non-blocking office warnings (overnight hotel, close-run notes) | **Must** include `dark:` text (`amber-100` / `amber-50`) — never `text-amber-950` / `text-amber-900` alone (unreadable on dark UI) |

### Component inventory (Defined in Events flow)

| UI element | Component | Notes |
|------------|-----------|-------|
| Event list filters (DatePicker) | `DatePicker` | Office — From/To date range |
| Roll call times | `HalfHourTimeField` | Evening / morning rolls |
| Trip leader | `MobileFieldButton` tap list | Field floor, ≤8 managers |
| Close outcome | `MobileFieldButton` tap list | `closed_orderly` / `closed_incident` |
| Arrival check-in button | `Button h-12` full-width | §4.4 pattern |
| Departure handover | `BottomSheet` + `MobileFieldButton` | Slide-up picker; assigned row tap = undo (§4.4) until Close trip |
| Bus boarding row | `MobileFieldButton` selected | On-bus / expected state |
| Activity check-in row | `MobileFieldButton` + `trailing` `UserX` | Confirm = whole row; Not attending nested inside |
| Not travelling | Icon `<button> h-14 w-14` + `BottomSheet` reason | Secondary destructive action (bus hops — sheet for reason) |
| Accountability roll row | `MobileFieldButton` + nested Defer + `UserX` | Full-row Mark accounted; No show opens absent dialog |
| Accountability severity | `RYGE_SEVERITY_CHIPS` | No local `severityBadge()` |
| Manager PIN (location open/close) | `PinEntryTrigger` | Existing |
| RED anomaly (trip day) | `EventDayVerbalAnomalyFlow` → `LogAnomalyModal` + `VerbalConsultationDialog` | §12.6 |
| Empty states | Dashed border card + icon | `itinerary-tab`, `day-sessions-tab`, `booking-payment-history` |

---

Do **not** try to document the whole app in one session. Recommended order:

### Phase 1 — Inventory (agent, read-only)

Walk high-traffic routes and list controls **not** in the registry:

1. `/manifest` — active leg, close run, pickup panel  
2. `/day` — open/close, attendance roll, anomaly modal  
3. `/events` — create modal, trip days, location panel  
4. `/governance` — issue cards, resolve dialog  
5. `/admin` — parameters, venues, backup  

Output: table of *screen → control → current component → Defined/TBD*.

### Phase 2 — Review with user (15–30 min per module)

For each **TBD** row, show a screenshot or describe current behaviour → you say yes/no → agent updates registry + changelog.

### Phase 3 — Lock in agent behaviour

Confirmed patterns get **Defined** status; agents must not ask again for that pattern unless you request a change.

### Phase 4 — GUARDRAILS sync

When a pattern is global (new primitive), mirror a one-line entry into GUARDRAILS §4.1 table so architecture doc stays authoritative.

---

## Changelog

| Date | Pattern | Decision |
|------|---------|----------|
| 2026-08-22 | Admin CMS rich text editor | `CmsRichTextEditor` Visual + HTML; URL/library insert; DOMPurify allowlist; SharePoint upload later BL-119 |
| 2026-08-21 | Admin lookup edit | Edit code + display name in Lookups (not delete/recreate); bus run code cascade keeps client/Manifest assignment |
| 2026-08-21 | Care Profile Support & risk | BL-114 thin org support plan (goals/strengths/needs/comms/risk) on Client pack + Care Profile tab; Hub `client_support_plan` / `client_risk_assessment`; rights/handbook ack on consents |
| 2026-08-20 | Hub Public web voice | Public forms stay in Human Incidents; indigo **Public web** badge (not orange Incident); Issue line = form type + ~140 char message; Yellow complaints skip empty Workaround |
| 2026-08-15 | SIM clock on all date/time work | GUARDRAILS §5.3 — floor stamps and “today” must use `operationalNowIso` / `todayLocalIso`; wall `new Date()` is a defect |
| 2026-08-15 | Care Profile dialog width | Office modal `max-w-6xl` so Schedules Run today + Off today + Exception fit |
| 2026-08-15 | Day Centre Off today + run live status | Schedule-row **Off today** (today only); `RunLiveStatusBadge`; Manifest `OfficeRunNoticeBanner` + `trip_run_notices` |
| 2026-08-15 | Day Centre default run route | Participants Directory `RunRoutePanel` — drag order per run + IN/OUT; Manifest seeds from `bus_run_default_routes` |
| 2026-08-15 | Day Centre schedule transport | Self + bus-run pills only (no Self-Drive / Bus-Pickup dropdown); Self stores `TRN-SELF` |
| 2026-08-09 | Event Finance / Roster money | Expense Edit/Delete + payment history Edit/Delete + Record refund until Closed; `billing_locked` gates UI + `assertEventFinanceWritable` |
| 2026-08-06 | Check-off list order | Surname A–Z via `sort-participants.ts`; status changes style only — no bounce to “Already checked in” / “Handed to transport” sections |
| 2026-08-06 | Muster sheet severity copy | Red → Evacuate/muster-point title + callout; Yellow → standby light muster; empty-roll explains missing Day Centre/trip context — BL-084 |
| 2026-08-06 | Global floor announcements | AppShell `FloorAnnouncementStrip` (Emergency + MOTD); Dashboard `EmergencyFloorAlert` (STANDBY/EVACUATE, info-only); Admin `MotdAdminPanel` / `floor_motd` — BL-084 |
| 2026-08-06 | Overlay vertical scroll | `DialogContent` / `AlertDialogContent`: `max-h-[90dvh] overflow-y-auto`; bottom/side `SheetContent` overflow defaults — footers reachable on short viewports (Manifest / Event Deliver). Sticky shells keep `overflow-hidden` + inner scroll |
| 2026-08-04 | Staff day-login password set | Edit personnel: set/reset Auth password via manager PIN + service-role server fn — interim Alpha (BL-002 later) |
| 2026-08-02 | Big Red mobile shell | Incident + RED verbal: BottomSheet on mobile, sticky File footer, min-h-14 tap lists, stacked severity / Occurred at — touch-first |
| 2026-08-02 | Occurred at vs Logged at | `OccurredAtFields` on Big Red Human/Asset + Log Anomaly; Hub shows both; Human lane structured client(s) + assisting staff (multi) — BL-106 |
| 2026-07-30 | Dialog/Sheet footer Close-left | Migrated save forms to §4.2 Close (outline, left) + primary right; Cancel→Close on ordinary forms; added Close where missing |
| 2026-07-30 | Day Centre open-block Resolve | Manager **Resolve** on pre-open + Start of Day Cannot open blockers; Hub Active includes `awaiting_external`; defer no longer blocks Open Centre |
| 2026-07-30 | Admin Council email (mailto) | `CouncilEmailAdminPanel` — To / From / template; blank From = normal mailto; seed SQL `2026-07-30_council_email_params.sql` |
| 2026-07-29 | Big Red → Health & Safety | Third lane → `GlobalHealthSafetyFlow`; removed Day/Event/Manifest H&S entry chips — GUARDRAILS §13.2 |
| 2026-07-29 | Manager Health & Safety menu | *(superseded)* Was amber chip → sheet; entry now Big Red only |
| 2026-07-29 | Manager ops toolbar | Solid `ManagerOpsChip` (emergency red / caution amber / neutral) — never thin outline for Emergency, lockdown, infectious, do-not-open; TEST stays dashed |
| 2026-07-29 | Emergency B+C MVP | `EmergencyActivateSheet` + sticky banner + light muster + stand-down; `SiteOpsDeclareSheet` do-not-open/lockdown/suspend — BL-084 |
| 2026-07-28 | Day session login | Email + password then PIN on `/auth` — BL-099 thin gate (not full RBAC) |
| 2026-07-27 | Infectious home-safe (A.1) | Centre + Trip entry; in-care → disposition taps + handover + Manager PIN (outcome not route); not-in-care → exclude only — BL-084 |
| 2026-07-27 | Infectious exclusion / clear to return | Day Centre + Hub BottomSheets; Manager PIN; Health & Safety Hub area; Band 2 tile — BL-084 Phase A |
| 2026-07-29 | DEV/TEST lane badge | Centre `DEV`/`TEST` on amber SIM bar from `VITE_APP_LANE` |
| 2026-07-27 | DEV/TEST simulate offline | Same amber SIM row as clock (single strip) — BL-082 QA |
| 2026-07-26 | DEV simulate offline | `Switch` on DEV bar → `simulated-offline.ts` — BL-082 QA |
| 2026-07-26 | Manifest offline banner | `ManifestOfflineBanner` + Close Run blocked while outbox pending — BL-082 mid-run Alpha |
| 2026-07-26 | Day Centre tabs + meals + clinical chips | BL-100 Check-In/Activities/Check-Out; BL-076 chips; BL-073 meal stops + service roll; Activities med round |
| 2026-07-26 | Event Check-In row density | Checked-in: single row name+time + `min-h-11` Method/Undo chips (no full-width Undo + duplicate R1 badge) |
| 2026-07-26 | Meal prep walkthrough | `MandatedChecksList` on Open meal (cooked/packed); Admin `meal.prep_checks` — BL-073 |
| 2026-07-26 | Meal prep PIN attest | Preparer step-up PIN (walk tablet) or Manager guest override — BL-073 |
| 2026-07-26 | Guest archive + promote | Close event archives guests (skip if other live booking); Day Centre **Add to event…** → Command pick → Add guest prefill |
| 2026-07-26 | Date of birth picker | `getDobDatePickerProps()` — month/year dropdowns on canonical `DatePicker` (no decade of month chevrons) |
| 2026-07-26 | New form validation (mandatory) | §4.3 on every new Dialog/Sheet — CharacterCounted* / requiredFieldOutline + CTA disabled; silent disable-only is a ship blocker (agent rule) |
| 2026-07-26 | Floor row embedded method override | Wide row confirms current method; embedded chip opens picker that only updates selection — Day Centre + Event floor in/out (not Manage) |
| 2026-07-23 | Event bus run R1/R2 | `MobileFieldButton` + `eventBusRunOptions` — roster / Check-Out / Check-In override — BL-069 |
| 2026-07-23 | Manifest odometer soft-warn | Caution callout + Accept / Use suggested; Close Run prefill start+Σ; Fleet Correct odometer — BL-096 |
| 2026-07-23 | Event Deliver pre-open Log Venue Issue | Caution CTA on panel + Open dialog; issues card before open; RED blocks PIN (Day Centre parity) |
| 2026-07-23 | Admin mandated walkthrough editor | `MandatedChecksAdminPanel` — Venue Safety template–style list (no JSON) for Day Centre Open/Close + Event Deliver Open |
| 2026-07-26 | Day Centre Check-In arrival | Superseded by floor embedded method row (was BottomSheet-on-tap) |
| 2026-07-26 | Event Check-In arrival method | Superseded by floor embedded method row (was BottomSheet-on-Check-In) |
| 2026-07-26 | Audit Pack Named vs De-id | Admin + Trip Report `Switch` for BL-093 identity mode (default Named) |
| 2026-07-23 | Event Deliver Open walkthrough | `MandatedChecksList` + `event_deliver.venue_open_checks` before trip-leader PIN — BL-070 |
| 2026-07-21 | Admin Audit Pack export | `AuditPackWorkspace` — DatePicker range, section Switches, Generate + PinEntryDialog (MYOB sibling) — BL-061/087 |
| 2026-08-09 | Programme Active card stack order | Top → bottom: yellow **Log issue** → activity check-in → leave/movement (“How do you get to…”) |
| 2026-08-09 | Programme change bus plan before Release | Superseded — all leave methods use confirm panel |
| 2026-08-09 | Programme leave confirm + Undo chips | All methods plan then confirm; embedded Method + Undo (Check-In style); bus Manifest only on Release |
| 2026-08-09 | Floor check-in hi-vis green | Event + Day Centre checked-in rows: solid `bg-success` / white text (§4.5) — replace pale emerald tint |
| 2026-08-09 | Programme activity check-in collapse | Red/green status chip; auto-collapse when all accounted; chip expands list again |
| 2026-08-07 | Programme leave movement ask + Other | Ask Bus/Walk/Other/On-site every hop; `movement_method` NULL until chosen; Other = non-bus public transport; SQL `2026-08-07_venue_stop_movement_ask_other.sql` |
| 2026-08-07 | Programme activity Log issue + times | Active card caution **Log issue** (`EventDayVerbalAnomalyFlow` + activity label); completed header **Opened · Completed**; issues section always on completed expand (empty state) |
| 2026-07-21 | Programme completed activity | Completed stops expand read-only (times, method, roll, issues) — BL-091 |
| 2026-07-21 | Event Deliver Open location PIN | PIN success opens immediately — no second Open tap (same as Day Centre); warnings stay on panel before dialog |
| 2026-07-21 | Morning/Evening Defer all | Header **Defer all…** next to Re-sync whenever outstanding &gt; 0 — proactive, not only Yellow banner |
| 2026-07-21 | Icon-only action tooltips | `IconActionButton` + AppShell `TooltipProvider`; all registry/row icon actions get hover labels (Open/Edit/Clone/Archive etc.) |
| 2026-07-21 | Admin audit (BL-060 Phase 5) | Office Select + Switch; inline panel Save; sheet Close+Save; Venues Table like Vendors; native colour; Admin `type=number`; Yes/No → `MobileOptionButton`; Cancel only on destructive AlertDialog; counted justifications |
| 2026-07-20 | Close Centre mandated checks | Same tick list as Open; Admin `site_management.mandated_close_checks`; gates Finalise |
| 2026-07-20 | Close Centre CTA | Big green `FieldActionButton` = Finalise & PIN; dialog footer Close only |
| 2026-07-20 | Open Centre Check Leader PIN | PIN success opens centre immediately — no second Confirm & Open tap |
| 2026-07-20 | Open Centre Check Leader PIN | Confirm dialog requires `PinEntryTrigger` / `verifyOperatorPin` |
| 2026-07-20 | Check-Out return transport undo | Tap assigned person again → back to awaiting assignment (§4.4); blocked after Close trip |
| 2026-07-20 | Fat-finger undo on confirm rows | Second tap on Accounted/Confirmed returns to awaiting with Defer/No show again (§4.4) |
| 2026-07-20 | Event Deliver roll-call row | Morning/Evening match activity: full `MobileFieldButton`; Defer + No show (`UserX`) nested inside |
| 2026-07-20 | Field person confirm + nested absent | `MobileFieldButton.trailing` — Not attending `UserX` inside Confirm row; Programme activity check-in uses this |
| 2026-07-20 | Event Deliver trip-day scroller | Multi-day header `‹ date ›` under title; field nav across trip days; SIM date sync in test builds |
| 2026-07-19 | Event Deliver roll Deferred until | Banner follows pushed deadline; grace strip until Deferred until; Yellow then Red = until + Admin red mins; further defers push Red |
| 2026-07-19 | Event Deliver roll-call group alert | Banner **Defer everyone…**; `Group Deferred +Nm — reason` on banner only; row **Defer** = one person; removed panel “Defer outstanding…” |
| 2026-08-19 | Raise ticket (BL-116) | Green FAB + form Ticket chip; Hub App tickets tab; dedicated `app_tickets` — not Maintenance / Incidents |
| 2026-08-21 | Onboarding review Dashboard tile | Band 3 `StatusTile`; Review due → Hub `?tab=onboarding`; Admin yellow/red days |
| 2026-08-19 | App tickets Dashboard tile | Band 3 `StatusTile` (existing chrome); open items → Hub `?tab=app_tickets` |
| 2026-07-19 | Event Manage vs Deliver | Field floor only in Deliver; Manage Trip Days = config; Run this event CTA; overnight Close day after Evening Roll |
| 2026-07-18 | Manifest Passenger on board | `MobileFieldButton tone="success"` (green) — aligned with on-bus / checked token; not `info` blue |
| 2026-07-18 | Caution callout contrast | `caution-callout.ts` — dark-mode safe amber banners; forbid `text-amber-950` alone |
| 2026-07-21 | Programme Absent mode toggle | `ProgrammeAbsentDialog` — Still on trip (default) vs Left trip; large `MobileOptionButton`s |
| 2026-07-21 | Activity skip vs Left trip | `ActivitySkipDialog` (still on trip) vs `TripAbsentDispositionDialog` (gone home) |
| 2026-07-21 | Trip left-trip Absent (BL-090) | `TripAbsentDispositionDialog` / `TripReinstateDialog` — disposition + plan + PIN; read-only Absent placeholders |
| 2026-07-18 | Itinerary overnight hotel | Non-final multi-day nights must end at Hotel / accommodation; caution callout + Overnight badge; Confirm/Open hard block |
| 2026-07-18 | Event Deliver roll-call rows | Match Check-Out cards; Mark accounted + small Defer to the right |
| 2026-07-18 | Event Deliver default tabs | Journey-driven from Group Status; Day 2+ hide Check-In after overnight arrival |
| 2026-07-16 | DEV operational clock | App-wide Sydney date+time override for multi-day / YELLOW·RED QA; `IS_TEST_BUILD` only |
| 2026-07-12 | Hub list issue body lines | Green/Yellow/Red structured lines; status pinned right; Maintenance matches Human |
| 2026-07-12 | Governance Hub card rows | `HubListCard` on all 3 tabs; no off-screen Manage button |
| 2026-07-12 | ManageItemShell footer | Close (outline, left) + actions right; footer = bottom bar of Manage dialog |
| 2026-07-12 | RYGE severity chips | `ryge-severity-chips.ts` — green/yellow/red pill colours documented |
| 2026-07-12 | Hub toasts | `operation-toasts.ts` — standard success/error copy |
| 2026-07-12 | Governance Hub list | Whole row opens Manage; dense 4-col table; max-w-6xl |
| 2026-07-14 | Prohibited interaction patterns | Long-press/hold and right-click context menus banned app-wide; `event-arrival-roll-panel` migrated to explicit `UserX` icon button |
| 2026-07-13 | Events audit (BL-060 Phase 4) | Trip leader + outcome picker → `MobileFieldButton` tap list; bus boarding → `MobileFieldButton`; departure → `BottomSheet`; accountability row height 56px; RYGE chips unified; Cancel → Close across event modals; dashed empty states |
| 2026-07-12 | Manifest audit (BL-060) | `FieldActionButton` (field CTA); `MobileFieldButton.badgeWhenIdle`; picker refactor; `SEVERITY_DISPLAY`; `AlertDialog` for confirm; empty state + field `Select` exception documented |
| 2026-07-12 | Style guide created | Consolidated from GUARDRAILS §4–§5.3; ask-first agent rule |
| 2026-07-12 | `HalfHourTimeField` | Single HH:mm field + half-hour clock popup — not dropdown + separate exact field |
| 2026-07-07 | `MobileFieldButton` / high-contrast selection | §4.5 locked — solid fills, no pale tint-only selected state |
| 2026-07-07 | `BottomSheet` | Mobile-first slide-up for field dialogs |
| 2026-07-07 | `NumericEntryPad` | Km/odometer — separate from PIN pad |
| 2026-07-07 | Modal footer §4.2 | Close left / Save right; Save disabled until dirty + valid |

---

## Related files

| File | Role |
|------|------|
| `docs/architecture/GUARDRAILS.md` §4, §5.3 | Normative build rules |
| `.cursor/rules/ui-style-guide.mdc` | Agent ask-first enforcement |
| `docs/BACKLOG.md` BL-060 | Style guide audit tracker |
| `src/styles.css` | Colour tokens |
| `src/lib/ui/required-field.ts` | Required field styling helpers |
| `src/components/ui/embedded-method-button.tsx` | Floor method chip inside big row |
| `src/components/ui/transport-method-picker-sheet.tsx` | Method picker (selection only) |
| `src/lib/ui/floor-transport-method.ts` | Floor method selection helpers |
