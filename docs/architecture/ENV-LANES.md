# Environments: DEV → TEST → PROD (BL-099)

**Status:** Day login shipped on DEV. TEST Supabase (Australia) stood up. **App host = Vercel** (Hobby → Pro for commercial/PROD). Lovable abandoned as host.

## Public vs Connect domains (BL-110 — Phase 2 cutover)

| Hostname | App | Notes |
|----------|-----|--------|
| **yada.org.au** | Public site | Serves `/public/*` (CMS pages + forms). No day-login / PIN. Content published from Connect Admin → Public website. |
| **connect.yada.org.au** | Yada Connect CRM/ops | Full AppShell, Hub, onboarding, floor. |

Until DNS cutover: preview public pages at `https://<connect-host>/public`. Publish snapshots store the intended domain mapping in `cms_publish_snapshots.payload.domains`.

## Lane map

| Lane | Purpose | Supabase | App flags |
|------|---------|----------|-----------|
| **DEV** | Builder / agent (rename display name OK) | Current project (was “Prod” name) | `VITE_APP_LANE=dev` |
| **TEST** | Office Alpha | **New** Australia project | `VITE_APP_LANE=test` |
| **PROD** | Live field (later) | Third project | `VITE_APP_LANE=prod` + `VITE_IS_PRODUCTION=true` |

Renaming a Supabase **display name** does not change URL or keys.

## What never copies to TEST / PROD

- Live client attendance you care about as “real” (use scrubbed / sample data for Alpha)
- PROD-only secrets (BL-074)
- Assume **Auth users** (`auth.users`) are **not** in the public backup — recreate day-login users in each project’s Authentication UI
- Prefer **different PINs** on TEST than you will use on true PROD

## Load DEV → TEST (what actually happens)

Supabase Dashboard **cannot** restore Project A into Project B. Use the **app** Admin JSON backup (v2 = data + discovered schema).

### Order (prefer v2 backup — do not skip RPCs)

1. **RPCs on source (DEV) and target (TEST)**  
   - `docs/sql/2026-07-11_backup_restore_rpcs.sql`  
   - `docs/sql/2026-08-05_backup_schema_catalog_rpcs.sql` (`export_backup_schema_catalog`, `exec_backup_ddl`)
2. **DEV backup** — Admin → Backup & Restore → download (v2 embeds live schema each run).
3. **Point app at TEST** (temp `.env` — never commit): TEST URL / anon / `SUPABASE_SERVICE_ROLE_KEY` / `VITE_APP_LANE=test`.
4. **Restore with mode switches** (Manager PIN):  
   | Goal | Infrastructure | Table data | Login details |
   |------|----------------|------------|---------------|
   | Empty structure / promote schema | on | off | n/a |
   | Refresh seed data only | off | on | off (keep TEST PINs) or on |
   | Full disaster / new project | on | on | on (Alpha) or off (keep local) |
5. **Auth users on TEST** (not in JSON): Authentication → create day-login emails; optional `docs/sql/2026-07-28_staff_auth_user_link_backfill.sql`.
6. Smoke → point env back to DEV when done building.

**Legacy path** (pre-v2 or if schema apply fails): bootstrap shells `2026-07-29_test_bootstrap_create_tables.sql` + structure sync pack `2026-08-05_TEST_STRUCTURE_SYNC_ORDER.md`, then data-only restore.

### Align TEST schema to DEV (after bootstrap + data)

Full run order: `docs/sql/2026-08-05_TEST_STRUCTURE_SYNC_ORDER.md`

| Step | File | What |
|------|------|------|
| 1 Columns | `2026-08-05_test_align_dev_columns.sql` | missing tables, ADD COLUMN, DEFAULT, NOT NULL |
| 2 Constraints | `2026-08-05_test_align_dev_constraints.sql` | CHECK / UNIQUE / FK / indexes |
| 3 Enums/RPCs/triggers | `2026-08-05_test_align_dev_enums_funcs_triggers.sql` | enums, functions, triggers, EXECUTE grants |
| 4 RLS | `2026-08-05_test_align_dev_rls.sql` | replace public policies with DEV set |

