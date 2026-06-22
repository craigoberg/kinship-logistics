## Goal

Update every PIN entry field across the app (and shared PIN primitives) to use a clean `----` placeholder, and replace silent-fail behaviour with an explicit red error message + thick red border, matching the Section 4.3 required-field tokens.

## 1. Placeholder swap (`••••` → `----`)

Change `placeholder="••••"` to `placeholder="----"` in every PIN input:

- `src/components/auth/pin-reauth-dialog.tsx`
- `src/components/issue-engine/verbal-auth-override-dialog.tsx`
- `src/components/site-day/site-manager-handshake-modal.tsx`
- `src/components/site-day/site-leader-handshake-panel.tsx`
- `src/components/manifest/issue-accumulator-panel.tsx`
- `src/components/manifest/dynamic-operational-form.tsx` (inactive fallback — kept consistent)
- `src/components/dashboard/manager-joint-review-modal.tsx`
- `src/components/medication/medication-admin-modal.tsx`
- `src/components/directory/staff-form-sheet.tsx`
- `src/routes/auth.tsx`
- `src/routes/manifest.tsx`

Only the placeholder string changes; input type, length, masking and validation stay the same.

## 2. Explicit wrong-PIN feedback (no silent fail)

For every PIN entry the same three behaviours apply when `verifyStaffPin` (or `loginWithPin`) returns false / throws an auth error:

- A red helper line renders directly beneath the field: **"Incorrect PIN. Please try again."**
- The input gets the thick red border treatment already used for required fields (`border-2 border-destructive focus-visible:ring-destructive`, matching Section 4.3).
- The error state clears the moment the user taps back into the field and starts typing (cleared in `onChange` / `onFocus`).
- The PIN value itself is cleared on failure so the next keystroke starts fresh.
- A `toast.error` is also fired as secondary feedback (does not replace the inline message).

Components to wire this into (each owns its own mutation — no shared hook is introduced, just consistent local state `pinError: string | null`):

- `PinReauthDialog` — replace the existing generic error text with the standard message and ensure the field renders the destructive border while `pinError` is set.
- `VerbalAuthOverrideDialog` — currently only toasts on PIN mismatch; add inline error + destructive border driven by `pinError`, separate from the `!pinOk` (format) styling.
- `SiteManagerHandshakeModal` and `SiteLeaderHandshakePanel` — currently bubble errors only via toast; add inline message + border.
- `ManagerJointReviewModal`, `MedicationAdminModal`, `IssueAccumulatorPanel` PIN step, `DynamicOperationalForm` (inactive), `manifest.tsx` inline PIN — same pattern.
- `/auth` sign-in (`routes/auth.tsx`) — already renders an inline error; standardise the wording to "Incorrect PIN. Please try again." and apply the destructive border when `error` is set.

## Out of scope

- No change to PIN length, hashing, `verifyStaffPin`/`loginWithPin` RPC behaviour, or lockout policy.
- No new shared component — the pattern is small enough to inline per field.
- No visual redesign beyond the placeholder swap and the error/border treatment.

## Validation

For each PIN surface (Verbal Workaround, Manager Handshake, Leader Handshake, Joint Review, Medication, Manifest inline, Issue Accumulator, PinReauth, `/auth`):

1. Field renders `----` when empty.
2. Submitting a wrong PIN shows the red message + thick red border, fires a toast, and clears the value.
3. Tapping back into the field clears the error and removes the red border.
4. Submitting a correct PIN proceeds with no error state remaining.
