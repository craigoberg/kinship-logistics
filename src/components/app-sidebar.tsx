import { Link, useRouterState } from "@tanstack/react-router";
import { HeartHandshake, AlertTriangle } from "lucide-react";
import { NAV_ITEMS } from "./bottom-nav";
import { SyncIndicator } from "./sync-indicator";
import { cn } from "@/lib/utils";
import { useNoShowWatch } from "@/hooks/use-no-show-watch";

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { count: noShowCount, thresholdMinutes } = useNoShowWatch();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <HeartHandshake className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
            Yada Connect
          </div>
          <div className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
            Care Coordination
          </div>
        </div>
      </div>

      {noShowCount > 0 && (
        <Link
          to="/day"
          className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-yellow-500/60 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 transition-colors hover:bg-yellow-500/20"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-semibold">
              {noShowCount} client{noShowCount === 1 ? "" : "s"} overdue
            </span>
            <span className="block opacity-80">
              No check-in past {thresholdMinutes} min
            </span>
          </span>
        </Link>
      )}

      <nav aria-label="Primary" className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-3">
        <SyncIndicator className="w-full justify-start" />
      </div>
    </aside>
  );
}
