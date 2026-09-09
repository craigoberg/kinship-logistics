/**
 * Role × menu catalogue and Phase 1 open/deny helpers (BL-002).
 * SoT for Admin → Menu Access keys, nav filter, and route MenuGate.
 */
import {
  ACCESS_ROLES,
  isManagerAccessRole,
  normalizeAccessRoleKey,
  type AccessRoleKey,
} from "@/lib/access-roles";

export type MenuAccessLevel = "none" | "read" | "write";

export type AppMenuKey =
  | "dashboard"
  | "day"
  | "event_deliver"
  | "events"
  | "governance"
  | "rights_voice"
  | "participants"
  | "staff"
  | "run_planning"
  | "transport"
  | "manifest"
  | "sync"
  | "help"
  | "admin"
  | "onboarding"
  | "public_website";

export interface MenuDefinition {
  key: AppMenuKey;
  label: string;
  description: string;
  /** Sidebar/dock path. Null = nested tab (needs parentKey). */
  path: string | null;
  navExact?: boolean;
  parentKey?: AppMenuKey;
}

export const MENU_CATALOGUE: readonly MenuDefinition[] = [
  {
    key: "dashboard",
    label: "Operations Dashboard",
    description: "Live exception hub and escalation pool",
    path: "/",
    navExact: true,
  },
  {
    key: "day",
    label: "Day Centre",
    description: "Site-day workflow, anomalies, handshakes",
    path: "/day",
  },
  {
    key: "event_deliver",
    label: "Event Deliver",
    description: "Field trip-day execution — check-in, programme, rolls",
    path: "/event-deliver",
  },
  {
    key: "events",
    label: "Event Manage",
    description: "Office setup — roster, milestones, finance, Trip Report",
    path: "/events",
  },
  {
    key: "governance",
    label: "Governance Hub",
    description: "Unified issues, incident ledger, NDIS",
    path: "/governance",
  },
  {
    key: "rights_voice",
    label: "Rights & voice",
    description: "Complaints / enquiry / feedback forms → Hub",
    path: "/rights-voice",
  },
  {
    key: "participants",
    label: "Participants",
    description: "Care profiles, IDDSI, medications",
    path: "/participants",
  },
  {
    key: "staff",
    label: "Personnel Directory",
    description: "Staff, carers, certifications",
    path: "/staff",
  },
  {
    key: "run_planning",
    label: "Run Planning",
    description: "All-people Day Centre IN/OUT board and default bus-run order",
    path: "/run-planning",
  },
  {
    key: "transport",
    label: "Transport",
    description: "Ad-hoc run requests and mileage logging",
    path: "/transport",
  },
  {
    key: "manifest",
    label: "Bus Manifest",
    description: "Driver walkaround, run sheet, dual-PIN",
    path: "/manifest",
  },
  {
    key: "sync",
    label: "Sync Queue",
    description: "Offline reconciliation and replay",
    path: "/sync",
  },
  {
    key: "help",
    label: "Help",
    description: "Searchable how-to guides",
    path: "/help",
  },
  {
    key: "admin",
    label: "Admin Configuration",
    description: "Lookups, public website, parameters, access matrix",
    path: "/admin",
  },
  {
    key: "onboarding",
    label: "Onboarding (Hub tab)",
    description: "Client / staff / volunteer / accompanying packs",
    path: null,
    parentKey: "governance",
  },
  {
    key: "public_website",
    label: "Public website (Admin tab)",
    description: "yada.org.au CMS + forms",
    path: null,
    parentKey: "admin",
  },
] as const;

export const MENU_KEYS: readonly AppMenuKey[] = MENU_CATALOGUE.map((m) => m.key);

const MENU_BY_KEY = new Map(MENU_CATALOGUE.map((m) => [m.key, m]));

/** Help topic keys that predate snake_case catalogue keys. */
const MENU_KEY_ALIASES: Record<string, AppMenuKey> = {
  "event-deliver": "event_deliver",
};

