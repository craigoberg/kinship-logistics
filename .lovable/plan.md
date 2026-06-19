## Why the screen flashes back to Initialize

The mutation succeeds, but the page-level check `useActiveTrip()` only returns a trip when its row has `status = 'active'`.

In `startTrip` (`src/lib/data-store.ts` line 2497) the insert does not set `status`, so the DB default kicks in and the new row lands with `status = "Not Started"` (confirmed in the network log response). The active-trip query (`getActiveTripForDriver`, line 2415) filters `.eq("status", "active")`, finds nothing, and `ManifestPage` re-renders `InitializeTripScreen`. That is exactly the "Opening… → back to the same screen" behaviour, with no console error because the insert itself succeeded.

A second, related inconsistency: the insert writes the odometer into the legacy `start_odometer` column only. The newer `start_odometer_km` column (the one `getLastEndOdometer` and downstream UI prefer) stays null.

## Fix

Edit the `transport_trips` insert in `startTrip` (`src/lib/data-store.ts` ~line 2497) to explicitly set:

- `status: "active"` — so `getActiveTripForDriver` finds the newly-created trip and the manifest screen swaps to `ActiveTripScreen`.
- `start_odometer_km: input.startOdometerKm` — mirror the value into the canonical column alongside the legacy `start_odometer` write that's already there.

No other code changes. No DB migration. The `trip_legs` insert path is unchanged (the previous SQL migrations you ran already cover `leg_type` and `sequence_order`).

## Verification

1. Pick the Disco event, accept the populated odometer, click **Start Daily Trip**.
2. Expect the page to swap to the leg-by-leg `ActiveTripScreen` and a "Daily run started" toast.
3. Confirm in network tab: the POST to `transport_trips` response now shows `"status":"active"` and `"start_odometer_km":1000`.
