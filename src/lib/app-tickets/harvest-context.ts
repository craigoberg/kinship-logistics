import { useMemo } from "react";
import { useRouterState } from "@tanstack/react-router";

import { useSiteSession } from "@/hooks/use-site-session";
import {
  getActiveUserProfile,
  getStaffId,
  resolveStaffDisplayName,
} from "@/lib/data-store";
import { isOperationalClockOverridden, operationalNowIso } from "@/lib/operational-clock";
import { getAppLaneBadge, IS_TEST_BUILD } from "@/lib/test-mode";
import type { AppTicketContext } from "@/lib/api/app-tickets";

export interface HarvestedOpsContext {
  path: string;
  pathLabel: string;
  vehicleId?: string;
  eventId?: string;
  eventTitle?: string;
  eventDaySessionId?: string;
  siteDaySessionId?: string;
  siteDayPhase?: string;
}

export function pathLabelFromPathname(pathname: string, eventTitle?: string): string {
  if (pathname.startsWith("/day")) return "Day Centre";
  if (pathname.startsWith("/manifest")) return "Driver manifest";
  if (pathname.startsWith("/event-deliver")) {
    return eventTitle ? `Event Deliver: ${eventTitle}` : "Event Deliver";
  }
  if (pathname.startsWith("/events")) {
    return eventTitle ? `Event: ${eventTitle}` : "Events";
  }
  if (pathname.startsWith("/transport")) return "Transport";
  if (pathname.startsWith("/governance")) return "Governance Hub";
  if (pathname.startsWith("/admin")) return "Admin";
  if (pathname.startsWith("/help")) return "Help";
  if (pathname.startsWith("/participants")) return "Participants";
  if (pathname === "/" || pathname.startsWith("/dashboard")) return "Dashboard";
  return pathname.replace(/^\//, "") || "App";
}

export function useHarvestedOpsContext(): HarvestedOpsContext {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const siteSessionQ = useSiteSession();

  return useMemo(() => {
    const ls = typeof window !== "undefined" ? window.localStorage : null;
    const eventTitle = ls?.getItem("yada.activeEventTitle") ?? undefined;
    const eventId = ls?.getItem("yada.activeEventId") ?? undefined;
    const eventDaySessionId = ls?.getItem("yada.activeEventDaySessionId") ?? undefined;
    const vehicleId = ls?.getItem("yada.activeVehicleId") ?? undefined;

    return {
      path: pathname,
      pathLabel: pathLabelFromPathname(pathname, eventTitle),
      vehicleId: pathname.startsWith("/manifest") ? vehicleId : undefined,
      eventId,
      eventTitle,
      eventDaySessionId,
      siteDaySessionId: siteSessionQ.data?.id,
      siteDayPhase: siteSessionQ.data?.phase,
    };
  }, [pathname, siteSessionQ.data?.id, siteSessionQ.data?.phase]);
}

export function buildAppTicketContext(args: {
  ops: HarvestedOpsContext;
  formTitle: string | null;
  lastControlLabel: string | null;
}): AppTicketContext {
  const profile = getActiveUserProfile();
  const staffId = profile?.staffId || getStaffId() || null;
  const staffName = profile?.fullName || resolveStaffDisplayName(staffId);
  const lane = IS_TEST_BUILD ? getAppLaneBadge() : "PROD";

  return {
    path: args.ops.path,
    pathLabel: args.ops.pathLabel,
    formTitle: args.formTitle,
    lastControlLabel: args.lastControlLabel,
    staffId,
    staffName,
    role: profile?.role ?? null,
    staffRole: profile?.staffRole ?? null,
    eventId: args.ops.eventId,
    eventTitle: args.ops.eventTitle,
    eventDaySessionId: args.ops.eventDaySessionId,
    siteDaySessionId: args.ops.siteDaySessionId,
    siteDayPhase: args.ops.siteDayPhase,
    vehicleId: args.ops.vehicleId,
    lane,
    simClock: isOperationalClockOverridden(),
    operationalNow: operationalNowIso(),
    userAgent:
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 180) : "",
  };
}
