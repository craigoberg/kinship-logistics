import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMenuAccess } from "@/hooks/use-menu-access";
import { pathToMenuKey } from "@/lib/menu-access";

/**
 * Blocks typed URLs / Help deep-links to menus the role cannot open.
 * Hide-from-nav is UX; this is the actual Phase 1 gate.
 */
export function MenuGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { canOpen, firstGrantedPath, isLoading } = useMenuAccess();
  const menuKey = pathToMenuKey(pathname);

  if (!menuKey || isLoading || canOpen(menuKey)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <Lock className="mb-3 h-8 w-8 text-muted-foreground" />
      <h2 className="text-lg font-semibold tracking-tight">No access to this screen</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Your role is not granted this menu. A Manager can change that under Admin →
        Menu Access.
      </p>
      <Button asChild className="mt-6">
        <Link to={firstGrantedPath}>Go to an available screen</Link>
      </Button>
    </div>
  );
}
