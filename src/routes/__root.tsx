import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { getActiveUserRole } from "../lib/data-store";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { AppShell } from "../components/app-shell";
import { NotificationSimulator } from "../components/ui/NotificationSimulator";
// Multi-device handshake interceptor retired — single-user verbal model now drives all RED handling.
// (GlobalEscalationInterceptor file preserved on disk as inactive fallback.)
import { RouteRehydrationGuardian } from "../components/dashboard/route-rehydration-guardian";
import { GlobalIncidentIntakeDrawer } from "../components/global/global-incident-intake-drawer";
import { GlobalRaiseTicketDrawer } from "../components/global/global-raise-ticket-drawer";
import { TicketSurfaceProvider } from "../lib/app-tickets/ticket-surface";
import { Toaster } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { DevOperationalClockBar } from "../components/dev/dev-operational-clock-bar";
import { IdleLockGate } from "../components/auth/idle-lock-gate";
import {
  markOperationalClockClientReady,
} from "@/lib/operational-clock";
import "@/lib/operational-clock"; // register DEV now-provider early

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Yada Connect — Community Care Coordination" },
      { name: "description", content: "Mobile-first PWA for community care coordinators: participants, IDDSI, transport logs, offline sync." },
      { name: "author", content: "Yada Connect" },
      { name: "theme-color", content: "#1f4fbf" },
      { property: "og:title", content: "Yada Connect" },
      { property: "og:description", content: "Service coordination platform for community care organizations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Lora:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function isPublicSitePath(pathname: string): boolean {
  return pathname === "/public" || pathname.startsWith("/public/");
}

function AuthGate() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, isReady } = useAuthReady();

  useEffect(() => {
    if (pathname === "/auth") return;
    // BL-110: yada.org.au public site routes — no day-login / PIN.
    if (isPublicSitePath(pathname)) return;
    // Wait for Supabase session hydrate before deciding.
    if (!isReady) return;
    // BL-099: day session (Auth) required, then PIN profile (role).
    const role = getActiveUserRole();
    if (!user || !role) {
      navigate({ to: "/auth", replace: true });
    }
  }, [navigate, pathname, user, isReady]);

  return null;
}

function RoleAwareGuardians() {
  // Read role per render so a sign-in immediately flips the gate set.
  const role =
    typeof window !== "undefined" ? getActiveUserRole() : null;

  // Multi-device RED interceptor removed — every RED now flows through the
  // canonical VerbalConsultationDialog locally. Drivers keep the route
  // rehydration guardian; everyone keeps the global incident intake drawer.
  return (
    <>
      {role === "driver" && <RouteRehydrationGuardian />}
      <GlobalIncidentIntakeDrawer />
      <GlobalRaiseTicketDrawer />
    </>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAuthRoute = pathname === "/auth";
  const isPublicRoute = isPublicSitePath(pathname);

  // Unlock SIM TIME after paint so lazy routes (e.g. Event Deliver) finish
  // hydrating against the same "live" date the server rendered.
  useEffect(() => {
    const id = window.setTimeout(() => markOperationalClockClientReady(), 0);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Root provider so global overlays (Big Red Incident) work outside AppShell. */}
      <TooltipProvider delayDuration={300}>
        <TicketSurfaceProvider>
        <AuthGate />
        {isAuthRoute || isPublicRoute ? (
          // Bare shell — auth login or public yada.org.au pages (BL-110).
          <Outlet />
        ) : (
          <>
            <DevOperationalClockBar />
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <AppShell>
              <Outlet />
            </AppShell>
            <IdleLockGate />
            <NotificationSimulator />
            <RoleAwareGuardians />
          </>
        )}
        <Toaster />
        </TicketSurfaceProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
