/**
 * IS_TEST_BUILD — surfaces DEV/QA tools (SIM clock, Reset Start of Day,
 * Simulate offline, etc.).
 *
 * This is NOT a Supabase/server secret. `VITE_*` vars are public build flags
 * that end up in the browser bundle — safe for "show test UI", never for keys.
 *
 * True when:
 * - Vite `npm run dev` / localhost
 * - Lovable preview (`id-preview--…`)
 * - Published `*.lovable.app` / `*.lovable.dev` while we only have a DEV lane
 *   (BL-099 — no TEST/PROD yet). Turn off later with `VITE_IS_PRODUCTION=true`.
 * - Explicit `VITE_SHOW_TEST_TOOLS=true` or `VITE_APP_LANE=dev|test`
 *
 * False when:
 * - `VITE_IS_PRODUCTION=true` (future PROD lane)
 * - `VITE_SHOW_TEST_TOOLS=false` (opt out even on Lovable)
 */
function computeIsTestBuild(): boolean {
  // Future PROD lane — never show rewind / simulate-offline tools.
  if (import.meta.env.VITE_IS_PRODUCTION === "true") return false;

  // Explicit opt-out (e.g. demo build that must look like field).
  if (import.meta.env.VITE_SHOW_TEST_TOOLS === "false") return false;

  // Vite dev server.
  if (import.meta.env.DEV) return true;

  // Explicit lane / tools flag (set in `.env` — not a secret).
  const lane = String(import.meta.env.VITE_APP_LANE ?? "").toLowerCase();
  if (lane === "dev" || lane === "test") return true;
  if (import.meta.env.VITE_SHOW_TEST_TOOLS === "true") return true;

  if (typeof window === "undefined") return false;

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;

  // Lovable preview hosts.
  if (host.includes("id-preview--")) return true;

  // Current single-lane DEV: published Lovable app is still our builder/Alpha host.
  // When BL-099 PROD ships, use a separate host + VITE_IS_PRODUCTION=true.
  if (host.endsWith(".lovable.app") || host.endsWith(".lovable.dev")) return true;

  return false;
}

export const IS_TEST_BUILD: boolean = computeIsTestBuild();