Full checklist: `docs/sql/2026-08-05_TEST_STRUCTURE_SYNC_ORDER.md`.  
Dumps: `docs/architecture/dev-schema-dumps/`. Generators: `scripts/generate-test-align-dev-*`.

### Alternative: pg_dump (fuller DDL)

If you have Postgres client tools, `pg_dump --schema-only` from DEV → `psql` into TEST is still the gold standard for FKs/indexes. The bootstrap SQL above is the path when you only have the Supabase SQL Editor.

## Lovable / env checklist (TEST publish)

```
VITE_SUPABASE_URL=https://YOUR_TEST_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_APP_LANE=test
VITE_SHOW_TEST_TOOLS=true
SUPABASE_URL=https://YOUR_TEST_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # host secrets only — never VITE_
POSTMARK_SERVER_TOKEN=...       # App ticket notify (BL-116); never VITE_
POSTMARK_FROM=...               # verified Postmark Sender Signature
APP_PUBLIC_URL=https://crm-test.yada.org.au   # optional Hub link in ticket emails
# APP_TICKET_NOTIFY_SECRET=...  # only if you add a Supabase Database Webhook to the same route
```

Do **not** paste service_role into chat or commit it.

### Careful walkthrough — code on GitHub → Lovable TEST

**Done when:** `main` on `github.com/craigoberg/kinship-logistics` has the Alpha snapshot (pushed from Cursor).

Lovable does **not** “Import GitHub” as a blank new app. Use one of these:

#### Path A — Existing Lovable project still synced to `kinship-logistics`

1. Open that Lovable project.
2. Wait for Git sync to pull latest `main` (or trigger sync from Project settings → Git).
3. Confirm preview builds (libraries install from `package.json` automatically).
4. **Do not** change this project’s env to TEST if you still use it as DEV.  
   For TEST Alpha, prefer **Path B** (second project). If you only have one project for now, you can temporarily set TEST keys, restore/smoke, then switch env back to DEV — easy to mix up.

#### Path B — Separate TEST Lovable project (recommended)

1. In Lovable: **New project** (name it clearly, e.g. `Yada Connect TEST`).
2. Connect GitHub (Project settings → Git). Lovable will create a **new** empty repo — that is normal.
3. From Cursor/GitHub: make that new repo contain the same code as `kinship-logistics`  
   (easiest: ask the agent to add the new remote and push `main`, or merge via GitHub UI).  
   Or: if Lovable later offers link-to-existing-repo, use `craigoberg/kinship-logistics` only if it won’t fight your DEV project’s sync.
4. In **TEST** Lovable only: set the env vars above to the **TEST** Supabase project.
5. Publish → use that URL for office Alpha (custom domain later).

#### After publish — restore data

Admin → Backup & Restore on the **TEST** app URL, using your DEV JSON dump (Manager PIN).  
Auth users still created in TEST Supabase Authentication.

## Smoke (TEST Alpha)

1. Day login (email/password) → Operator PIN  
2. Open Day Centre / Event Deliver / Manifest (happy path)  
3. Hub open issue + note  
4. Infectious exclusion declare (optional)  
5. Log out → confirms both Auth + PIN cleared  

## Long-term promotion model (code vs DB)

**Source of truth for code:** Cursor → `git push` → GitHub `main` (or a release tag).  
**Source of truth for each DB:** that lane’s Supabase project. Code and DB promote on **different tracks**.

```text
Cursor (build) ──push──► GitHub main
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         Lovable DEV    Lovable TEST   (PROD later)
         .env = DEV     .env = TEST    .env = PROD
              │             │             │
              ▼             ▼             ▼
         Supabase DEV  Supabase TEST  Supabase PROD
```

