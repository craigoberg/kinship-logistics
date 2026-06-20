## Smart Seeding + Relative Validation — Vehicle Rego Renewal

Scope: `src/components/dashboard/resolve-vehicle-maintenance-modal.tsx` only. No API/ledger changes.

### 1. Parse current expiry from subject

`subject.previousValue` already carries the current rego expiry (ISO string) for `flagKind === "rego"`. Add a memo:

```ts
const currentExpiry = useMemo<Date | null>(() => {
  if (!subject || subject.flagKind !== "rego") return null;
  if (typeof subject.previousValue !== "string") return null;
  const d = new Date(subject.previousValue);
  return Number.isFinite(d.getTime()) ? d : null;
}, [subject]);
```

### 2. Smart seed — current_expiry + 1 year

In the existing subject-init `useEffect`, pre-fill `newExpiry` for renewals:

- If `currentExpiry` exists → seed `newExpiry = currentExpiry + 1 year`.
- Else (no current expiry, e.g. brand-new asset) → seed `newExpiry = today + 1 year` as a safe fallback.

Field remains fully editable (Calendar picker untouched) so the Manager can override for 3-month / 6-month registrations.

### 3. Relative validation — `newExpiry > current_expiry`

Replace the "must be after today" rule for the renewed branch:

- `dateInvalid` for renewed becomes: `newExpiry <= (currentExpiry ?? today)`.
- Inline error message updates to: *"New expiry must be after the current expiry (DD/MM/YYYY)."* — falls back to "after today" wording when there is no current expiry on file.
- Helper text under the field updates to mention the rule and the 1-year smart default.

`deferred`, `serviced`, and `actionDate` (≤ today) rules are unchanged.

### 4. Audit integrity

No ledger schema change. `action_date`, `new_expiry_date`, and `created_at` continue to be written as three distinct timestamps. The only behavioural shift is *which* lower-bound the expiry must clear — that bound is still strictly monotonic (you can never resolve a flag with an expiry ≤ the one currently on file), so the dashboard's forward-looking compliance scan is preserved.

### Files

- `src/components/dashboard/resolve-vehicle-maintenance-modal.tsx` — add `currentExpiry` memo, seed `newExpiry` in init effect, update `dateInvalid`, update inline error + helper copy.
