import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PUBLIC_ANON_EXECUTE_FUNCTIONS,
  PUBLIC_ANON_SELECT_TABLES,
  SERVICE_ROLE_ONLY_FUNCTIONS,
} from "@/lib/backup-restore/constants";
import type {
  SchemaCatalog,
  SchemaColumnRow,
  SchemaConstraintRow,
  SchemaEnumRow,
  SchemaIndexRow,
  SchemaPolicyRow,
} from "@/lib/backup-restore/schema-catalog";

async function execDdl(
  service: SupabaseClient,
  sql: string,
  warnings: string[],
  label: string,
): Promise<void> {
  const trimmed = sql.trim();
  if (!trimmed) return;
  const { error } = await service.rpc("exec_backup_ddl", { p_sql: trimmed });
  if (error) {
    warnings.push(`Schema ${label}: ${error.message}`);
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function columnDdlType(col: SchemaColumnRow): string {
  const udt = (col.udt_name || "").replace(/^_/, "");
  if (col.data_type === "ARRAY") {
    if (col.udt_name?.startsWith("_")) return `${udt}[]`;
    return "uuid[]";
  }
  if (col.data_type === "USER-DEFINED") return col.udt_name || "text";
  if (col.data_type === "timestamp with time zone") return "timestamptz";
  if (col.data_type === "timestamp without time zone") return "timestamp without time zone";
  if (col.data_type === "time without time zone") return "time without time zone";
  if (col.data_type === "time with time zone") return "time with time zone";
  if (col.data_type === "character varying") return "character varying";
  if (col.data_type === "double precision") return "double precision";
  return col.data_type || col.udt_name || "text";
}

function groupEnums(enums: SchemaEnumRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const sorted = [...enums].sort(
    (a, b) =>
      a.enum_name.localeCompare(b.enum_name) || a.sort_order - b.sort_order,
  );
  for (const row of sorted) {
    const list = map.get(row.enum_name) ?? [];
    list.push(row.enum_value);
    map.set(row.enum_name, list);
  }
  return map;
}

function groupColumns(columns: SchemaColumnRow[]): Map<string, SchemaColumnRow[]> {
  const map = new Map<string, SchemaColumnRow[]>();
  const sorted = [...columns].sort(
    (a, b) =>
      a.table_name.localeCompare(b.table_name) ||
      (a.ordinal_position ?? 0) - (b.ordinal_position ?? 0),
  );
  for (const col of sorted) {
    const list = map.get(col.table_name) ?? [];
    list.push(col);
    map.set(col.table_name, list);
  }
  return map;
}

function rolesSql(roles: SchemaPolicyRow["roles"]): string {
  if (Array.isArray(roles)) {
    return roles.length ? roles.join(", ") : "public";
  }
  if (typeof roles === "string") {
    const inner = roles.replace(/^\{/, "").replace(/\}$/, "");
    return inner || "public";
  }
  return "public";
}

/**
 * Apply a schema catalog discovered at backup time.
 * Creates missing tables/columns/constraints/indexes/functions/triggers/policies.
 * Never DROP TABLE. Failures accumulate as warnings (best-effort) unless fatal RPC missing.
 */
export async function applySchemaCatalog(
  service: SupabaseClient,
  catalog: SchemaCatalog,
): Promise<{ statements: number; warnings: string[] }> {
  const warnings: string[] = [];
  let statements = 0;

  const run = async (sql: string, label: string) => {
    statements += 1;
    await execDdl(service, sql, warnings, label);
  };

  // Probe executor exists (allowlisted no-op; SELECT is rejected by design)
  const probe = await service.rpc("exec_backup_ddl", {
    p_sql: "DO $$ BEGIN NULL; END $$;",
  });
  if (
    probe.error?.message?.includes("Could not find the function") ||
    probe.error?.code === "PGRST202"
  ) {
    throw new Error(
      "Schema restore requires docs/sql/2026-08-05_backup_schema_catalog_rpcs.sql (exec_backup_ddl). Apply on this environment first.",
    );
  }

  await run(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`, "extension pgcrypto");
  await run(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`, "extension uuid-ossp");

  // Enums
  for (const [name, values] of groupEnums(catalog.enums ?? [])) {
    const labels = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
    await run(
      `DO $$ BEGIN CREATE TYPE public.${quoteIdent(name)} AS ENUM (${labels}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `enum ${name}`,
    );
  }

  const byTable = groupColumns(catalog.columns ?? []);

  // CREATE TABLE IF NOT EXISTS (shell)
  for (const [table, cols] of byTable) {
    const parts = cols.map((col) => {
      const typ = columnDdlType(col);
      const def =
        col.column_default != null && col.column_default !== ""
          ? ` DEFAULT ${col.column_default}`
          : "";
      return `  ${quoteIdent(col.column_name)} ${typ}${def}`;
    });
    if (cols.some((c) => c.column_name === "id")) {
      parts.push(`  PRIMARY KEY (${quoteIdent("id")})`);
    }
    await run(
      `CREATE TABLE IF NOT EXISTS public.${quoteIdent(table)} (\n${parts.join(",\n")}\n);`,
      `create ${table}`,
    );
    await run(
      `ALTER TABLE public.${quoteIdent(table)} ENABLE ROW LEVEL SECURITY;`,
      `rls enable ${table}`,
    );
    const anonSelect = (PUBLIC_ANON_SELECT_TABLES as readonly string[]).includes(table);
    await run(
      `GRANT ALL ON TABLE public.${quoteIdent(table)} TO authenticated, service_role;`,
      `grant ${table}`,
    );
    if (anonSelect) {
      await run(
        `GRANT SELECT ON TABLE public.${quoteIdent(table)} TO anon;`,
        `grant anon select ${table}`,
      );
    }
  }

  // ADD COLUMN IF NOT EXISTS
  for (const [table, cols] of byTable) {
    for (const col of cols) {
      const typ = columnDdlType(col);
      const def =
        col.column_default != null && col.column_default !== ""
          ? ` DEFAULT ${col.column_default}`
          : "";
      await run(
        `ALTER TABLE public.${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(col.column_name)} ${typ}${def};`,
        `add ${table}.${col.column_name}`,
      );
    }
  }

  // Defaults
  for (const [table, cols] of byTable) {
    for (const col of cols) {
      if (col.column_default != null && col.column_default !== "") {
        await run(
          `DO $$ BEGIN ALTER TABLE public.${quoteIdent(table)} ALTER COLUMN ${quoteIdent(col.column_name)} SET DEFAULT ${col.column_default}; EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
          `default ${table}.${col.column_name}`,
        );
      }
    }
  }

  // NOT NULL (best-effort with backfill)
  for (const [table, cols] of byTable) {
    for (const col of cols) {
      if (col.is_nullable !== "NO") continue;
      const def =
        col.column_default != null && col.column_default !== ""
          ? col.column_default
          : null;
      const backfill = def
        ? `UPDATE public.${quoteIdent(table)} SET ${quoteIdent(col.column_name)} = ${def} WHERE ${quoteIdent(col.column_name)} IS NULL;`
        : "";
      await run(
        `DO $$ BEGIN ${backfill} ALTER TABLE public.${quoteIdent(table)} ALTER COLUMN ${quoteIdent(col.column_name)} SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
        `not null ${table}.${col.column_name}`,
      );
    }
  }

  // Constraints: check + unique first, then FK NOT VALID
  const constraints = catalog.constraints ?? [];
  const constraintNames = new Set(constraints.map((c) => c.constraint_name));

  const addConstraint = async (c: SchemaConstraintRow, notValid: boolean) => {
    if (c.type === "p") return; // PK from CREATE TABLE
    const nv = notValid && c.type === "f" ? " NOT VALID" : "";
    await run(
      `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = '${c.constraint_name.replace(/'/g, "''")}'
      AND conrelid = 'public.${c.table_name.replace(/'/g, "''")}'::regclass
  ) THEN
    ALTER TABLE public.${quoteIdent(c.table_name)}
      ADD CONSTRAINT ${quoteIdent(c.constraint_name)} ${c.definition}${nv};
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;`,
      `constraint ${c.constraint_name}`,
    );
  };

  for (const c of constraints.filter((x) => x.type === "c" || x.type === "u")) {
    await addConstraint(c, false);
  }
  for (const c of constraints.filter((x) => x.type === "f")) {
    await addConstraint(c, true);
  }
  for (const c of constraints.filter((x) => x.type === "f")) {
    await run(
      `DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = '${c.constraint_name.replace(/'/g, "''")}'
      AND conrelid = 'public.${c.table_name.replace(/'/g, "''")}'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE public.${quoteIdent(c.table_name)} VALIDATE CONSTRAINT ${quoteIdent(c.constraint_name)};
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;`,
      `validate ${c.constraint_name}`,
    );
  }

  // Indexes (skip those created by PK/UNIQUE constraints)
  for (const ix of catalog.indexes ?? ([] as SchemaIndexRow[])) {
    if (ix.indexname.endsWith("_pkey")) continue;
    if (constraintNames.has(ix.indexname)) continue;
    let stmt = ix.indexdef;
    if (stmt.startsWith("CREATE UNIQUE INDEX ")) {
      stmt = stmt.replace("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ");
    } else if (stmt.startsWith("CREATE INDEX ")) {
      stmt = stmt.replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ");
    }
    await run(`${stmt};`, `index ${ix.indexname}`);
  }

  // Functions (CREATE OR REPLACE from dump)
  for (const fn of catalog.functions ?? []) {
    if (!fn.definition?.trim()) continue;
    // Skip redefining the DDL executor itself mid-flight with an older body
    if (fn.function_name === "exec_backup_ddl") continue;
    await run(fn.definition.endsWith(";") ? fn.definition : `${fn.definition};`, `fn ${fn.function_name}`);
    // Grant execute on callable RPCs (non-trigger helpers)
    if (!/RETURNS trigger/i.test(fn.definition)) {
      const args = fn.args?.trim() ?? "";
      const fnRoles = (SERVICE_ROLE_ONLY_FUNCTIONS as readonly string[]).includes(
        fn.function_name,
      )
        ? "service_role"
        : (PUBLIC_ANON_EXECUTE_FUNCTIONS as readonly string[]).includes(fn.function_name)
          ? "anon, authenticated, service_role"
          : "authenticated, service_role";
      await run(
        `GRANT EXECUTE ON FUNCTION public.${quoteIdent(fn.function_name)}(${args}) TO ${fnRoles};`,
        `grant fn ${fn.function_name}`,
      );
    }
  }

  // Triggers — DROP TRIGGER IF EXISTS then CREATE from definition
  for (const trg of catalog.triggers ?? []) {
    await run(
      `DROP TRIGGER IF EXISTS ${quoteIdent(trg.trigger_name)} ON public.${quoteIdent(trg.table_name)};`,
      `drop trigger ${trg.trigger_name}`,
    );
    let def = trg.definition.trim();
    if (!def.endsWith(";")) def += ";";
    // pg_get_triggerdef may omit schema; ensure public.
    def = def.replace(
      / ON ([a-zA-Z_][a-zA-Z0-9_]*) /i,
      ` ON public.${trg.table_name} `,
    );
    await run(def, `trigger ${trg.trigger_name}`);
  }

  // Policies — drop all then recreate from catalog
  await run(
    `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;`,
    "drop all policies",
  );

  for (const p of catalog.policies ?? ([] as SchemaPolicyRow[])) {
    const roles = rolesSql(p.roles);
    const permissive =
      (p.permissive || "PERMISSIVE").toUpperCase() === "RESTRICTIVE"
        ? "AS RESTRICTIVE"
        : "AS PERMISSIVE";
    const cmd = (p.cmd || "ALL").toUpperCase();
    const using = p.qual != null && p.qual !== "" ? ` USING (${p.qual})` : "";
    const check =
      p.with_check != null && p.with_check !== ""
        ? ` WITH CHECK (${p.with_check})`
        : "";
    await run(
      `CREATE POLICY ${quoteIdent(p.policyname)} ON public.${quoteIdent(p.tablename)}
  ${permissive}
  FOR ${cmd}
  TO ${roles}${using}${check};`,
      `policy ${p.tablename}.${p.policyname}`,
    );
  }

  return { statements, warnings };
}

/** Drop all FK constraints listed in the catalog (data restore can insert in any order). */
export async function dropForeignKeyConstraints(
  service: SupabaseClient,
  catalog: SchemaCatalog,
): Promise<{ statements: number; warnings: string[] }> {
  const warnings: string[] = [];
  let statements = 0;
  const fks = (catalog.constraints ?? []).filter(
    (c) => c.type === "f" || c.type === "FOREIGN KEY",
  );
  for (const c of fks) {
    statements += 1;
    await execDdl(
      service,
      `ALTER TABLE public.${quoteIdent(c.table_name)} DROP CONSTRAINT IF EXISTS ${quoteIdent(c.constraint_name)};`,
      warnings,
      `drop fk ${c.constraint_name}`,
    );
  }
  return { statements, warnings };
}

/** Re-add FKs after data load (NOT VALID then VALIDATE — orphans stay as warnings). */
export async function restoreForeignKeyConstraints(
  service: SupabaseClient,
  catalog: SchemaCatalog,
): Promise<{ statements: number; warnings: string[] }> {
  const warnings: string[] = [];
  let statements = 0;
  const fks = (catalog.constraints ?? []).filter(
    (c) => c.type === "f" || c.type === "FOREIGN KEY",
  );

  for (const c of fks) {
    statements += 1;
    await execDdl(
      service,
      `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = '${c.constraint_name.replace(/'/g, "''")}'
      AND conrelid = 'public.${c.table_name.replace(/'/g, "''")}'::regclass
  ) THEN
    ALTER TABLE public.${quoteIdent(c.table_name)}
      ADD CONSTRAINT ${quoteIdent(c.constraint_name)} ${c.definition} NOT VALID;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;`,
      warnings,
      `add fk ${c.constraint_name}`,
    );
  }

  for (const c of fks) {
    statements += 1;
    await execDdl(
      service,
      `DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = '${c.constraint_name.replace(/'/g, "''")}'
      AND conrelid = 'public.${c.table_name.replace(/'/g, "''")}'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE public.${quoteIdent(c.table_name)} VALIDATE CONSTRAINT ${quoteIdent(c.constraint_name)};
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK % left NOT VALID (orphans in data)', '${c.constraint_name.replace(/'/g, "''")}';
END $$;`,
      warnings,
      `validate fk ${c.constraint_name}`,
    );
  }

  return { statements, warnings };
}