| What | How it moves DEV → TEST |
|------|-------------------------|
| **App code** | Push to GitHub → TEST host rebuilds/publishes same commit. No separate “copy code in Lovable.” |
| **Schema / RPCs** | New file under `docs/sql/` applied on DEV first → same file run on TEST SQL Editor (checklist). |
| **Schema + seed data** | Admin v2 JSON: discover schema each backup; restore with Infrastructure / Data / Login checkboxes. Not every week by default. |
| **Auth users / passwords** | Recreate or invite per Supabase project (not in JSON backup — PINs in `staff_registry` only when Login details is on). |
| **Secrets / `.env`** | Never promote. Each Lovable project keeps its own `.env` pointed at its DB. |

### Option 1 — Cursor + Lovable DEV + Lovable TEST (two hosts)

- **Cursor** = where you build (can also talk to DEV DB via local `.env`).
- **Lovable DEV** = synced to `kinship-logistics`, `.env` → DEV DB (builder preview / optional DEV URL).
- **Lovable TEST** = same *code lineage* from GitHub, `.env` → TEST DB (office Alpha URL).

**Code promote:** commit in Cursor → push `main` → both Lovable apps pull that commit (DEV project via existing sync; TEST project via second sync or `git push` to its linked repo — see Path B).  
**DB promote:** run new SQL on TEST; occasionally restore seed JSON if you want TEST data refreshed.

Lovable awkwardness: one Lovable project ↔ one GitHub repo. Two hosts usually means **two repos** both fed from the same Cursor `main` (push to two remotes), or one host + one external TEST deploy later (Vercel, etc.).

### Option 2 — One Lovable, swap `.env` DEV ↔ TEST

- **Code promote:** trivial — one sync, always current.  
- **DB promote:** same SQL + restore steps, but you must **change `.env`** to TEST, publish/smoke, then change **back** to DEV.  
- Risk: forget to switch back → office hits DEV or builders hit TEST.

Fine for a short Alpha bootstrapping window; poor as a permanent habit.

### Recommended steady state

1. Build in **Cursor** against **DEV** DB.  
2. Push code when ready for office.  
3. Apply matching **SQL** on **TEST**.  
4. **TEST** Vercel project always has TEST env — never swap.  
5. PROD later = third Supabase + third Vercel project + `VITE_IS_PRODUCTION=true`.

### Code promote: don’t ship every Cursor commit to TEST

If Vercel Production tracks **`main`**, every push updates the office URL. That defeats a calm Alpha.

**Recommended (simple):**

| Branch | Purpose |
|--------|---------|
| `main` | Daily Cursor work → DEV (optional: no Vercel Production on this branch) |
| `test` | What office Alpha runs — **only merge when you want TEST updated** |

1. Vercel project → Settings → Git → Production Branch = **`test`** (not `main`).  
2. Develop and push on `main` as usual (Cursor + DEV DB).  
3. When a slice is ready for Alpha: merge `main` → `test` (PR or local merge + push).  
4. Vercel rebuilds TEST only then.  
5. Matching `docs/sql/*.sql` still run on TEST Supabase when schema changed.

Alternatives: turn off auto-deploy and click Redeploy only when ready; or deploy from git tags. Prefer the `test` branch — clearest.

## Schema promote checklist (DEV → TEST → PROD)

Same cadence every lane:

1. Ship additive SQL under `docs/sql/` (dated filename) — tables, columns, defaults, uniques, FKs, RPCs, RLS.  
2. Run on **DEV** first; smoke.  
3. Run the **same file** on **TEST** before/with the `test` branch code promote.  
4. Later: same file on **PROD** — never full JSON wipe of PROD operational data.  

Agent/backlog must list every new SQL in the handoff (live-db-ship-gate).

**Baseline locked 2026-08-05:** TEST was brought in line with DEV via catalog dumps + align scripts (`docs/sql/2026-08-05_TEST_STRUCTURE_SYNC_ORDER.md`). From this point, **stay in sync by forward migrations only** — do not rebuild TEST from OpenAPI bootstrap again unless creating a brand-new empty project.

## Stay in sync (operating rules)

### Golden rule

