import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Truck,
  RefreshCw,
  Settings,
  CalendarRange,
  Contact2,
  Route as RouteIcon,
  Scale,
  Sun,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";

export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/day", label: "Day Centre", icon: Sun, exact: false },
  { to: "/governance", label: "Governance Hub", icon: Scale, exact: false },
  { to: "/participants", label: "Participants", icon: Users, exact: false },
  { to: "/events", label: "Events", icon: CalendarRange, exact: false },
  { to: "/staff", label: "Staff", icon: Contact2, exact: false },
  { to: "/transport", label: "Transport", icon: Truck, exact: false },
  { to: "/manifest", label: "Manifest", icon: RouteIcon, exact: false },
  { to: "/sync", label: "Sync Queue", icon: RefreshCw, exact: false },
  { to: "/admin", label: "Admin", icon: Settings, exact: false },
] as const;

/** Always-visible quick links on the mobile dock (most-used destinations). */
const DOCK_PATHS = ["/", "/day", "/events", "/manifest"] as const;

const DOCK_ITEMS = NAV_ITEMS.filter((item) =>
  (DOCK_PATHS as readonly string[]).includes(item.to),
);

function isNavActive(pathname: string, item: (typeof NAV_ITEMS)[number]): boolean {
  return item.exact ? pathname === item.to : pathname.startsWith(item.to);
}

function NavLinkButton({
  item,
  active,
  onNavigate,
  className,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={cn(
        "flex min-h-14 touch-manipulation flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className={cn("h-5 w-5 shrink-0", active && "stroke-[2.5]")} />
      <span className="max-w-full truncate leading-tight">{item.label}</span>
    </Link>
  );
}

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu sheet after navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const activeInDock = DOCK_ITEMS.some((item) => isNavActive(pathname, item));
  const activeOutsideDock = NAV_ITEMS.some(
    (item) => isNavActive(pathname, item) && !(DOCK_PATHS as readonly string[]).includes(item.to),
  );

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5">
          {DOCK_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLinkButton item={item} active={isNavActive(pathname, item)} />
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className={cn(
                "flex min-h-14 w-full touch-manipulation flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors",
                menuOpen || activeOutsideDock
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Open navigation menu"
              aria-expanded={menuOpen}
            >
              <Menu className={cn("h-5 w-5 shrink-0", (menuOpen || activeOutsideDock) && "stroke-[2.5]")} />
              <span className="leading-tight">Menu</span>
            </button>
          </li>
        </ul>
      </nav>

      <BottomSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Navigation"
        description="All app sections"
        className="z-50"
      >
        <div className="grid grid-cols-3 gap-2">
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "flex min-h-[4.5rem] touch-manipulation flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-3 text-center text-xs font-semibold transition active:scale-[0.98]",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/30 text-foreground hover:bg-muted/60",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className={cn("h-6 w-6 shrink-0", active && "stroke-[2.5]")} />
                <span className="line-clamp-2 leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
        {!activeInDock && activeOutsideDock && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Current page is outside the quick dock — use the grid above to switch.
          </p>
        )}
      </BottomSheet>
    </>
  );
}
