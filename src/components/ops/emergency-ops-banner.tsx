/**
 * BL-084 Phase C — sticky Drill/Live banner + light muster + stand-down.
 * Field surfaces (Centre / Event Deliver / Manifest) and Hub review CTA.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Siren, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";
import {
  getActiveEmergencyForContext,
  listActiveEmergencies,
  listMusterLines,
  standDownEmergency,
  updateMusterState,
  type MusterState,
  type OperationalEmergency,
} from "@/lib/api/operational-emergency";
import { invalidateIssueCaches } from "@/lib/query/invalidation";
import { cn, formatUnknownError } from "@/lib/utils";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";

export function EmergencyOpsBanner(props: {
  siteDaySessionId?: string | null;
  eventDaySessionId?: string | null;
  className?: string;
  /** Hub: show any *active* emergency + Open issue CTA (clears on stand-down). */
  variant?: "field" | "hub";
  onOpenHubIssue?: (hubIssueId: string) => void;
}) {
  const {
    siteDaySessionId,
    eventDaySessionId,
    className,
    variant = "field",
    onOpenHubIssue,
  } = props;
  const qc = useQueryClient();
  const [musterOpen, setMusterOpen] = useState(false);
  const [standDownOpen, setStandDownOpen] = useState(false);
  const isHub = variant === "hub";

  const emergencyQ = useQuery({
    queryKey: [
      "operational-emergencies",
      "active",
      isHub ? "any" : "ctx",
      siteDaySessionId ?? "",
      eventDaySessionId ?? "",
    ],
    queryFn: async () => {
      if (isHub) {
        const all = await listActiveEmergencies();
        return all[0] ?? null;
      }
      return getActiveEmergencyForContext({ siteDaySessionId, eventDaySessionId });
    },
    refetchInterval: 15_000,
  });

  const emergency = emergencyQ.data;
  if (!emergency) return null;

  const isDrill = emergency.mode === "drill";

  return (
    <>
      <div
        className={cn(
          "sticky top-0 z-[55] border-b px-3 py-2",
          isDrill
            ? "border-amber-700 bg-amber-500 text-amber-950"
            : "border-red-800 bg-red-600 text-white",
          className,
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Siren
            className={cn("h-4 w-4 shrink-0", !isDrill && "animate-pulse")}
          />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-[11px] font-black uppercase tracking-wider",
                !isDrill && "animate-pulse",
              )}
            >
              {isDrill ? "DRILL" : "LIVE EMERGENCY"} · {emergency.severity}
            </p>
            <p className="truncate text-sm font-semibold">
              {emergency.situationText}
            </p>
          </div>
          {isHub && emergency.hubIssueId && onOpenHubIssue ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-9 shrink-0 font-bold"
              onClick={() => onOpenHubIssue(emergency.hubIssueId!)}
            >
              Open issue
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-9 shrink-0 font-bold"
            onClick={() => setMusterOpen(true)}
          >
            Muster
          </Button>
          {isActiveUserManager() ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                "h-9 shrink-0 font-bold",
                isDrill
                  ? "border-amber-950/40 bg-amber-950/10"
                  : "border-white/40 bg-white/10 text-white hover:bg-white/20",
              )}
              onClick={() => setStandDownOpen(true)}
            >
              Stand down
            </Button>
          ) : null}
        </div>
      </div>

      <MusterSheet
        open={musterOpen}
        onOpenChange={setMusterOpen}
        emergency={emergency}
      />
      <StandDownSheet
        open={standDownOpen}
        onOpenChange={setStandDownOpen}
        emergency={emergency}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: ["operational-emergencies"] });
          void qc.invalidateQueries({
            queryKey: ["operational-emergencies-hub-feed"],
          });
          invalidateIssueCaches(qc);
        }}
      />
    </>
  );
}

