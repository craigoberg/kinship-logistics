import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import {
  DEFAULT_STAFF_UUID,
  STAFF_DIRECTORY,
  getStaffId,
  listUnresolvedEscalationsForDriver,
} from "@/lib/data-store";

/**
 * Driver-terminal re-hydration guardian.
 *
 * On app mount, if the active driver has an unresolved escalation
 * (status = 'pending' or 'claimed'), intercept root navigation and snap the
 * browser straight back to /manifest so they drop back into the live stream
 * instead of being trapped on the coordinator landing.
 */
export function RouteRehydrationGuardian() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const staffId = getStaffId() || DEFAULT_STAFF_UUID;
    const driverName =
      STAFF_DIRECTORY.find((s) => s.id === staffId)?.name ?? "Driver";

    listUnresolvedEscalationsForDriver(driverName)
      .then((rows) => {
        if (rows.length === 0) return;
        if (pathname === "/manifest" || pathname === "/auth") return;
        const active = rows[0];
        navigate({
          to: "/manifest",
          state: { escalationId: active.id } as never,
        });
      })
      .catch(() => {
        // Soft-fail: never block the app shell on a re-hydration probe.
      });
  }, [navigate, pathname]);

  return null;
}
