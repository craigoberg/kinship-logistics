## Gate test-only buttons so they never appear on the published site

Introduce a single boolean flag and a tiny wrapper component, then use it for the Reset Start of Day button (and every future "rewind" affordance).

### How we detect "not published"

Lovable's preview/dev builds and the published build are the same Vite build, so `import.meta.env.DEV` is not enough. Two reliable signals exist client-side:

1. `import.meta.env.DEV` — true under `vite dev` only.
2. `window.location.hostname` — published sites are served from `*.lovable.app` (or a custom domain). Preview links are `id-preview--*.lovable.app`; local dev is `localhost` / `127.0.0.1`.

Combining them covers all the cases the user cares about.

### Files

1. **New `src/lib/test-mode.ts`** — exports:
   ```ts
   export const IS_TEST_BUILD: boolean =
     import.meta.env.DEV ||
     (typeof window !== "undefined" &&
       /^(localhost|127\.0\.0\.1|.*\.id-preview\..*|id-preview--.*\.lovable\.app)$/.test(
         window.location.hostname,
       ));
   ```
   Published `*.lovable.app` (non-preview) and custom domains return `false`.

2. **New `src/components/dev/test-only.tsx`** — `<TestOnly>{children}</TestOnly>` that returns `null` when `!IS_TEST_BUILD`. Optional `label` prop renders a small amber "TEST" chip above the children so we visually know these are dev affordances.

3. **`src/components/site-day/day-closed-panel.tsx`** + **`src/components/site-day/start-of-day-panel.tsx`** — wrap the upcoming Reset Start of Day button in `<TestOnly>`. Every future rewind button follows the same pattern.

### Optional escape hatch

Add a `VITE_SHOW_TEST_TOOLS` env var check inside `IS_TEST_BUILD` (`|| import.meta.env.VITE_SHOW_TEST_TOOLS === "true"`) so we can temporarily enable test tools on a published build if we ever need to QA there. Off by default.

### Out of scope

No server-side gating (these are UI-only test buttons; the underlying `resetStartOfDay` server function stays callable — that's fine for now and matches the existing `setPhase` test surface). If we later want hard server-side blocks, we add a Manager-role + `IS_TEST_BUILD` check in the handler.
