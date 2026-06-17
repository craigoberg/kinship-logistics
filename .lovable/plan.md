# Yada Connect — Global System Engineering Playbook

This is the master execution playbook for every UI and interaction change in
Yada Connect. It is **mandatory** — every new screen, table, form, and
selector must comply with the operational overrides in section 2, regardless
of what any reference codebase shows.

## 1. Visual reference layer — Club Ledger `/events`

Source of truth for visual language: **[Club Ledger](/projects/ebe7f728-5a79-4888-a900-15cdca5bc0ec)**,
primarily `src/pages/Events.tsx` and its supporting components
(`AddBookingDialog`, `AddExpenseForm`, `EventMonthlyGrid`, `EmailReportDialog`,
`MemberCombobox`, `DashboardCalendar`, `EventPrintReport`).

Mirror the following from that codebase:

- **Component framework:** shadcn/ui primitives — `Button`, `Input`, `Label`,
  `Select`, `Dialog`, `AlertDialog`, `Checkbox`, `Switch`, `Textarea`,
  `Progress`, `Tooltip`, `ScrollArea`, `Tabs`, `Table`, `Badge`. Icons from
  `lucide-react` only. Toasts via `sonner`.
- **Page header pattern:** page title left, primary action button anchored top
  right of the section (e.g. Club Ledger's "Add event" button mirrors our
  "Add participant" / "New log" placement — see §2).
- **Filter bar pattern:** a single horizontal row directly under the header
  containing a global `<Input>` search with a leading `Search` icon, plus
  inline `Select`/chip filters (status, category). Match Club Ledger's
  `search` + `statusFilters` + `categoryFilters` + `sortBy` layout.
- **Status badges:** small rounded-full pills, semantic color tokens via
  `hsl(var(--...))` (success / warning / unpaid / overpayment patterns).
  Never hard-coded colors.
- **Cards & tiles:** rounded, soft border, generous padding (`p-4`/`p-6`),
  section headings in `text-sm font-medium` with muted subtitles. Tile P/L
  numbers use semantic success/destructive tokens.
- **Dialogs:** `Dialog` for create/edit, `AlertDialog` for destructive
  confirmation. Footer aligned right with `Cancel` (ghost) + primary action.
- **Spacing rhythm:** `space-y-4` between page sections, `gap-3`/`gap-4`
  within toolbars, `gap-2` inside inline control clusters. Form fields use
  `space-y-2` (Label above Input). Tables use `text-sm` with `py-2` cells.
- **Buttons:** default shadcn variants. Primary actions use `default`,
  secondary use `outline`, destructive use `destructive`, row-level icon
  actions use `ghost` + `size="icon"`.
- **Typography:** Inter body, slightly heavier display for page titles
  (`text-xl md:text-2xl font-semibold tracking-tight`). No serif, no purple
  gradients, no generic SaaS aesthetic.
- **Empty / loading states:** muted text, single sentence, optional inline
  action — matching Club Ledger's terse copy register.

Use this as the **exact visual template** for every Yada Connect screen
(Dashboard, Participants Directory, Care Profile Modal, Transport Logger,
Sync Queue, Add Participant, future modules).

## 2. Strict operational overrides — MANDATORY

These behaviors are required across every Yada Connect view. Apply them even
if the Club Ledger reference does not enforce them.

### 2.1 Form submission gating (dirty-and-valid)

- Every `Submit` / `Save` / `Update` button stays **disabled and visibly
  greyed out** until the form state is **both valid and dirty** relative to
  the initial payload.
- Implementation: prefer `react-hook-form` with
  `formState: { isDirty, isValid }` and `mode: "onChange"`, applied as
  `disabled={!isDirty || !isValid || isSubmitting}`. For forms not using
  RHF, deep-compare the current values against the captured initial payload
  (`JSON.stringify(initial) === JSON.stringify(current)` → disabled).
- Applies to: Care Profile Modal, Add Participant Modal, Transport Form,
  and every future create/edit dialog.

### 2.2 Table layout — Actions column rightmost

- Every data table places its **Actions** column as the final (rightmost)
  column. No exceptions.
- Header cell labelled `Actions`, right-aligned (`text-right`). Body cell
  uses `flex justify-end gap-1`.

### 2.3 Row-level action icons (lucide-react)

Within the rightmost Actions column, use these intuitive icons consistently:

- Undo → `Undo2`
- Reverse → `Repeat2` (or `RotateCcw` for "revert to previous")
- Rollback → `History`
- Edit → `Pencil`
- Delete → `Trash2`
- Retry (sync) → `RefreshCw`
- Discard (sync) → `X`

