## Plan: make deferrals move correctly and display local time consistently

1. **Fix the timezone conversion**
   - Treat the `datetime-local` field as the operator’s intended local time.
   - Store the actual UTC ISO value internally, but display defer times using the same local `dd-mm-yy/hh:mm` timeline format.
   - Replace note text like `[DEFERRED until 2026-06-26T23:00]` with `[DEFERRED until 26-06-26/09:00]: note`.

2. **Make Deferred list work for every Hub source**
   - Update the unified issue feed so `incident`, `escalation`, and `renewal` deferrals are recognised from `hub_issue_notes.metadata.deferred_until`, not just `site_issues_register.status = deferred`.
   - Exclude currently-deferred issues from the Active list until their deferred time has passed.
   - Include those same issues in the Awaiting / Deferred list while the deferral is still in the future.

3. **Keep Day Centre compatibility**
   - Continue writing `site_issues_register.status = deferred` and `deferred_until` for Day Centre issues.
   - Also read central timeline deferrals so all sources behave consistently.

4. **Improve invalidation after Log Note & Update**
   - Ensure both Active and Awaiting / Deferred query caches refresh immediately after a defer, so the row moves lists without a manual refresh.

5. **Validate the fix**
   - Check the source logic for active/awaiting partitioning.
   - Verify the displayed note format matches the timeline stamp format and no longer shows raw UTC `T23:00` values.