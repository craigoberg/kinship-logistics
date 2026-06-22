/**
 * IS_TEST_BUILD — true only on local dev and Lovable preview URLs.
 *
 * Published `*.lovable.app` builds and custom domains return false, so any UI
 * gated by this flag (the "rewind" / reset buttons we use during QA) is
 * stripped from what real users see.
 *
 * Escape hatch: set `VITE_SHOW_TEST_TOOLS=true` at build time to surface the
 * test affordances on a published build for a one-off QA pass.
 */
function computeIsTestBuild(): boolean {
  // Vite dev server (always a test surface).
  if (import.meta.env.DEV) return true;

  // Build-time opt-in for QA on a published build.
  if (import.meta.env.VITE_SHOW_TEST_TOOLS === "true") return true;

  if (typeof window === "undefined") return false;

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;

  // Lovable preview hosts look like `id-preview--<uuid>.lovable.app`
  // (or any host containing `id-preview--`). Published hosts do not.
  if (host.includes("id-preview--")) return true;

  return false;
}

export const IS_TEST_BUILD: boolean = computeIsTestBuild();
