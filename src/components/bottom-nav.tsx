import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Truck,
  RefreshCw,
  Settings,
  CalendarRange,
  Compass,
  Contact2,
  Bus,
  Route as RouteIcon,
  Scale,
  Sun,
  Menu,
  CircleHelp,
  MessageCircleHeart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useMenuAccess } from "@/hooks/use-menu-access";
import { useChromeVisibility } from "@/hooks/chrome-visibility";
import { pathToMenuKey } from "@/lib/menu-access";

export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/day", label: "Day Centre", icon: Sun, exact: false },
  { to: "/event-deliver", label: "Event Deliver", icon: Compass, exact: false },
  { to: "/events", label: "Event Manage", icon: CalendarRange, exact: false },
  { to: "/governance", label: "Governance Hub", icon: Scale, exact: false },
  { to: "/rights-voice", label: "Rights & voice", icon: MessageCircleHeart, exact: false },
  { to: "/participants", label: "Participants", icon: Users, exact: false },
  { to: "/staff", label: "Staff", icon: Contact2, exact: false },
  { to: "/run-planning", label: "Run Planning", icon: Bus, exact: false },
  { to: "/transport", label: "Transport", icon: Truck, exact: false },
  { to: "/manifest", label: "Manifest", icon: RouteIcon, exact: false },
  { to: "/sync", label: "Sync Queue", icon: RefreshCw, exact: false },
  { to: "/help", label: "Help", icon: CircleHelp, exact: false },
  { to: "/admin", label: "Admin", icon: Settings, exact: false },
] as const;

/** Always-visible quick links on the mobile dock (most-used destinations). */
const DOCK_PATHS = ["/", "/day", "/event-deliver", "/manifest"] as const;

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

const DOCK_COL_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

function navItemVisible(
  item: (typeof NAV_ITEMS)[number],
  canOpen: (key: string) => boolean,
): boolean {
  const key = pathToMenuKey(item.to);
  return !key || canOpen(key);
}

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const { canOpen } = useMenuAccess();
  const { chromeHidden } = useChromeVisibility();
  const visibleItems = NAV_ITEMS.filter((item) => navItemVisible(item, canOpen));
  const visibleDock = DOCK_ITEMS.filter((item) => navItemVisible(item, canOpen));

  // Close menu sheet after navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const activeInDock = visibleDock.some((item) => isNavActive(pathname, item));
  const activeOutsideDock = visibleItems.some(
    (item) => isNavActive(pathname, item) && !(DOCK_PATHS as readonly string[]).includes(item.to),
  );

  return (
    <>
      <nav
        aria-label="Primary"
        aria-hidden={chromeHidden}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur transition-transform duration-200 md:hidden",
          chromeHidden && "translate-y-full pointer-events-none",
        )}
      >
        <ul className={cn("grid", DOCK_COL_CLASS[visibleDock.length + 1] ?? "grid-cols-5")}>
          {visibleDock.map((item) => (
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
          {visibleItems.map((item) => {
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
