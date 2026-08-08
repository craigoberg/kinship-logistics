# Generates docs/sql/2026-08-05_test_align_dev_constraints.sql from DEV catalog dumps.
# Input: docs/architecture/dev-schema-dumps/{constraints,indexes}.json

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dumpDir = Join-Path $root "docs\architecture\dev-schema-dumps"
$outPath = Join-Path $root "docs\sql\2026-08-05_test_align_dev_constraints.sql"

$constraints = Get-Content (Join-Path $dumpDir "constraints.json") -Raw | ConvertFrom-Json
$indexes = Get-Content (Join-Path $dumpDir "indexes.json") -Raw | ConvertFrom-Json

$constraintNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($c in $constraints) { [void]$constraintNames.Add($c.constraint_name) }

$sb = New-Object System.Text.StringBuilder

function Add-Line([string]$line) {
  [void]$sb.AppendLine($line)
}

Add-Line "-- ============================================================================"
Add-Line "-- 2026-08-05 - TEST: align public constraints + indexes to DEV"
Add-Line "--"
Add-Line "-- SOURCE: DEV catalog dumps in docs/architecture/dev-schema-dumps/"
Add-Line "--   constraints.json  (pg_constraint + pg_get_constraintdef)"
Add-Line "--   indexes.json      (pg_indexes)"
Add-Line "--"
Add-Line "-- APPLIES: CHECK / UNIQUE / FOREIGN KEY (skip PRIMARY KEY - bootstrap already has PKs)"
Add-Line "--          + non-constraint indexes (partial uniques, btree helpers)"
Add-Line "-- SAFE: idempotent (IF NOT EXISTS / pg_constraint name checks)"
Add-Line "-- FKs: added NOT VALID so orphan rows do not abort the script; VALIDATE at end"
Add-Line "--      (NOT VALID still enforces on new writes)."
Add-Line "--"
Add-Line "-- After run: Success / No rows returned is normal for DDL."
Add-Line "-- Use validation queries at bottom (expect row counts)."
Add-Line "-- ============================================================================"
Add-Line ""
Add-Line "CREATE EXTENSION IF NOT EXISTS `"pgcrypto`";"
Add-Line ""

# --- CHECK + UNIQUE ---
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line "-- 1) CHECK + UNIQUE constraints"
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line ""

foreach ($c in $constraints) {
  if ($c.type -notin @("c", "u")) { continue }
  $name = $c.constraint_name
  $table = $c.table_name
  $def = $c.definition
  Add-Line "DO `$`$"
  Add-Line "BEGIN"
  Add-Line "  IF NOT EXISTS ("
  Add-Line "    SELECT 1 FROM pg_constraint"
  Add-Line "    WHERE conname = '$name'"
  Add-Line "      AND conrelid = 'public.$table'::regclass"
  Add-Line "  ) THEN"
  Add-Line "    BEGIN"
  Add-Line "      ALTER TABLE public.$table"
  Add-Line "        ADD CONSTRAINT $name $def;"
  Add-Line "    EXCEPTION WHEN OTHERS THEN"
  Add-Line "      RAISE NOTICE 'SKIP constraint % on %: %', '$name', '$table', SQLERRM;"
  Add-Line "    END;"
  Add-Line "  END IF;"
  Add-Line "END `$`$;"
  Add-Line ""
}

# --- FOREIGN KEYS ---
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line "-- 2) FOREIGN KEY constraints (NOT VALID)"
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line ""

foreach ($c in $constraints) {
  if ($c.type -ne "f") { continue }
  $name = $c.constraint_name
  $table = $c.table_name
  $def = $c.definition
  Add-Line "DO `$`$"
  Add-Line "BEGIN"
  Add-Line "  IF NOT EXISTS ("
  Add-Line "    SELECT 1 FROM pg_constraint"
  Add-Line "    WHERE conname = '$name'"
  Add-Line "      AND conrelid = 'public.$table'::regclass"
  Add-Line "  ) THEN"
  Add-Line "    BEGIN"
  Add-Line "      ALTER TABLE public.$table"
  Add-Line "        ADD CONSTRAINT $name $def NOT VALID;"
  Add-Line "    EXCEPTION WHEN OTHERS THEN"
  Add-Line "      RAISE NOTICE 'SKIP FK % on %: %', '$name', '$table', SQLERRM;"
  Add-Line "    END;"
  Add-Line "  END IF;"
  Add-Line "END `$`$;"
  Add-Line ""
}

# --- VALIDATE FKs ---
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line "-- 3) VALIDATE FOREIGN KEYs (reports orphans via NOTICE, does not abort)"
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line ""

foreach ($c in $constraints) {
  if ($c.type -ne "f") { continue }
  $name = $c.constraint_name
  $table = $c.table_name
  Add-Line "DO `$`$"
  Add-Line "BEGIN"
  Add-Line "  IF EXISTS ("
  Add-Line "    SELECT 1 FROM pg_constraint"
  Add-Line "    WHERE conname = '$name'"
  Add-Line "      AND conrelid = 'public.$table'::regclass"
  Add-Line "      AND NOT convalidated"
  Add-Line "  ) THEN"
  Add-Line "    BEGIN"
  Add-Line "      ALTER TABLE public.$table VALIDATE CONSTRAINT $name;"
  Add-Line "    EXCEPTION WHEN OTHERS THEN"
  Add-Line "      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', '$name', '$table', SQLERRM;"
  Add-Line "    END;"
  Add-Line "  END IF;"
  Add-Line "END `$`$;"
  Add-Line ""
}

# --- INDEXES (non-constraint) ---
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line "-- 4) Indexes not already created by PRIMARY KEY / UNIQUE constraints"
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line ""

foreach ($ix in $indexes) {
  $name = $ix.indexname
  if ($name -match '_pkey$') { continue }
  if ($constraintNames.Contains($name)) { continue }

  $def = $ix.indexdef
  # Inject IF NOT EXISTS after CREATE [UNIQUE] INDEX
  if ($def -match '^CREATE UNIQUE INDEX ') {
    $stmt = $def -replace '^CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS '
  } elseif ($def -match '^CREATE INDEX ') {
    $stmt = $def -replace '^CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '
  } else {
    $stmt = $def
  }
  Add-Line "$stmt;"
  Add-Line ""
}

# --- Validation ---
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line "-- VALIDATION (run after - expect rows)"
Add-Line "-- ---------------------------------------------------------------------------"
Add-Line "-- FK count on public (DEV baseline ~120+):"
Add-Line "-- SELECT count(*) AS fk_count"
Add-Line "-- FROM pg_constraint c"
Add-Line "-- JOIN pg_class rel ON rel.oid = c.conrelid"
Add-Line "-- JOIN pg_namespace n ON n.oid = rel.relnamespace"
Add-Line "-- WHERE n.nspname = 'public' AND c.contype = 'f';"
Add-Line "--"
Add-Line "-- Unvalidated FKs (should be 0 after clean data):"
Add-Line "-- SELECT rel.relname AS table_name, c.conname"
Add-Line "-- FROM pg_constraint c"
Add-Line "-- JOIN pg_class rel ON rel.oid = c.conrelid"
Add-Line "-- JOIN pg_namespace n ON n.oid = rel.relnamespace"
Add-Line "-- WHERE n.nspname = 'public' AND c.contype = 'f' AND NOT c.convalidated"
Add-Line "-- ORDER BY 1, 2;"
Add-Line "--"
Add-Line "-- Sample PostgREST-critical FKs (expect 6 rows):"
Add-Line "-- SELECT conname FROM pg_constraint"
Add-Line "-- WHERE conname IN ("
Add-Line "--   'event_roster_bookings_participant_id_fkey',"
Add-Line "--   'event_roster_bookings_event_id_fkey',"
Add-Line "--   'event_manifest_primary_venue_id_fkey',"
Add-Line "--   'participant_attendance_schedules_participant_id_fkey',"
Add-Line "--   'event_activity_rolls_participant_id_fkey',"
Add-Line "--   'trip_legs_trip_id_fkey'"
Add-Line "-- )"
Add-Line "-- ORDER BY 1;"

[System.IO.File]::WriteAllText($outPath, $sb.ToString())
Write-Host "Wrote $outPath"
Write-Host ("Constraints processed: {0}" -f $constraints.Count)
Write-Host ("Indexes in dump: {0}" -f $indexes.Count)
