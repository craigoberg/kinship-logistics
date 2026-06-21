Plan:

1. Update `src/lib/api/site-day-sessions.ts` so `todayIso()` formats the lookup date explicitly as UTC `YYYY-MM-DD`:

```ts
const d = new Date();
const year = d.getUTCFullYear();
const month = String(d.getUTCMonth() + 1).padStart(2, "0");
const day = String(d.getUTCDate()).padStart(2, "0");
return `${year}-${month}-${day}`;
```

2. Leave the existing query shape intact:

```ts
.eq("session_date", date).maybeSingle()
```

This keeps the query aligned to the database `session_date` string/DATE format while avoiding browser timezone/local-date drift.

3. Do not alter tables, RLS policies, phase routing, modal behavior, or other Start of Day components.

4. Keep the current diagnostic log in `day-centre-page.tsx` so the next preview refresh can confirm `sessionQ.data` becomes the existing `open_pending` row.