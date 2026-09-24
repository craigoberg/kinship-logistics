# TEST structure sync order (DEV → TEST)

Goal: same **schema** on DEV and TEST (data may differ).

## Run on TEST (SQL Editor → Run All, in order)

| # | File | What |
|---|------|------|
| 1 | `2026-08-05_test_align_dev_columns.sql` | Missing tables, ADD COLUMN, DEFAULT, NOT NULL, enums |
| 2 | `2026-08-05_test_align_dev_constraints.sql` | CHECK / UNIQUE / FK / indexes (re-run OK) |
| 3 | `2026-08-05_test_fix_unvalidated_fks.sql` | Only if unvalidated FKs remain |
| 4 | `2026-08-05_test_align_dev_enums_funcs_triggers.sql` | Exact enums, RPCs, triggers, EXECUTE grants |
| 5 | `2026-08-05_test_align_dev_rls.sql` | Replace all public RLS with DEV policy set |

“Success. No rows returned” is normal for each DDL file.

## Validation (expect rows)

```sql
-- Enums (expect 3)
SELECT typname FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e'
ORDER BY 1;

-- Critical RPCs (expect 4)
SELECT proname FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND proname IN ('verify_operator_pin','is_manager','set_system_parameter','list_backup_tables')
ORDER BY 1;

-- Triggers (expect 16)
SELECT count(*) AS trigger_count FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal;

-- RLS policies (expect 167)
SELECT count(*) AS policy_count FROM pg_policies WHERE schemaname = 'public';

-- Columns (~817) + FKs + zero unvalidated
SELECT count(*) AS col_count FROM information_schema.columns WHERE table_schema = 'public';

SELECT count(*) AS fk_count FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public' AND c.contype = 'f';

SELECT rel.relname, c.conname FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public' AND c.contype = 'f' AND NOT c.convalidated;
-- expect 0 rows
```

## Note on DEV RLS quirks (matched on purpose)

DEV has some **authenticated-only** write policies (`centre_operating_hours` write, `system_operational_settings`, `transport_requests`). Matching DEV means PIN/anon may hit those same limits on TEST. If Alpha needs anon writes there, we patch with a targeted grant/policy after smoke — do not invent looser policies during this sync.

## Generators / dumps

| Dump | Path |
|------|------|
| columns | `docs/architecture/dev-schema-dumps/columns.json` |
| constraints / indexes | `…/constraints.json`, `…/indexes.json` |
| enums | `…/enums.csv` |
| policies | `…/policies.csv` |

| Generator | Script |
|-----------|--------|
| columns | `scripts/generate-test-align-dev-columns.mjs` |
| constraints | `scripts/generate-test-align-dev-constraints.ps1` |
| RLS | `scripts/generate-test-align-dev-rls.mjs` |
