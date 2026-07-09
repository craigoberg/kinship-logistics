import { Link, useRouterState } from "@tanstack/react-router";
import { HeartHandshake, AlertTriangle, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_ITEMS } from "./bottom-nav";
import { SyncIndicator } from "./sync-indicator";
import { cn } from "@/lib/utils";
import { useNoShowWatch } from "@/hooks/use-no-show-watch";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { count: noShowCount, thresholdMinutes } = useNoShowWatch();

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "hidden shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200 ease-in-out md:flex",
          collapsed ? "w-14" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-border",
            collapsed ? "justify-center px-0" : "gap-2 px-3",
          )}
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <HeartHandshake className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
                Yada Connect
              </div>
              <div className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
                Care Coordination
              </div>
            </div>
          )}
          {!collapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground"
                  onClick={onToggle}
                  aria-label="Collapse menu"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Collapse menu</TooltipContent>
            </Tooltip>
          )}
        </div>

        {collapsed && (
          <div className="flex justify-center border-b border-border py-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground"
                  onClick={onToggle}
                  aria-label="Expand menu"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand menu</TooltipContent>
            </Tooltip>
          </div>
        )}

        {noShowCount > 0 && !collapsed && (
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

        {noShowCount > 0 && collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/day"
                className="mx-auto mt-2 flex h-9 w-9 items-center justify-center rounded-md border border-yellow-500/60 bg-yellow-500/10 text-yellow-700"
                aria-label={`${noShowCount} clients overdue`}
              >
                <AlertTriangle className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">
              {noShowCount} client{noShowCount === 1 ? "" : "s"} overdue
            </TooltipContent>
          </Tooltip>
        )}

        <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              const Icon = item.icon;
              const link = (
                <Link
                  to={item.to}
                  className={cn(
                    "flex items-center rounded-md text-sm font-medium transition-colors",
                    collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );

              return (
                <li key={item.to}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={cn("shrink-0 border-t border-border", collapsed ? "p-2" : "p-3")}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex justify-center">
                  <SyncIndicator compact />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Sync status</TooltipContent>
            </Tooltip>
          ) : (
            <SyncIndicator className="w-full justify-start" />
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
