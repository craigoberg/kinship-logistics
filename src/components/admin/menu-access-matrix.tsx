import { Lock, ShieldCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ACCESS_ROLES, type AccessRoleKey } from "@/lib/access-roles";
import {
  MENU_CATALOGUE,
  isOpenAccessLevel,
  lookupAccessLevel,
  type AppMenuKey,
} from "@/lib/menu-access";
import { upsertRoleMenuAccess } from "@/lib/api/role-menu-access";
import {
  ROLE_MENU_ACCESS_QUERY_KEY,
  useMenuAccess,
} from "@/hooks/use-menu-access";

export function MenuAccessMatrix() {
  const queryClient = useQueryClient();
  const { canEditMatrix, rows, tableUnavailable, isLoading } = useMenuAccess();

  const save = useMutation({
    mutationFn: upsertRoleMenuAccess,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ROLE_MENU_ACCESS_QUERY_KEY });
    },
    onError: (err) => {
      toast.error("Could not save menu access", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  if (!canEditMatrix) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
        <Lock className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">Manager-only area</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Only a Manager (SYSTEM ACCESS LEVEL) can change the Menu Access matrix.
        </p>
      </div>
    );
  }

  if (tableUnavailable) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
        <p className="text-sm font-medium">Menu Access table is not on this database yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Run <code>docs/sql/2026-09-08_role_menu_access.sql</code> in the SQL Editor, then
          hard-refresh.
        </p>
      </div>
    );
  }

  const grants = rows ?? [];

  const onToggle = (roleKey: AccessRoleKey, menuKey: AppMenuKey, next: boolean) => {
    if (roleKey === "manager") return;
    save.mutate({
      roleKey,
      menuKey,
      accessLevel: next ? "write" : "none",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Menu Access Control</h2>
          <p className="text-sm text-muted-foreground">
            Tick a cell to let that SYSTEM ACCESS LEVEL open the menu. Manager is
            always on (failsafe). Changes save as you tap.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <ShieldCheck className="h-3.5 w-3.5" /> Manager-only
        </Badge>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 min-w-[220px] bg-card">
                Menu / Screen
              </TableHead>
              {ACCESS_ROLES.map((role) => (
                <TableHead key={role.key} className="whitespace-nowrap text-center">
                  {role.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {MENU_CATALOGUE.map((menu) => (
              <TableRow key={menu.key}>
                <TableCell className="sticky left-0 bg-card align-top">
                  <div className="font-medium">{menu.label}</div>
                  <div className="text-xs text-muted-foreground">{menu.description}</div>
                </TableCell>
                {ACCESS_ROLES.map((role) => {
                  const locked = role.key === "manager";
                  const checked =
                    locked ||
                    isOpenAccessLevel(lookupAccessLevel(grants, role.key, menu.key));
                  return (
                    <TableCell key={role.key} className="text-center">
                      <Checkbox
                        aria-label={`${role.label} can access ${menu.label}`}
                        checked={checked}
                        disabled={locked || isLoading || save.isPending}
                        onCheckedChange={(v) =>
                          onToggle(role.key, menu.key, v === true)
                        }
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Phase 1 is open / hide only. Read-only and per-person scope (e.g. a carer
        seeing one client) come later — they are not extra ticks on this grid.
      </p>
    </div>
  );
}
