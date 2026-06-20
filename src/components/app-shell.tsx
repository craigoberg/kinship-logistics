import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { BottomNav, NAV_ITEMS } from "./bottom-nav";
import { SyncIndicator } from "./sync-indicator";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

function handleLogout() {
  try {
    localStorage.clear();
    sessionStorage.clear();
    void supabase.auth.signOut();
  } catch {
    // ignore cleanup errors
  }
  window.location.href = "/auth";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = NAV_ITEMS.find((n) =>
    n.exact ? pathname === n.to : pathname.startsWith(n.to),
  );
  const title = current?.label ?? "Yada Connect";

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur md:h-16 md:px-6">
          <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">
            {title}
          </h1>
          <div className="flex items-center gap-2">
            <SyncIndicator compact />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
            >
              <LogOut className="mr-1.5 h-4 w-4" />
              Log Out
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
