import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "./app-sidebar";
import { BottomNav, NAV_ITEMS } from "./bottom-nav";
import { SyncIndicator } from "./sync-indicator";

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
          <SyncIndicator compact />
        </header>
        <main className="flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
