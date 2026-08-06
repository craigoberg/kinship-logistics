/**
 * Dashboard-only informational fire-alarm panel.
 * No action buttons — Muster / Stand down / Open issue live on the global strip.
 */
import { Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emergencyPhaseLabel,
  useFloorAnnouncement,
} from "@/hooks/use-floor-announcement";

export function EmergencyFloorAlert() {
  const { announcement } = useFloorAnnouncement();
  if (!announcement || announcement.kind !== "emergency") return null;

  const { emergency } = announcement;
  const isDrill = emergency.mode === "drill";
  const isLive = !isDrill;
  const phase = emergencyPhaseLabel(emergency.severity);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "flex min-h-[min(70dvh,36rem)] flex-col items-center justify-center gap-4 rounded-xl border-4 px-6 py-10 text-center shadow-lg",
        isDrill
          ? "border-amber-800 bg-amber-500 text-amber-950"
          : "border-red-900 bg-red-600 text-white",
        isLive && "animate-pulse",
      )}
    >
      <Siren
        className={cn(
          "h-16 w-16 shrink-0 sm:h-20 sm:w-20",
          isDrill ? "text-amber-950" : "text-white",
        )}
        aria-hidden
      />
      <p className="text-xs font-black uppercase tracking-[0.2em] sm:text-sm">
        {isDrill ? "DRILL" : "LIVE EMERGENCY"} · {emergency.severity}
      </p>
      <h2 className="max-w-3xl text-3xl font-black uppercase leading-tight tracking-tight sm:text-5xl md:text-6xl">
        {phase}
      </h2>
      <p className="max-w-2xl text-base font-semibold sm:text-xl">
        {emergency.situationText}
      </p>
      <p className="max-w-lg text-xs font-medium opacity-80 sm:text-sm">
        Use the banner above for Muster, Stand down, or Open issue. Side menu
        stays available to leave Dashboard.
      </p>
    </div>
  );
}