function MusterSheet(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  emergency: OperationalEmergency;
}) {
  const { open, onOpenChange, emergency } = props;
  const qc = useQueryClient();
  const profile = getActiveUserProfile();
  const staffId = profile?.staffId ?? "";

  const musterQ = useQuery({
    queryKey: ["operational-emergency-muster", emergency.id],
    queryFn: () => listMusterLines(emergency.id),
    enabled: open,
  });

  const mut = useMutation({
    mutationFn: (args: { musterId: string; state: MusterState }) =>
      updateMusterState({ ...args, staffId }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["operational-emergency-muster", emergency.id],
      });
    },
    onError: (e: unknown) => {
      toast.error("Muster update failed", { description: formatUnknownError(e) });
    },
  });

  const lines = musterQ.data ?? [];
  const isRed = emergency.severity === "red";
  const isDrill = emergency.mode === "drill";
  const counts = useMemo(() => {
    let accounted = 0;
    let missing = 0;
    let expected = 0;
    for (const l of lines) {
      if (l.state === "accounted") accounted += 1;
      else if (l.state === "missing") missing += 1;
      else expected += 1;
    }
    return { accounted, missing, expected };
  }, [lines]);

  const title = isRed
    ? isDrill
      ? "Drill — evacuate & muster"
      : "Evacuate — muster at muster point"
    : isDrill
      ? "Drill — light muster"
      : "Standby — light muster";

  const description = isRed
    ? "Move people in care to the muster point, then mark each person Accounted or Missing. This is the care roll — not a whole-site visitor list."
    : "Account for people in care while on standby. Escalate to Red when you need a full evacuate-to-muster-point call.";

  const emptyHint = isRed
    ? "No people-in-care roll was linked when this emergency was activated (e.g. opened from Dashboard/Manifest without an open Day Centre or trip day). Physically evacuate to the muster point using centre procedure; use Stand down when the incident is complete. To get a tap list next time, activate from Day Centre or Event Deliver with people checked in."
    : "No roll names to muster for this context (e.g. activated without an open Day Centre or trip day). Use Stand down when the drill/incident is complete.";

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      <div className="space-y-3 pb-4">
        {isRed ? (
          <p className="rounded-md border border-red-600/40 bg-red-600/15 px-3 py-2 text-sm font-semibold text-red-950 dark:text-red-100">
            EVACUATE TO MUSTER POINT — then tick Accounted / Missing below.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Accounted {counts.accounted} · Missing {counts.missing} · Still expected{" "}
          {counts.expected}
        </p>
        {musterQ.isLoading ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((line) => (
              <li key={line.id} className="rounded-lg border bg-card p-2">
                <p className="mb-2 text-sm font-semibold">
                  {line.participantName ?? "Participant"}
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <MobileFieldButton
                    title="Expected"
                    tone="neutral"
                    active={line.state === "expected"}
                    disabled={mut.isPending}
                    onClick={() =>
                      mut.mutate({ musterId: line.id, state: "expected" })
                    }
                    className="min-h-12 px-2 py-2"
                  />
                  <MobileFieldButton
                    title="Accounted"
                    icon={<Check className="h-4 w-4" />}
                    tone="success"
                    active={line.state === "accounted"}
                    disabled={mut.isPending}
                    onClick={() =>
                      mut.mutate({ musterId: line.id, state: "accounted" })
                    }
                    className="min-h-12 px-2 py-2"
                  />
                  <MobileFieldButton
                    title="Missing"
                    icon={<UserX className="h-4 w-4" />}
                    tone="danger"
                    active={line.state === "missing"}
                    disabled={mut.isPending}
                    onClick={() =>
                      mut.mutate({ musterId: line.id, state: "missing" })
                    }
                    className="min-h-12 px-2 py-2"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}

function StandDownSheet(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  emergency: OperationalEmergency;
  onDone: () => void;
}) {
  const { open, onOpenChange, emergency, onDone } = props;
  const profile = getActiveUserProfile();
  const managerStaffId = profile?.staffId ?? "";
  const [debrief, setDebrief] = useState("");
  const [pinVerified, setPinVerified] = useState(false);

  const mut = useMutation({
    mutationFn: () =>
      standDownEmergency({
        emergencyId: emergency.id,
        debriefText: debrief,
        managerStaffId,
      }),
    onSuccess: () => {
      toast.success("Stood down — floor restored", {
        description:
          "Hub issue stays Open for office review (Resolve or Defer). Banner clears.",
      });
      onDone();
      onOpenChange(false);
      setDebrief("");
      setPinVerified(false);
    },
    onError: (e: unknown) => {
      toast.error("Stand-down failed", { description: formatUnknownError(e) });
    },
  });

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Stand down"
      description="Short debrief for the audit trail, then Manager PIN. Hub review stays open."
    >
      <div className="space-y-4 pb-4">
        <CharacterCountedTextarea
          label="Debrief"
          value={debrief}
          onValueChange={setDebrief}
          minChars={10}
          maxChars={800}
          rows={4}
          placeholder="What happened, who was accounted for, any follow-up…"
        />
        <PinEntryTrigger
          title="Manager PIN — stand down"
          onVerify={async (pin) => {
            await verifyManagerPin(managerStaffId, pin);
          }}
          onSuccess={() => setPinVerified(true)}
          disabled={debrief.trim().length < 10}
        >
          <Button
            type="button"
            variant={pinVerified ? "secondary" : "outline"}
            className="h-12 w-full"
            disabled={debrief.trim().length < 10}
          >
            {pinVerified ? "Manager PIN verified" : "Verify Manager PIN"}
          </Button>
        </PinEntryTrigger>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            className="h-12 w-full sm:w-auto"
            disabled={!pinVerified || debrief.trim().length < 10 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm stand-down
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
