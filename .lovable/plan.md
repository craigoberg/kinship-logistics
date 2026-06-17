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
