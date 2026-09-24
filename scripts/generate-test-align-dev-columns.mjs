/**
 * Generate docs/sql/2026-08-05_test_align_dev_columns.sql from DEV columns dump.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dumpPath = join(root, "docs/architecture/dev-schema-dumps/columns.json");
const bootstrapPath = join(root, "docs/sql/2026-07-29_test_bootstrap_create_tables.sql");
const outPath = join(root, "docs/sql/2026-08-05_test_align_dev_columns.sql");

const columns = JSON.parse(
  readFileSync(dumpPath, "utf8").replace(/^\uFEFF/, "")
);
const bootstrap = readFileSync(bootstrapPath, "utf8");

const byTable = new Map();
for (const col of columns) {
  if (!byTable.has(col.table_name)) byTable.set(col.table_name, []);
  byTable.get(col.table_name).push(col);
}

const missingTables = [...byTable.keys()].filter(
  (t) => !new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\b`).test(bootstrap)
);

function inferType(col) {
  const t = col.data_type;
  const def = col.column_default || "";
  if (t === "uuid") return { ddl: "uuid", isEnum: false };
  if (t === "text") return { ddl: "text", isEnum: false };
  if (t === "boolean") return { ddl: "boolean", isEnum: false };
  if (t === "jsonb") return { ddl: "jsonb", isEnum: false };
  if (t === "json") return { ddl: "json", isEnum: false };
  if (t === "integer") return { ddl: "integer", isEnum: false };
  if (t === "bigint") return { ddl: "bigint", isEnum: false };
  if (t === "smallint") return { ddl: "smallint", isEnum: false };
  if (t === "numeric") return { ddl: "numeric", isEnum: false };
  if (t === "real") return { ddl: "real", isEnum: false };
  if (t === "double precision") return { ddl: "double precision", isEnum: false };
  if (t === "date") return { ddl: "date", isEnum: false };
  if (t === "time without time zone") return { ddl: "time without time zone", isEnum: false };
  if (t === "time with time zone") return { ddl: "time with time zone", isEnum: false };
  if (t === "timestamp without time zone") return { ddl: "timestamp without time zone", isEnum: false };
  if (t === "timestamp with time zone") return { ddl: "timestamptz", isEnum: false };
  if (t === "character varying") return { ddl: "character varying", isEnum: false };
  if (t === "ARRAY") {
    if (def.includes("uuid[]") || /::uuid\[\]/.test(def)) return { ddl: "uuid[]", isEnum: false };
    if (def.includes("text[]") || /::text\[\]/.test(def)) return { ddl: "text[]", isEnum: false };
    const m = def.match(/::([a-zA-Z_][a-zA-Z0-9_]*)\[\]/);
    if (m) return { ddl: `${m[1]}[]`, isEnum: false };
    return { ddl: "uuid[]", isEnum: false };
  }
  if (t === "USER-DEFINED") {
    const m = def.match(/::"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*$/);
    if (m) return { ddl: m[1], isEnum: true };
    if (col.table_name === "site_day_sessions" && col.column_name === "phase") {
      return { ddl: "site_session_status", isEnum: true };
    }
    if (col.table_name === "site_issues_register" && col.column_name === "owner") {
      return { ddl: "responsibility_owner", isEnum: true };
    }
    if (col.table_name === "site_issues_register" && col.column_name === "severity") {
      return { ddl: "ryge_severity", isEnum: true };
    }
    return { ddl: "text", isEnum: false, unknownEnum: true };
  }
  return { ddl: "text", isEnum: false };
}

/** Default expression safe for the DDL type we are using */
function defaultSql(col, typeInfo) {
  const def = col.column_default;
  if (def == null || def === "") return null;
  if (typeInfo.unknownEnum || (typeInfo.ddl === "text" && /::[a-zA-Z_]/.test(def))) {
    // Strip cast: 'foo'::some_enum → 'foo'
    const m = def.match(/^'((?:\\'|[^'])*)'/);
    if (m) return `'${m[1]}'`;
  }
  return def;
}

const lines = [];
const push = (s = "") => lines.push(s);

push(`-- ============================================================================`);
push(`-- 2026-08-05 — TEST: align public columns (tables / ADD / DEFAULT / NULL) to DEV`);
push(`--`);
push(`-- SOURCE: docs/architecture/dev-schema-dumps/columns.json (${columns.length} cols)`);
push(`-- GENERATOR: scripts/generate-test-align-dev-columns.mjs`);
push(`--`);
push(`-- Creates tables missing from bootstrap: ${missingTables.join(", ") || "(none)"}`);
push(`-- Then ADD COLUMN / DEFAULT / NOT NULL to match DEV.`);
push(`--`);
push(`-- After this file, re-run:`);
push(`--   docs/sql/2026-08-05_test_align_dev_constraints.sql`);
push(`-- (so FKs on newly created tables are applied).`);
push(`--`);
push(`-- Safe: idempotent. NOT NULL failures → NOTICE (do not abort).`);
push(`-- ============================================================================`);
push(``);
push(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
push(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
push(``);
push(`-- ---------------------------------------------------------------------------`);
push(`-- 0) Enums required by known USER-DEFINED columns`);
push(`-- ---------------------------------------------------------------------------`);
push(`DO $$ BEGIN`);
push(`  CREATE TYPE public.site_session_status AS ENUM (`);
push(`    'open_pending', 'active_day', 'escalated_lock', 'closed_orderly', 'closed_no_go'`);
push(`  );`);
push(`EXCEPTION WHEN duplicate_object THEN NULL;`);
push(`END $$;`);
push(``);
push(`DO $$ BEGIN`);
push(`  CREATE TYPE public.responsibility_owner AS ENUM ('internal', 'council');`);
push(`EXCEPTION WHEN duplicate_object THEN NULL;`);
push(`END $$;`);
push(``);
push(`DO $$ BEGIN`);
push(`  CREATE TYPE public.ryge_severity AS ENUM ('green', 'yellow', 'red');`);
push(`EXCEPTION WHEN duplicate_object THEN NULL;`);
push(`END $$;`);
push(``);
push(`-- Promote bootstrap text columns to DEV enums when safe`);
push(`DO $$ BEGIN`);
push(`  ALTER TABLE public.site_day_sessions`);
push(`    ALTER COLUMN phase TYPE public.site_session_status`);
push(`    USING phase::text::public.site_session_status;`);
push(`EXCEPTION WHEN OTHERS THEN`);
push(`  RAISE NOTICE 'SKIP type promote site_day_sessions.phase: %', SQLERRM;`);
push(`END $$;`);
push(``);
push(`DO $$ BEGIN`);
push(`  ALTER TABLE public.site_issues_register`);
push(`    ALTER COLUMN severity TYPE public.ryge_severity`);
push(`    USING severity::text::public.ryge_severity;`);
push(`EXCEPTION WHEN OTHERS THEN`);
push(`  RAISE NOTICE 'SKIP type promote site_issues_register.severity: %', SQLERRM;`);
push(`END $$;`);
push(``);
push(`DO $$ BEGIN`);
push(`  ALTER TABLE public.site_issues_register`);
push(`    ALTER COLUMN owner TYPE public.responsibility_owner`);
push(`    USING NULLIF(owner::text, '')::public.responsibility_owner;`);
push(`EXCEPTION WHEN OTHERS THEN`);
push(`  RAISE NOTICE 'SKIP type promote site_issues_register.owner: %', SQLERRM;`);
push(`END $$;`);
push(``);

// Create missing tables
push(`-- ---------------------------------------------------------------------------`);
push(`-- 1) CREATE TABLE for DEV tables missing from OpenAPI bootstrap`);
push(`-- ---------------------------------------------------------------------------`);
push(``);

for (const table of missingTables) {
  const cols = byTable.get(table);
  push(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  const parts = cols.map((col) => {
    const ti = inferType(col);
    const d = defaultSql(col, ti);
    let frag = `  ${col.column_name} ${ti.ddl}`;
    if (d) frag += ` DEFAULT ${d}`;
    return frag;
  });
  // PK if id present
  if (cols.some((c) => c.column_name === "id")) {
    parts.push(`  PRIMARY KEY (id)`);
  }
  push(parts.join(",\n"));
  push(`);`);
  push(``);
  push(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
  push(`DROP POLICY IF EXISTS kinship_anon_all_${table} ON public.${table};`);
  push(`CREATE POLICY kinship_anon_all_${table} ON public.${table}`);
  push(`  FOR ALL TO anon, authenticated`);
  push(`  USING (true) WITH CHECK (true);`);
  push(`GRANT ALL ON TABLE public.${table} TO anon, authenticated, service_role;`);
  push(``);
}

push(`-- ---------------------------------------------------------------------------`);
push(`-- 2) ADD COLUMN IF NOT EXISTS`);
push(`-- ---------------------------------------------------------------------------`);
push(``);

for (const [table, cols] of byTable) {
  push(`-- ${table}`);
  for (const col of cols) {
    const ti = inferType(col);
    const d = defaultSql(col, ti);
    const defClause = d ? ` DEFAULT ${d}` : "";
    push(
      `ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS ${col.column_name} ${ti.ddl}${defClause};`
    );
  }
  push(``);
}

push(`-- ---------------------------------------------------------------------------`);
push(`-- 3) Align DEFAULTs`);
push(`-- ---------------------------------------------------------------------------`);
push(``);

for (const [table, cols] of byTable) {
  for (const col of cols) {
    const ti = inferType(col);
    const d = defaultSql(col, ti);
    push(`DO $$ BEGIN`);
    if (d) {
      push(
        `  ALTER TABLE public.${table} ALTER COLUMN ${col.column_name} SET DEFAULT ${d};`
      );
    } else {
      push(
        `  ALTER TABLE public.${table} ALTER COLUMN ${col.column_name} DROP DEFAULT;`
      );
    }
    push(`EXCEPTION WHEN OTHERS THEN`);
    push(
      `  RAISE NOTICE 'SKIP DEFAULT %.%: %', '${table}', '${col.column_name}', SQLERRM;`
    );
    push(`END $$;`);
  }
  push(``);
}

push(`-- ---------------------------------------------------------------------------`);
push(`-- 4) Align NULLABILITY`);
push(`-- ---------------------------------------------------------------------------`);
push(``);

for (const [table, cols] of byTable) {
  for (const col of cols) {
    const ti = inferType(col);
    const d = defaultSql(col, ti);
    if (col.is_nullable === "NO") {
      push(`DO $$`);
      push(`BEGIN`);
      if (d) {
        push(
          `  UPDATE public.${table} SET ${col.column_name} = ${d} WHERE ${col.column_name} IS NULL;`
        );
      }
      push(`  BEGIN`);
      push(
        `    ALTER TABLE public.${table} ALTER COLUMN ${col.column_name} SET NOT NULL;`
      );
      push(`  EXCEPTION WHEN OTHERS THEN`);
      push(
        `    RAISE NOTICE 'SKIP NOT NULL %.%: %', '${table}', '${col.column_name}', SQLERRM;`
      );
      push(`  END;`);
      push(`END $$;`);
      push(``);
    } else {
      push(
        `ALTER TABLE public.${table} ALTER COLUMN ${col.column_name} DROP NOT NULL;`
      );
    }
  }
  push(``);
}

push(`-- ---------------------------------------------------------------------------`);
push(`-- VALIDATION`);
push(`-- ---------------------------------------------------------------------------`);
push(`-- Expect column count close to ${columns.length}:`);
push(`-- SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public';`);
push(`--`);
push(`-- Missing emergency tables should exist (expect 2):`);
push(`-- SELECT table_name FROM information_schema.tables`);
push(`-- WHERE table_schema = 'public'`);
push(`--   AND table_name IN ('operational_emergencies', 'operational_emergency_muster')`);
push(`-- ORDER BY 1;`);

try {
  mkdirSync(dirname(outPath), { recursive: true });
} catch {
  /* directory may already exist */
}
writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
console.log(`Wrote ${outPath}`);
console.log(`tables=${byTable.size} missingCreated=${missingTables.join(",") || "none"} cols=${columns.length} lines=${lines.length}`);
