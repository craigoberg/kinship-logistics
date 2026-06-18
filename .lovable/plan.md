## Goal

Add an in-row "Give Dose" execution button to the Expected Routines table in the Care Profile modal, with a dual-witness sign-off sub-modal. Sign-offs write to `compliance_audit_logs` (shared with the existing dashboard widget and Care History tab) so the green "Completed HH:MM" chip and dashboard green state flip in lock-step.

## Scope

Files touched:
- `src/components/medication/give-dose-modal.tsx` (new)
- `src/components/participants/care-profile-modal.tsx` (extend `SchedulingTab`)
- `src/lib/data-store.ts` (one helper, `insertDualWitnessAdministrationLog`)
- `src/hooks/use-supabase-data.ts` (one hook, `useGiveDose`)

No SQL migration. No schema change.

## 1. Row-level status detection

In `SchedulingTab`, call `useTodaysComplianceLogs()` and, for each row, find a log where:
- `participantId === schedule.participantId`
- `metadata.medication_name` (case/trim insensitive) matches `schedule.medicationName`
- `actionPerformed` is one of `MEDICATION_ADMIN`, `MEDICATION_ADMIN_QUICK`, `MEDICATION_ADMIN_DUAL` (the new action tag)

Helper lives in `give-dose-modal.tsx` and is reused by the dashboard widget later if needed.

## 2. In-row UI

In the Actions cell, before Edit / Archive:

- No log today → solid blue button `<Button className="bg-blue-600 text-white hover:bg-blue-700">Give Dose</Button>` with a Syringe icon. Click sets `giveDoseTarget = schedule`.
- Log exists today → green chip `<span className="bg-success text-white …">✓ Completed HH:MM</span>` (HH:MM from the log timestamp). Non-clickable, with a `title` of "Already administered today — open Care History for details".

Refused / Missed entries also count as "completed for today" so the row does not nag again — chip shows `Refused HH:MM` / `Missed HH:MM` in amber instead of green.

## 3. Sub-modal — `GiveDoseModal`

New file `src/components/medication/give-dose-modal.tsx`. Props: `{ open, onOpenChange, schedule, participantName }`.

Layout:

```text
┌── Medication Administration Verification ──────────┐
│  Administering Paracetamol — 500mg                 │
│  to Jane Doe at 14:32                              │
├────────────────────────────────────────────────────┤
│  Administered By  [Select staff ▾]                 │
│  Witnessed By     [Select staff ▾]                 │
│  Status           [Administered ▾]                 │
│  Notes (only if Status = Refused) [textarea]       │
├────────────────────────────────────────────────────┤
│  [Cancel]                [Confirm & Sign Off]      │
└────────────────────────────────────────────────────┘
```

Validation:
- Both staff dropdowns required, must be different.
- Status required (default `Administered`).
- If status is `Refused`, notes textarea is mandatory (min 10 chars). For `Administered` / `Missed`, notes are optional.

"Administered By" default: blank (no current-user concept in the app yet — confirmed).

## 4. Database write

New helper in `src/lib/data-store.ts`:

```ts
export interface DualWitnessAdministration {
  scheduleId: string;
  participantId: string;
  medicationName: string;
  dosage: string;
  scheduledTime: string;
  administeredById: string;
  administeredByName: string;
  witnessedById: string;
  witnessedByName: string;
  status: "Administered" | "Refused" | "Missed";
  notes?: string;
}

export async function insertDualWitnessAdministrationLog(
  input: DualWitnessAdministration,
): Promise<void> {
  const { error } = await supabase.from("compliance_audit_logs").insert({
    participant_id: input.participantId,
    action_performed: "MEDICATION_ADMIN_DUAL",
    witness_1_identity: input.administeredByName,
    witness_2_identity: input.witnessedByName,
    timestamp: new Date().toISOString(),
    metadata: {
      schedule_id: input.scheduleId,
      medication_name: input.medicationName,
      dosage: input.dosage,
      scheduled_time: input.scheduledTime,
      administered_by_id: input.administeredById,
      witnessed_by_id: input.witnessedById,
      status: input.status,
      notes: input.notes ?? null,
      source: "care_profile_give_dose",
    },
  });
  if (error) throw error;
}
```

`metadata.schedule_id`, `administered_by_id`, `witnessed_by_id`, and `status` capture the structured fields requested without needing a schema migration.

## 5. React Query wiring

New hook `useGiveDose` in `src/hooks/use-supabase-data.ts`:

```ts
mutationFn: insertDualWitnessAdministrationLog
onSuccess:
  qc.invalidateQueries({ queryKey: ["compliance_audit_logs"] })   // covers "today", per-participant, and any future variants
  qc.invalidateQueries({ queryKey: ["participants"] })
onError: toast.error("Sign-off failed", {
  description: err.message,
  className: "!bg-red-600 !text-white !border-red-700",
  duration: 12_000,
})
```

The shared `["compliance_audit_logs", "today"]` invalidation immediately flips the dashboard widget's traffic-light to GREEN for that row.

## 6. Out of scope

- No new table, no migration.
- No changes to the existing single-tap dashboard quick-administer flow.
- No changes to `MedicationAdminModal` (the global ad-hoc record button stays as-is).
- No current-user identity system — "Administered By" stays a manual pick per your answer.
