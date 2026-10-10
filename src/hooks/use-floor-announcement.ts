/**
 * Floor announcement resolver — priority stack for AppShell strip + Dashboard.
 *
 * Priority (highest first):
 *   1. Active operational emergency (Drill|Live)
 *   2. Future: med alert channel (stub — not wired)
 *   3. MOTD from system_parameters.floor_motd (non-empty string)
 */
import { useQuery } from "@tanstack/react-query";
import {
  listActiveEmergencies,
  type OperationalEmergency,
} from "@/lib/api/operational-emergency";
import { useSystemParameter } from "@/hooks/use-system-parameters";

export const FLOOR_MOTD_KEY = "floor_motd";

export type FloorAnnouncementKind = "emergency" | "motd";

export type FloorAnnouncement =
  | { kind: "emergency"; emergency: OperationalEmergency }
  | { kind: "motd"; message: string };

export function emergencyPhaseLabel(
  severity: OperationalEmergency["severity"],
): "STANDBY" | "EVACUATE TO MUSTER POINT" {
  return severity === "red" ? "EVACUATE TO MUSTER POINT" : "STANDBY";
}

export function useFloorAnnouncement(): {
  announcement: FloorAnnouncement | null;
  motdText: string;
  isLoading: boolean;
} {
  // Match EmergencyOpsBanner hub queryKey so the strip shares one cache entry.
  const emergencyQ = useQuery({
    queryKey: ["operational-emergencies", "active", "any", "", ""],
    queryFn: async () => {
      const all = await listActiveEmergencies();
      return all[0] ?? null;
    },
    refetchInterval: 15_000,
  });

  const rawMotd = useSystemParameter<string>(FLOOR_MOTD_KEY, "");
  const motdText =
    typeof rawMotd === "string" ? rawMotd.trim() : String(rawMotd ?? "").trim();

  // Future: insert med-alert query here between emergency and MOTD.

  const emergency = emergencyQ.data ?? null;
  let announcement: FloorAnnouncement | null = null;
  if (emergency) {
    announcement = { kind: "emergency", emergency };
  } else if (motdText) {
    announcement = { kind: "motd", message: motdText };
  }

  return {
    announcement,
    motdText,
    isLoading: emergencyQ.isLoading,
  };
}
