## Goal
Make the "Start Daily Trip & Open Manifest" button activate immediately on page load whenever a valid event is selected AND a reasonable odometer value is present — no extra keystroke required.

## Diagnosis
In `src/routes/manifest.tsx` (`InitializeTripScreen`), the button is gated by:

```ts
const isButtonDisabled = !eventId || !odo || parseFloat(odo) <= 0 || startTrip.isPending;
```

Two reasons it stays disabled on first load even though the KM box looks filled:

1. **`eventId` is empty unless exactly one event matches today.** Auto-select only fires when `todaysEvents.length === 1`. If there are 0 or 2+ events today, the dropdown shows the full list but nothing is selected, so the button stays gray until the user picks one — and once they pick + the KM is pre-filled, *typing* in KM is what they notice "fixing" it (actually it was the event pick or focus shift).
2. **`odo` hydration race.** `useLastEndOdometer()` resolves after mount; the `useEffect` does call `setOdo(Number(lastEndOdo).toString())`, but only when `lastEndOdo != null`. If the query returns `0`, `undefined`, or the user already typed something, hydration is skipped. Also, if `lastEndOdo` arrives as a string `"48210"`, `Number(...).toString()` is fine — but if the query key changes and re-fires, the effect will clobber user input.

## Changes (single file: `src/routes/manifest.tsx`, `InitializeTripScreen` only)

1. **Auto-select the first event when none is chosen**, not just when exactly one matches today:
   ```ts
   useEffect(() => {
     if (eventId) return;
     const pool = todaysEvents.length ? todaysEvents : events;
     if (pool.length > 0) setEventId(pool[0].id);
   }, [eventId, todaysEvents, events]);
   ```
   This guarantees `eventId` is populated as soon as event data is available, matching the dropdown's visible default.

2. **Harden odometer hydration** so it runs once when data arrives and doesn't overwrite user edits:
   - Track a `hasHydratedOdoRef = useRef(false)`.
   - In the effect: if `!hasHydratedOdoRef.current && lastEndOdo != null && odo === ""`, call `setOdo(String(lastEndOdo))` and flip the ref to `true`.

3. **Add a "reasonable value" guard** to the disabled check (as requested by "assuming the value is reasonable"):
   ```ts
   const odoNum = odo === "" ? NaN : Number(odo);
   const odoReasonable = Number.isFinite(odoNum) && odoNum > 0 && odoNum < 10_000_000;
   const isButtonDisabled = !eventId || !odoReasonable || startTrip.isPending;
   ```

4. No changes to submit logic, validation copy, or the rest of the file. No backend changes.

## Verification
- Hard refresh `/manifest` with no active trip → button is enabled immediately if events exist and a previous closing odometer is on file.
- Clear the KM field → button disables.
- Type a non-numeric / zero / absurd value → button stays disabled.
- Pick a different event from the dropdown → button stays enabled.