export function resolveMenuKey(raw: string | null | undefined): AppMenuKey | null {
  if (!raw) return null;
  if (MENU_BY_KEY.has(raw as AppMenuKey)) return raw as AppMenuKey;
  return MENU_KEY_ALIASES[raw] ?? null;
}

export function getMenuDefinition(key: string): MenuDefinition | undefined {
  const resolved = resolveMenuKey(key);
  return resolved ? MENU_BY_KEY.get(resolved) : undefined;
}

export interface RoleMenuAccessRow {
  roleKey: AccessRoleKey;
  menuKey: AppMenuKey;
  accessLevel: MenuAccessLevel;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export function isOpenAccessLevel(level: MenuAccessLevel | undefined): boolean {
  return level === "read" || level === "write";
}

export function lookupAccessLevel(
  rows: readonly RoleMenuAccessRow[],
  roleKey: string,
  menuKey: string,
): MenuAccessLevel {
  const role = normalizeAccessRoleKey(roleKey);
  const menu = resolveMenuKey(menuKey);
  if (!role || !menu) return "none";
  return (
    rows.find((r) => r.roleKey === role && r.menuKey === menu)?.accessLevel ?? "none"
  );
}

/**
 * Can this role open the screen / tab?
 * Manager always yes. Missing table / still loading fail open so SQL rollout
 * does not brick the office. Missing row after a successful load = deny.
 */
export function canOpenMenu(
  accessRole: string | null | undefined,
  menuKey: string,
  rows: readonly RoleMenuAccessRow[] | null,
  opts?: { tableUnavailable?: boolean; stillLoading?: boolean },
): boolean {
  if (isManagerAccessRole(accessRole)) return true;
  if (opts?.tableUnavailable) return true;
  if (opts?.stillLoading || rows === null) return true;

  const role = normalizeAccessRoleKey(accessRole);
  if (!role) return false;

  const def = getMenuDefinition(menuKey);
  const key = def?.key ?? resolveMenuKey(menuKey);
  if (!key) return false;

  if (def?.parentKey && !isOpenAccessLevel(lookupAccessLevel(rows, role, def.parentKey))) {
    return false;
  }
  return isOpenAccessLevel(lookupAccessLevel(rows, role, key));
}

export function pathToMenuKey(pathname: string): AppMenuKey | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (path === "/") return "dashboard";
  let best: { key: AppMenuKey; len: number } | null = null;
  for (const menu of MENU_CATALOGUE) {
    if (!menu.path || menu.path === "/") continue;
    if (path === menu.path || path.startsWith(`${menu.path}/`)) {
      const len = menu.path.length;
      if (!best || len > best.len) best = { key: menu.key, len };
    }
  }
  return best?.key ?? null;
}

export type MenuPath = Exclude<(typeof MENU_CATALOGUE)[number]["path"], null>;

export function firstGrantedPath(
  accessRole: string | null | undefined,
  rows: readonly RoleMenuAccessRow[] | null,
  opts?: { tableUnavailable?: boolean; stillLoading?: boolean },
): MenuPath {
  for (const menu of MENU_CATALOGUE) {
    if (!menu.path) continue;
    if (canOpenMenu(accessRole, menu.key, rows, opts)) return menu.path;
  }
  return "/";
}

/** Seed used by SQL and as documentation — Manager is also hard-coded in canOpenMenu. */
export const DEFAULT_WRITE_MENUS: Record<AccessRoleKey, readonly AppMenuKey[]> = {
  manager: MENU_KEYS,
  assistant_manager: MENU_KEYS,
  support_worker: [
    "dashboard",
    "day",
    "event_deliver",
    "manifest",
    "participants",
    "help",
    "sync",
  ],
  driver: ["dashboard", "manifest", "transport", "help", "sync"],
  guardian: ["dashboard", "help"],
  dashboard: ["dashboard", "help"],
};

export { ACCESS_ROLES };
