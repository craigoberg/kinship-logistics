import { supabase } from "@/integrations/supabase/client";
import {
  isManagerAccessRole,
  normalizeAccessRoleKey,
  type AccessRoleKey,
} from "@/lib/access-roles";
import { getActiveUserProfile, persistActiveUserProfile } from "@/lib/data-store";
import {
  resolveMenuKey,
  type AppMenuKey,
  type MenuAccessLevel,
  type RoleMenuAccessRow,
} from "@/lib/menu-access";

interface RoleMenuAccessDbRow {
  role_key: string;
  menu_key: string;
  access_level: string;
  updated_at?: string | null;
  updated_by?: string | null;
}

function toRow(r: RoleMenuAccessDbRow): RoleMenuAccessRow | null {
  const roleKey = normalizeAccessRoleKey(r.role_key);
  const menuKey = resolveMenuKey(r.menu_key);
  const accessLevel = r.access_level;
  if (!roleKey || !menuKey) return null;
  if (accessLevel !== "none" && accessLevel !== "read" && accessLevel !== "write") {
    return null;
  }
  return {
    roleKey,
    menuKey,
    accessLevel,
    updatedAt: r.updated_at ?? null,
    updatedBy: r.updated_by ?? null,
  };
}

export function isRoleMenuAccessTableMissing(
  error: { code?: string | null; message?: string | null; details?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01" || error.code === "PGRST204") {
    return true;
  }
  const blob = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    blob.includes("role_menu_access") &&
    (blob.includes("does not exist") ||
      blob.includes("schema cache") ||
      blob.includes("could not find") ||
      blob.includes("not find the table"))
  );
}

export async function listRoleMenuAccess(): Promise<RoleMenuAccessRow[]> {
  const { data, error } = await supabase
    .from("role_menu_access")
    .select("role_key, menu_key, access_level, updated_at, updated_by");
  if (error) throw error;
  return ((data ?? []) as RoleMenuAccessDbRow[])
    .map(toRow)
    .filter((r): r is RoleMenuAccessRow => r != null);
}

export async function upsertRoleMenuAccess(args: {
  roleKey: AccessRoleKey;
  menuKey: AppMenuKey;
  accessLevel: MenuAccessLevel;
}): Promise<void> {
  const profile = getActiveUserProfile();
  if (!isManagerAccessRole(profile?.accessRole)) {
    throw new Error("Only Managers can change menu access.");
  }
  const { error } = await supabase.from("role_menu_access").upsert(
    {
      role_key: args.roleKey,
      menu_key: args.menuKey,
      access_level: args.accessLevel,
      updated_by: profile?.staffId ?? null,
    },
    { onConflict: "role_key,menu_key" },
  );
  if (error) throw error;
}

export async function hydrateAccessRoleOnProfile(): Promise<string | null> {
  const profile = getActiveUserProfile();
  if (!profile) return null;
  const existing = normalizeAccessRoleKey(profile.accessRole);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("staff_registry")
    .select("personnel_type")
    .eq("id", profile.staffId)
    .maybeSingle();
  if (error || !data) return null;
  const role = normalizeAccessRoleKey(
    (data as { personnel_type?: string | null }).personnel_type ?? null,
  );
  if (role) {
    persistActiveUserProfile({ ...profile, accessRole: role });
  }
  return role;
}
