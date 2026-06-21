## Goal
Render the Walkthrough Issues Register on the Day Centre page as a read-only list. Remove all "Resolve" and "Route to Council Maintenance" buttons from the row cards, which also eliminates the state-updating logic causing the infinite-loop crash.

## Changes

### 1. `src/components/site-day/issues-register-card.tsx`
- **Remove** the `canManage` prop (no longer needed).
- **Remove** the `resolveMut` `useMutation` block (lines 46-56).
- **Remove** the `councilOpen` state and `RouteToCouncilModal` import/instance.
- **Remove** the `useQueryClient` import (only needed for the mutation).
- **Remove** the action button block (lines 113-135):
  - "Route to Council Maintenance" button
  - "Mark resolved" button
- Keep all display-only markup: severity chip, timestamp, council/council-notified/resolved badges, description, and workaround plan.

### 2. `src/components/site-day/start-of-day-panel.tsx`
- **Remove** the `canManage` permission query logic (lines 68-74: `useQuery` for `canManageSystemParameters` and `useMemo` for `getActiveUserProfile`).
- **Update** the `IssuesRegisterCard` mapping (line 209) to drop the `canManage` prop.

### 3. `src/components/site-day/active-day-panel.tsx`
- **Remove** the `canManage` permission query logic (lines 45-51).
- **Update** the `IssuesRegisterCard` mapping (line 198) to drop the `canManage` prop.

## Outcome
- The Issues Register becomes a passive list of RYG notes with no interactive row actions.
- The `Maximum update depth exceeded` infinite loop is permanently resolved because the `useMutation` + `onSuccess` invalidation cycle that was triggering the crash is removed from this view.
- Resolution and governance remain the responsibility of the Governance Hub, as intended.