Render as `Button` `variant="ghost"` `size="icon"` with a `Tooltip` label
describing the action. Icons must always be visible (no hover-to-reveal).

### 2.4 Primary control positioning — top right

- Every page or section's **global management trigger** (e.g. "Add
  Participant", "New Log", "Add Run", "Create…") is anchored at the
  **top right** of the viewport's section header, on the same row as the
  page title.
- Pattern:

  ```tsx
  <header className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 className="...">Section title</h2>
      <p className="text-sm text-muted-foreground">Subtitle</p>
    </div>
    <Button className="gap-1.5"><Plus className="h-4 w-4" /> Add …</Button>
  </header>
  ```

### 2.5 Universal data filtering

- **Every dropdown selector** must include a built-in search/filter input.
  Default to shadcn `Command` + `Popover` (Combobox pattern, like Club
  Ledger's `MemberCombobox`). Plain `<Select>` is forbidden for any list
  longer than ~8 items.
- **Every data table view** must include a global search field above the
  table that filters across **all visible fields simultaneously** (case-
  insensitive substring match against a concatenated row string, or a
  per-column matcher reduced with OR). Search input uses the `Search`
  lucide icon and the same toolbar pattern across the app.
- Filters compose with the global search (AND semantics).

## 3. Compliance checklist (apply before finishing any UI turn)

For every changed screen, verify:

- [ ] Visual language matches Club Ledger `/events` (shadcn primitives,
      spacing, badges, dialog layout).
- [ ] Primary "create / add / new" action is in the top right of its section
      header.
- [ ] Every form's submit button is disabled until `isDirty && isValid`.
- [ ] Every table has Actions as the rightmost column with lucide icons
      and tooltips.
- [ ] Every dropdown of non-trivial length is a searchable Combobox.
- [ ] Every table has a global search input that filters across all fields.
- [ ] No hardcoded colors; only semantic tokens from `src/styles.css`.
- [ ] Toasts via `sonner`; destructive confirms via `AlertDialog`.

This playbook supersedes any earlier guidance in this file. Future turns
must read and honor it before implementing UI changes.

## 4. Status indicator & date/time standards (mandatory)

These rules supersede any earlier color or formatting guidance. They apply to
every screen, table, badge, toast, form field, and chart label.

### Status colors

- Use vibrant, high-contrast semantic tokens only: `bg-success` (bright green
  `#22C55E`), `bg-destructive` (bright red `#EF4444`), `bg-warning` (vibrant
  amber/orange), `bg-info` (clear blue). All four pair with `text-white`.
- Status badges/pills MUST use a solid semantic background + `text-white`.
  Do NOT use tinted variants (`bg-success/10`, `text-success-foreground` with
  light backgrounds, or outline-only badges) for Online/Offline, Success/
  Failed/Pending/Retrying, or alert indicators.
- The Online/Offline sync indicator is `bg-success` (online) / `bg-destructive`
  (offline), always with `text-white`.

### Date & time format

- Dates: `dd-Mmm-YY` (e.g. `17-Jun-26`). Never `MM/DD/YYYY`, never localized
  long form (`Wednesday, 17 June`). Use `formatDate` from `@/lib/utils`.
- Times: 24-hour `HH:MM`, no seconds. Use `formatTime` from `@/lib/utils`.
- Combined timestamps: `dd-Mmm-YY HH:MM` via `formatDateTime`.
- Forbidden: `toLocaleString()`, `toLocaleDateString()`, `toLocaleTimeString()`
  in render output. Always route through the `@/lib/utils` formatters so the
  app stays regionally consistent.
- All timestamp cells/labels use `tabular-nums` for alignment.

## 5. Schedules & Attendance module

- Every Participant profile (`CareProfileModal`) carries 4 tabs in this exact
  order: `Care Profile` · `Medication Scheduling` · `Care & Medication
  History` · `Schedules & Attendance`.
- Tab 4 has two sections:
  - **Section A — Baseline rules**: list of `participant_attendance_schedules`
    rows with a Top-Right `+ Add Operational Schedule` button.
  - **Section B — Historical truth**: searchable table over
    `attendance_roster_logs` with columns Roster date · Expected service ·
    Actual status · Driver notes · **Actions** (rightmost).
- Attendance status badges use `AttendanceStatusBadge` only:
  `Attended → bg-success`, `No-Show → bg-destructive`,
  `Cancelled` / `Sick → bg-warning`, anything else `bg-info`. All pills are
  solid + `text-white`.
- Roster dates render via `formatDate` (`dd-Mmm-YY`).
- Offline attendance edits MUST be enqueued through `enqueue("attendance_log",
  payload)` using the `AttendanceSyncPayload` envelope; the sync worker
  replays via `updateAttendanceLog` and writes an `ATTENDANCE_LOG` row into
  `offline_sync_logs`.
- All attendance editor forms keep `Save changes` disabled until the form is
  both dirty (changed from server state) and not mid-mutation.

## 6. Schema-driven lookups & roster exceptions (mandatory)

### Dropdown sourcing

- Every operational selection list — service types, transport options,
  financial codes, etc. — MUST hydrate from `system_lookup_parameters`
  filtered by `category`. Use `LookupSelect` from
  `@/components/lookups/lookup-select`, or `useLookupParameters(category)`
  directly when you need raw data.
- Canonical category strings live in `LOOKUP_CATEGORIES` in
  `src/lib/data-store.ts`. Add new categories there before reading them.
- Forbidden patterns: literal `string[]` arrays of options inside React
  components, hardcoded `<SelectItem>` lists for operational choices,
  inline `Record<>` fallbacks shadowing a lookup query, and
  `STAFF_DIRECTORY`-style static directories for anything other than dev
  fixtures.
- Allowed exceptions: pure enums whose values are hardcoded in code
  *and* the database (e.g. `AttendanceStatus`, `WeekDay`, sync states),
  IDDSI levels, and dev-only mocks behind a feature flag.

### Canonical sorting law (global — applies to every module)

This rule is **global and inherited automatically** by every current and
future module — including Event Roster lists, Transport Run Sheets,
Finance ledgers, and any new dropdown or table that touches lookups or
weekly operating days. No module may opt out.

- **Lookup queries**: every read through `LookupSelect` /
  `useLookupParameters` / `listLookupParameters` MUST append
  `.order('sort_order', { ascending: true })` by default, with
  `display_name` as the tiebreaker. Administrators control display order
  via the `sort_order` integer column in `system_lookup_parameters`.
- **Calendar / weekly day fields** (Monday → Sunday): MUST sort
  chronologically by the database integer weights
  `1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday,
  7=Sunday`. Never alphabetical, never insertion order. Use
  `dayChronoIndex()` from `src/lib/data-store.ts` as the canonical
  client-side fallback whenever `sort_order` is null or absent.
- Applies to: dropdowns (`<LookupSelect category="operating_days" />`),
  data tables ("Operational Schedules", roster grids, run sheets), and
  any aggregate view that groups by day-of-week.
- Forbidden: `.order('display_name')` alone for `operating_days`,
  `Array.prototype.sort()` with default lexicographic comparison on day
  strings, and hand-rolled day arrays in component files.



### Roster exceptions (sick / cancelled days)

- Temporary "not coming this week / called in sick" changes MUST NOT delete
  or mutate rows in `participant_attendance_schedules`. The recurrence rule
  is the master.
- Instead, insert a single-day row into `attendance_roster_logs` with
  `roster_date = <that date>` and `actual_status` in `{Sick, Cancelled}`.
  Use `MarkAttendanceExceptionModal` or `useInsertAttendanceLog`.
- The Daily Roster engine `resolveDailyRoster(schedules, logs, date)` in
  `src/lib/data-store.ts` expands the recurring schedule for a given date
  and overlays any exception log for that exact `roster_date`. The
  participant automatically reverts to the baseline next week — no cleanup
  job required.
- Never write a "skip next occurrence" flag onto the schedule row.

## 7. Tab Component Template (mandatory)

All multi-step workflows and complex workspace views — including the
Participant Master Profile, Event management, Transport, Finance, and any
future module with more than two tabs — MUST use the shared
`@/components/ui/tabs` primitives without overriding their structural
classes.

Rules:
- The container scrolls horizontally (`overflow-x-auto`) and never wraps.
- Tabs size to their content (`w-max`, `whitespace-nowrap`) — never apply
  `grid grid-cols-*` or fixed widths to `TabsList`.
- Inactive triggers: transparent background, high-contrast `text-foreground`.
- Active triggers: solid teal `bg-tab-active` with `text-tab-active-foreground`
  (defined in `src/styles.css` as `#00BCD4` / white).
- Separation: gap-1.5 between triggers, `rounded-md` per trigger,
  `rounded-lg` border around the list.

Do not hand-roll alternative tab bars; extend this template instead.
