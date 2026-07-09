import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, PanelLeft, PanelLeftClose, ShieldOff, ShieldCheck } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { BottomNav, NAV_ITEMS } from "./bottom-nav";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { SyncIndicator } from "./sync-indicator";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSiteSession } from "@/hooks/use-site-session";
import { getActiveUserProfile } from "@/lib/data-store";
import { formatDate } from "@/lib/utils";
import { MedicationAdminModal } from "@/components/medication/medication-admin-modal";

/** Human-readable label for the active user's role. */
function roleLabel(role: string | null | undefined): string {
  if (!role) return "";
  if (role === "coordinator") return "Manager";
  if (role === "driver") return "Driver";
  // Future roles: assistant_manager, guardian, support_worker, dashboard
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Global Day Centre banner — surfaces a hard-lock state to every page when
 * the site session has been NO-GO'd or is mid-escalation. Quietly returns
 * null while the session loads or is in a normal phase.
 */
function SiteNoGoBanner() {
  const q = useSiteSession();
  const session = q.data;
  if (!session) return null;
  if (session.phase !== "closed_no_go" && session.phase !== "escalated_lock")
    return null;
  const isNoGo = session.phase === "closed_no_go";
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-xs md:px-6 ${
        isNoGo
          ? "border-red-600/60 bg-red-600/10 text-red-700"
          : "border-yellow-500/60 bg-yellow-500/10 text-yellow-700"
      }`}
    >
      <div className="flex items-center gap-2">
        <ShieldOff className="h-3.5 w-3.5" />
        <span className="font-semibold uppercase tracking-wide">
          {isNoGo
            ? "Centre closed — NO-GO"
            : "Site locked — escalation in progress"}
        </span>
        <span className="hidden text-[11px] opacity-80 sm:inline">
          {isNoGo
            ? "No client services today."
            : "Manager + Leader dual-PIN handshake required."}
        </span>
      </div>
      <Link to="/day" className="font-semibold underline-offset-2 hover:underline">
        Open Day Centre →
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const current = NAV_ITEMS.find((n) =>
    n.exact ? pathname === n.to : pathname.startsWith(n.to),
  );
  const title = current?.label ?? "Yada Connect";
  const isDashboard = pathname === "/";

  const [medOpen, setMedOpen] = useState(false);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();

  const handleLogout = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      void supabase.auth.signOut();
    } catch {
      // ignore cleanup errors
    }
    queryClient.clear();
    void navigate({ to: "/auth", replace: true });
  };

  // Read profile on the client only — avoids SSR/CSR hydration mismatch
  // because localStorage isn't available on the server.
  const [identity, setIdentity] = useState<{ name: string; role: string } | null>(null);
  useEffect(() => {
    const p = getActiveUserProfile();
    if (p) setIdentity({ name: p.fullName, role: roleLabel(p.role) });
  }, []);

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-2 backdrop-blur md:min-h-16 md:px-6">
          {/* Left: menu toggle (md+) + page title */}
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="hidden h-9 w-9 shrink-0 md:inline-flex"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
            <div className="flex min-w-0 flex-col gap-0">
            <h1 className="truncate text-sm font-semibold tracking-tight md:text-base">
              <span>{title}</span>
              {identity && (
                <span className="ml-2 font-normal text-muted-foreground">
                  — {identity.name}
                  {identity.role && (
                    <span className="ml-1 text-xs uppercase tracking-wide">
                      ({identity.role})
                    </span>
                  )}
                </span>
              )}
            </h1>
            {isDashboard && (
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground tabular-nums">
                {formatDate(new Date())}
              </p>
            )}
            </div>
          </div>

          {/* Right: Med Admin (dashboard only) + sync + logout */}
          <div className="flex shrink-0 items-center gap-2">
            {isDashboard && (
              <Button
                size="sm"
                onClick={() => setMedOpen(true)}
                className="gap-1.5 text-xs"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Record medication admin
              </Button>
            )}
            <SyncIndicator compact />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-red-500 hover:bg-red-50 hover:text-red-600"
            >
              <LogOut className="mr-1.5 h-4 w-4" />
              Log Out
            </Button>
          </div>
        </header>

        <MedicationAdminModal open={medOpen} onOpenChange={setMedOpen} />
        <SiteNoGoBanner />
        <main className="flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
