/**
 * Generate docs/sql/2026-08-05_test_align_dev_rls.sql from policies.csv
 * CSV columns: schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const csvPath = join(root, "docs/architecture/dev-schema-dumps/policies.csv");
const outPath = join(root, "docs/sql/2026-08-05_test_align_dev_rls.sql");

function parseCsv(text) {
  const rows = [];
  let i = 0;
  const s = text.replace(/^\uFEFF/, "");
  while (i < s.length) {
    const row = [];
    while (i < s.length) {
      let cell = "";
      if (s[i] === '"') {
        i++;
        while (i < s.length) {
          if (s[i] === '"' && s[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else if (s[i] === '"') {
            i++;
            break;
          } else {
            cell += s[i++];
          }
        }
      } else {
        while (i < s.length && s[i] !== "," && s[i] !== "\n" && s[i] !== "\r") {
          cell += s[i++];
        }
      }
      row.push(cell);
      if (s[i] === ",") {
        i++;
        continue;
      }
      if (s[i] === "\r") i++;
      if (s[i] === "\n") i++;
      break;
    }
    if (row.length && row.some((c) => c !== "")) rows.push(row);
  }
  return rows;
}

const rows = parseCsv(readFileSync(csvPath, "utf8"));
const header = rows[0];
const data = rows.slice(1).map((r) => {
  const o = {};
  header.forEach((h, idx) => (o[h] = r[idx] ?? ""));
  return o;
});

function rolesSql(rolesRaw) {
  // {anon,authenticated} or {public} or {authenticated}
  const inner = rolesRaw.replace(/^\{/, "").replace(/\}$/, "");
  if (!inner) return "public";
  return inner
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .join(", ");
}

function expr(v) {
  if (v == null || v === "" || v === "null") return null;
  return v;
}

const lines = [];
const push = (x = "") => lines.push(x);

push(`-- ============================================================================`);
push(`-- 2026-08-05 — TEST: align RLS policies to DEV`);
push(`--`);
push(`-- SOURCE: docs/architecture/dev-schema-dumps/policies.csv`);
push(`-- Drops ALL public policies then recreates DEV set.`);
push(`-- Also ensures RLS enabled + table GRANTs for anon/authenticated.`);
push(`-- ============================================================================`);
push(``);
push(`-- 1) Drop every existing public policy`);
push(`DO $$`);
push(`DECLARE r record;`);
push(`BEGIN`);
push(`  FOR r IN`);
push(`    SELECT policyname, tablename`);
push(`    FROM pg_policies`);
push(`    WHERE schemaname = 'public'`);
push(`  LOOP`);
push(`    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);`);
push(`  END LOOP;`);
push(`END $$;`);
push(``);

const tables = [...new Set(data.map((d) => d.tablename))].sort();
push(`-- 2) Enable RLS + grants`);
for (const t of tables) {
  push(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
  push(`GRANT ALL ON TABLE public.${t} TO anon, authenticated, service_role;`);
}
push(``);

push(`-- 3) DEV policies`);
for (const p of data) {
  const roles = rolesSql(p.roles);
  const permissive = (p.permissive || "PERMISSIVE").toUpperCase() === "RESTRICTIVE" ? "AS RESTRICTIVE" : "AS PERMISSIVE";
  const cmd = (p.cmd || "ALL").toUpperCase();
  const using = expr(p.qual);
  const check = expr(p.with_check);

  push(`CREATE POLICY ${JSON.stringify(p.policyname)} ON public.${p.tablename}`);
  push(`  ${permissive}`);
  push(`  FOR ${cmd}`);
  push(`  TO ${roles}`);
  if (using != null) push(`  USING (${using})`);
  if (check != null) push(`  WITH CHECK (${check})`);
  push(`;`);
  push(``);
}

push(`-- VALIDATION`);
push(`-- SELECT count(*) FROM pg_policies WHERE schemaname = 'public';`);
push(`-- DEV baseline: ${data.length}`);
push(`--`);
push(`-- Spot-check PIN-critical:`);
push(`-- SELECT tablename, policyname, roles, cmd FROM pg_policies`);
push(`-- WHERE schemaname = 'public'`);
push(`--   AND tablename IN ('staff_registry','site_day_sessions','transport_trips','verify' )`);
push(`-- ORDER BY 1,2;`);

writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
console.log(`Wrote ${outPath} policies=${data.length} tables=${tables.length}`);
