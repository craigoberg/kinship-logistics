# Environments: DEV → TEST → PROD (BL-099)

**Status:** Day login shipped on DEV. TEST Supabase (Australia) stood up. **App host = Vercel** (Hobby → Pro for commercial/PROD). Lovable abandoned as host.

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

Supabase Dashboard **cannot** restore Project A into Project B. Use the **app** JSON backup for **data**, and a **schema dump** for empty TEST tables.

### Order (do not skip)

1. **DEV data dump (done when you have the `.json`)**  
   App on DEV → Admin → Backup & Restore → download.
2. **Schema onto empty TEST** (required — JSON restore does not create tables)  
   **Preferred (no pg_dump):** run in TEST SQL Editor:  
   `docs/sql/2026-07-29_test_bootstrap_create_tables.sql`  
   (CREATE TABLE shells + permissive anon RLS from live DEV OpenAPI — **not** a full FK/RPC clone).
3. **Backup RPCs on TEST**  
   Run `docs/sql/2026-07-11_backup_restore_rpcs.sql` in TEST SQL Editor.
4. **Core PIN/auth RPCs on TEST** (app login needs these — not in the JSON):  
   At minimum re-apply from `docs/sql/` the PIN verify / manager helpers you use on DEV  
   (e.g. `2026-06-21_verify_operator_pin_sha256.sql`, `2026-07-04_fix_is_manager_staff_auth_link.sql`, `2026-07-12_system_parameters_pin_save.sql`).  
   If something 404s later, we add the specific RPC file.
5. **Point local app at TEST** (temp `.env` — never commit):  
   - `VITE_SUPABASE_URL` / `SUPABASE_URL` = TEST URL  
   - `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` = TEST anon  
   - `SUPABASE_SERVICE_ROLE_KEY` = TEST service_role (server only; never `VITE_`)  
   - `VITE_APP_LANE=test`
6. **Restore JSON** in app → Admin → Backup & Restore (Manager PIN).  
   For Alpha, restore `staff_registry` (leave “preserve local login” **off** unless you know you need it).
7. **Auth users on TEST** (not in JSON): Authentication → create day-login emails; optional `docs/sql/2026-07-28_staff_auth_user_link_backfill.sql`.
8. Smoke → then point env back to DEV when done building.

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
| **Reference / seed data** | Optional: Admin JSON backup DEV → restore TEST (overwrites TEST data). Not every week by default. |
| **Auth users / passwords** | Recreate or invite per Supabase project (not in JSON backup). |
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
4. **TEST** Lovable (or TEST host) always has TEST `.env` — never swap.  
5. PROD later = third Supabase + third host + `VITE_IS_PRODUCTION=true`.

## GitHub

Required for **code** promotion to Lovable. Not required for DB DDL (that’s Supabase SQL Editor / migration pack).