**No schema change exists unless it is a dated file under `docs/sql/`.**  
Never “just fix it” in the Supabase Dashboard SQL Editor on one lane without committing the same script to git and running it on the other lanes.

### Every schema change (DEV → TEST → later PROD)

| Step | Who | Action |
|------|-----|--------|
| 1 | Agent / builder | Write idempotent `docs/sql/YYYY-MM-DD_short_name.sql` (IF NOT EXISTS / DO blocks) |
| 2 | User | Run on **DEV** → hard refresh → smoke the feature |
| 3 | User | Run **same file** on **TEST** before (or with) merging code to `test` |
| 4 | Agent | Handoff lists SQL paths + validation queries (live-db-ship-gate) |
| 5 | Later | Same file on **PROD** when promoting that release |

Code and SQL are a **pair**: if the PR needs a column/RPC/policy, the SQL file ships in the same change set.

### What never auto-copies

- Table **data** (attendance, trips, issues) — only intentional Admin JSON restore / seed  
- `auth.users` — recreate per project  
- Secrets / `.env` — per lane  

### Drift watch (lightweight)

Monthly (or any time something “works on DEV, fails on TEST”):

1. Run `docs/sql/2026-08-05_dev_structure_dump_queries.sql` on **DEV** and **TEST** (A–D).  
2. Diff counts: enums, functions, triggers, policy_count, FK count, unvalidated FKs.  
3. If drift: fix with a **new** dated SQL (or regenerate an align pack from dumps) — do not hand-edit only one lane.

Generators (when regenerating a pack):  
`scripts/generate-test-align-dev-*.mjs` / `.ps1` + dumps in `docs/architecture/dev-schema-dumps/`.

### PROD create (empty project) — infrastructure SQL process

When standing up PROD (or any new empty Supabase):

1. **Freeze a schema release** — git tag or known commit on `main` / `test`.  
2. **Build a schema pack from that DEV** (preferred over replaying years of patch files):  
   - Re-run dump queries A–E + constraints/indexes on DEV  
   - Generate align SQL (columns → constraints → enums/funcs/triggers → RLS), **or**  
   - `pg_dump --schema-only --schema=public` if Postgres client tools are available (gold standard)  
3. Run pack on **empty PROD** (no operational data yet).  
4. Apply any **forward** `docs/sql/` files dated after the freeze.  
5. Seed only what PROD needs (staff, system_parameters, lookups) — **not** a full live attendance restore.  
6. Create Auth users; link `staff_registry.auth_user_id`.  
7. Point PROD Vercel env at PROD Supabase (`VITE_APP_LANE=prod`, `VITE_IS_PRODUCTION=true`).

After PROD exists, promote exactly like TEST: **same dated SQL file**, never wipe PROD tables for routine releases.

### Anti-patterns (cause today’s disaster again)

- OpenAPI / PostgREST “create table shells” as the long-term schema source  
- Dashboard-only FK/default fixes on one project  
- Different SQL on DEV vs TEST “just for now”  
- Skipping `2026-08-05_backup_schema_catalog_rpcs.sql` then expecting Infrastructure restore to work  
- Relying only on OpenAPI table shells when a v2 backup + Infrastructure apply is available

## Custom domain (TEST on Vercel)

1. Vercel project → **Settings → Domains** → Add (e.g. `crm-test.yada.org.au`).  
2. At your DNS host: add the record Vercel shows (usually CNAME → `cname.vercel-dns.com`).  
3. Wait for SSL “Valid”.  
4. Optional: set as primary. Keep `*.vercel.app` as fallback.  
5. Supabase Auth → URL config: add the custom domain to redirect / site URL allow-list if day-login redirects are restricted.

## Old deployments

Vercel keeps history; only one **Production** is live. Safe cleanup:

- Deployments → open old Ready rows → **⋯ → Delete** (or rely on **Deployment Retention** already on).  
- Do **not** delete the current Production deploy.  
- Preview/canceled rows can all go.

## GitHub

Required for **code** promotion to Vercel. Not required for DB DDL (Supabase SQL Editor / `docs/sql/` pack).
