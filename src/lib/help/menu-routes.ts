/**
 * Map Help topic `menus` keys to app routes for “Open screen” deep-links.
 * Keys align with Admin → Menu Access matrix.
 */

export type HelpDeepLinkTo =
  | "/"
  | "/day"
  | "/manifest"
  | "/transport"
  | "/participants"
  | "/staff"
  | "/run-planning"
  | "/events"
  | "/event-deliver"
  | "/governance"
  | "/admin"
  | "/sync"
  | "/help";

export const HELP_MENU_ROUTES: Record<
  string,
  { to: HelpDeepLinkTo; label: string }
> = {
  dashboard: { to: "/", label: "Open Dashboard" },
  day: { to: "/day", label: "Open Day Centre" },
  manifest: { to: "/manifest", label: "Open Manifest" },
  transport: { to: "/transport", label: "Open Transport" },
  participants: { to: "/participants", label: "Open Participants" },
  staff: { to: "/staff", label: "Open Staff" },
  run_planning: { to: "/run-planning", label: "Open Run Planning" },
  events: { to: "/events", label: "Open Event Manage" },
  "event-deliver": { to: "/event-deliver", label: "Open Event Deliver" },
  governance: { to: "/governance", label: "Open Governance Hub" },
  admin: { to: "/admin", label: "Open Admin" },
  sync: { to: "/sync", label: "Open Sync Queue" },
  help: { to: "/help", label: "Open Help" },
};

/** Prefer a concrete field screen when a topic lists several menus. */
const MENU_DEEP_LINK_PRIORITY = [
  "manifest",
  "day",
  "event-deliver",
  "events",
  "governance",
  "transport",
  "participants",
  "staff",
  "run_planning",
  "admin",
  "sync",
  "dashboard",
] as const;

export function resolveHelpDeepLink(
  menus: string[],
): { to: HelpDeepLinkTo; label: string } | null {
  for (const key of MENU_DEEP_LINK_PRIORITY) {
    if (menus.includes(key) && HELP_MENU_ROUTES[key]) {
      return HELP_MENU_ROUTES[key];
    }
  }
  for (const key of menus) {
    const hit = HELP_MENU_ROUTES[key];
    if (hit) return hit;
  }
  return null;
}
