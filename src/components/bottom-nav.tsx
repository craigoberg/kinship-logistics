import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Users, Truck, RefreshCw, Settings, CalendarRange, Contact2, Route as RouteIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/participants", label: "Participants", icon: Users, exact: false },
  { to: "/events", label: "Events", icon: CalendarRange, exact: false },
  { to: "/staff", label: "Staff", icon: Contact2, exact: false },
  { to: "/transport", label: "Transport", icon: Truck, exact: false },
  { to: "/manifest", label: "Manifest", icon: RouteIcon, exact: false },
  { to: "/sync", label: "Sync Queue", icon: RefreshCw, exact: false },
  { to: "/admin", label: "Admin", icon: Settings, exact: false },
] as const;



export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-8">
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
