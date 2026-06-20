import { useEffect, useMemo, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, Wrench, HeartPulse, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { raiseOperationalIncident, type OperationalIncident } from "@/lib/incidents";
import { resolveStaffIdWithFallback, getStaffId, STAFF_DIRECTORY } from "@/lib/data-store";

function staffName(id: string): string {
  return STAFF_DIRECTORY.find((s) => s.id === id)?.name ?? "Unknown staff";
}

type Lane = "choose" | "mechanical" | "human";
type Severity = OperationalIncident["severity"];

const SEVERITIES: Array<{
  key: Severity;
  label: string;
  hint: string;
  tone: string;
}> = [
  {
    key: "sev1",
    label: "Sev 1 — Red Crisis",
    hint: "Serious injury, vehicle collision, emergency services requested.",
    tone: "border-red-500 bg-red-500/15 text-red-100 hover:bg-red-500/25",
  },
  {
    key: "sev2",
    label: "Sev 2 — Yellow Incident",
    hint: "Minor slip/fall, passenger dispute, first aid applied on-site.",
    tone: "border-yellow-500 bg-yellow-500/15 text-yellow-100 hover:bg-yellow-500/25",
  },
  {
    key: "sev3",
    label: "Sev 3 — Green Note",
    hint: "Near-miss logging or zero-injury operational friction.",
    tone: "border-emerald-500 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25",
  },
];

/**
 * Lightweight context-harvesting from the active URL. The driver terminal
 * (`/manifest`) and event routes carry implicit context that we surface so the
 * reporter does not have to re-type vehicle / event identifiers.
 */
function useHarvestedContext(): { vehicleId?: string; eventId?: string; pathLabel: string } {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return useMemo(() => {
    if (pathname.startsWith("/manifest")) {
      const vehicleId =
        typeof window !== "undefined"
          ? window.localStorage.getItem("yada.activeVehicleId") ?? undefined
          : undefined;
      return { vehicleId, pathLabel: "Driver manifest" };
    }
    if (pathname.startsWith("/events")) {
      const eventId =
        typeof window !== "undefined"
          ? window.localStorage.getItem("yada.activeEventId") ?? undefined
          : undefined;
      return { eventId, pathLabel: "Events" };
    }
    if (pathname.startsWith("/transport")) {
      return { pathLabel: "Transport" };
    }
    return { pathLabel: "Dashboard" };
  }, [pathname]);
}

export function GlobalIncidentIntakeDrawer() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const ctx = useHarvestedContext();

  const [open, setOpen] = useState(false);
  const [lane, setLane] = useState<Lane>("choose");
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset whenever the drawer reopens.
  useEffect(() => {
    if (open) {
      setLane("choose");
      setSeverity(null);
      setDescription("");
    }
  }, [open]);

  const onManifest = pathname.startsWith("/manifest");

  async function handleSubmitHuman() {
    if (!severity || description.trim().length < 3) {
      toast.error("Add a short description and pick a severity.");
      return;
    }
    setSubmitting(true);
    try {
      const reporterId = getStaffId() || (await resolveStaffIdWithFallback());
      const reporterName = staffName(reporterId);
      await raiseOperationalIncident({
        incidentType: "human_operational",
        severity,
        description: description.trim(),
        vehicleId: ctx.vehicleId,
        eventId: ctx.eventId,
        reportedBy: reporterName,
      });

      if (severity === "sev1") {
        toast.error(
          "🚨 Sev 1 Emergency Signal Sent. Real-time coordinator assistance requested.",
          { duration: 8000 },
        );
      } else if (severity === "sev2") {
        toast.warning("Sev 2 incident logged. Coordinator notified.");
      } else {
        toast.success("Sev 3 note recorded for review.");
      }
      setOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Could not file incident. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleMechanicalRoute() {
    setOpen(false);
    if (!onManifest) {
      router.navigate({ to: "/manifest" });
      toast.message("Open the active manifest to use the vehicle fault checklist.");
    } else {
      toast.message("Use the issue accumulator panel below to log the mechanical fault.");
    }
  }

  // Driver-safe button position: on /manifest, anchor to top so a thumb sweep
  // on the seat checklist never grazes a Sev 1 button by accident.
  const triggerPos = onManifest
    ? "fixed right-4 top-3 z-40 md:right-6 md:top-4"
    : "fixed bottom-24 right-4 z-40 md:bottom-8 md:right-6";

  return (
    <>
      <button
        type="button"
        aria-label="Raise an incident or fault"
        onClick={() => setOpen(true)}
        className={cn(
          triggerPos,
          "flex items-center gap-2 rounded-full border-2 border-red-500/80 bg-red-600/90 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-red-900/30 backdrop-blur transition hover:bg-red-600 md:text-sm",
        )}
      >
        <AlertTriangle className="h-4 w-4" />
        Incident / Fault
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center">
          <div className="relative w-full max-w-2xl rounded-t-2xl border border-border bg-background p-5 shadow-2xl md:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  Incident & Fault Utility
                </h2>
                <p className="text-xs text-muted-foreground">
                  Context: {ctx.pathLabel}
                  {ctx.vehicleId ? ` · Vehicle ${ctx.vehicleId.slice(0, 8)}` : ""}
                  {ctx.eventId ? ` · Event ${ctx.eventId.slice(0, 8)}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {lane === "choose" && (
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setLane("mechanical")}
                  className="flex flex-col items-start gap-2 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-5 text-left transition hover:bg-amber-500/20"
                >
                  <Wrench className="h-7 w-7 text-amber-300" />
                  <div className="text-base font-semibold text-amber-100">
                    🛠️ Vehicle / Mechanical Fault
                  </div>
                  <p className="text-xs text-amber-200/80">
                    Brakes, lights, seats, hoist, fluids — route into the checklist accumulator.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setLane("human")}
                  className="flex flex-col items-start gap-2 rounded-xl border-2 border-rose-500/60 bg-rose-500/10 p-5 text-left transition hover:bg-rose-500/20"
                >
                  <HeartPulse className="h-7 w-7 text-rose-300" />
                  <div className="text-base font-semibold text-rose-100">
                    🚑 Human / Operational Incident
                  </div>
                  <p className="text-xs text-rose-200/80">
                    Injury, dispute, near-miss — log severity and field notes.
                  </p>
                </button>
              </div>
            )}

            {lane === "mechanical" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Mechanical faults are tracked via the manifest issue accumulator so
                  parts, severity and clearance state stay aligned.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setLane("choose")}>
                    ← Back
                  </Button>
                  <Button onClick={handleMechanicalRoute}>
                    Open vehicle checklist
                  </Button>
                </div>
              </div>
            )}

            {lane === "human" && (
              <div className="space-y-4">
                <div className="grid gap-2 md:grid-cols-3">
                  {SEVERITIES.map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      onClick={() => setSeverity(s.key)}
                      className={cn(
                        "rounded-lg border-2 px-3 py-3 text-left text-xs transition",
                        s.tone,
                        severity === s.key ? "ring-2 ring-offset-2 ring-offset-background" : "opacity-80",
                      )}
                    >
                      <div className="text-sm font-bold">{s.label}</div>
                      <div className="mt-1 text-[11px] opacity-90">{s.hint}</div>
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Field notes
                  </label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What happened, who was involved, what was done on the spot…"
                    rows={4}
                    autoFocus
                  />
                </div>

                <div className="flex flex-wrap justify-between gap-2">
                  <Button variant="ghost" onClick={() => setLane("choose")}>
                    ← Back
                  </Button>
                  <Button
                    onClick={handleSubmitHuman}
                    disabled={submitting || !severity || description.trim().length < 3}
                    className={cn(
                      severity === "sev1" &&
                        "bg-red-600 text-white hover:bg-red-500",
                    )}
                  >
                    {submitting ? "Filing…" : "File incident"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
