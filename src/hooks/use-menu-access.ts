import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { getActiveUserProfile } from "@/lib/data-store";
import { isManagerAccessRole, normalizeAccessRoleKey } from "@/lib/access-roles";
import { canOpenMenu, firstGrantedPath } from "@/lib/menu-access";
import {
  hydrateAccessRoleOnProfile,
  isRoleMenuAccessTableMissing,
  listRoleMenuAccess,
} from "@/lib/api/role-menu-access";

export const ROLE_MENU_ACCESS_QUERY_KEY = ["role-menu-access"] as const;

export function useMenuAccess() {
  const { user, isReady } = useAuthReady();
  const signedIn = isReady && !!user;

  const hydrateQ = useQuery({
    queryKey: ["menu-access", "hydrate-role"],
    queryFn: hydrateAccessRoleOnProfile,
    enabled: signedIn && !!getActiveUserProfile(),
    staleTime: 5 * 60_000,
  });

  const grantsQ = useQuery({
    queryKey: ROLE_MENU_ACCESS_QUERY_KEY,
    queryFn: listRoleMenuAccess,
    staleTime: 30_000,
    enabled: signedIn,
    retry: (count, err) => !isRoleMenuAccessTableMissing(err as { code?: string }) && count < 2,
  });

  const accessRole =
    normalizeAccessRoleKey(hydrateQ.data) ??
    normalizeAccessRoleKey(getActiveUserProfile()?.accessRole) ??
    null;

  const tableUnavailable = isRoleMenuAccessTableMissing(
    grantsQ.error as { code?: string; message?: string } | null,
  );
  const stillLoading = grantsQ.isPending && !grantsQ.isError;
  const rows = grantsQ.data ?? null;

  const opts = useMemo(
    () => ({ tableUnavailable, stillLoading }),
    [tableUnavailable, stillLoading],
  );

  return {
    accessRole,
    rows,
    tableUnavailable,
    isLoading: stillLoading,
    canEditMatrix: isManagerAccessRole(accessRole),
    canOpen: (menuKey: string) => canOpenMenu(accessRole, menuKey, rows, opts),
    firstGrantedPath: firstGrantedPath(accessRole, rows, opts),
    refetch: grantsQ.refetch,
  };
}
