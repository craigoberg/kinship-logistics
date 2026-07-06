/**
 * AccountabilityRollPanel — curfew AND morning roll sweeper UI (§12.5)
 *
 * Re-used for both `event_curfew_log` and `event_morning_log` by passing
 * the `mode` prop. Only displayed for multi-day tours.
 *
 * Background sweep: every 60 s the panel calls `sweepAccountabilityRoll`.
 * YELLOW→RED+SMS is automatic per GUARDRAILS §12.5 / §1.1.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Moon,
  RefreshCw,
  Sunrise,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  listAccountabilityRoll,
  markAbsent,
  markAccounted,
  seedAccountabilityRoll,
  sweepAccountabilityRoll,
  type EventAccountabilityRow,
} from "@/lib/api/event-day-ops";
import type { EventManifest } from "@/lib/data-store";

type Mode = "curfew" | "morning";
type LogTable = "event_curfew_log" | "event_morning_log";

const TABLE: Record<Mode, LogTable> = {
  curfew: "event_curfew_log",
  morning: "event_morning_log",
};

/** Minutes before the deadline to start showing YELLOW. */
const YELLOW_MINS_DEFAULT = 15;
/** Minutes after the deadline to escalate to RED + SMS. */
const RED_MINS_DEFAULT = 30;

interface Props {
  event: EventManifest;
  sessionId: string;
  sessionDate: string;
  /** Clock string from event_day_sessions, e.g. "22:00". null = roll not configured yet. */
  rollTimeClock: string | null;
  mode: Mode;
}

const rollKey = (mode: Mode, sessionId: string) =>
  ["event-accountability-roll", mode, sessionId] as const;

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

function severityBadge(sev: string | null) {
  if (sev === "red")
    return <Badge className="bg-destructive text-destructive-foreground text-[10px]">RED</Badge>;
  if (sev === "yellow")
    return <Badge className="bg-yellow-500 text-black text-[10px]">YELLOW</Badge>;
  return null;
}

export function AccountabilityRollPanel({ event, sessionId, sessionDate, rollTimeClock, mode }: Props) {
  const qc = useQueryClient();
  const table = TABLE[mode];
  const [seeding, setSeeding] = useState(false);
  const [lastSweep, setLastSweep] = useState<{ yellow: number; red: number } | null>(null);

  const { data: roll = [], isLoading } = useQuery({
    queryKey: rollKey(mode, sessionId),
    queryFn: () => listAccountabilityRoll(table, sessionId),
    staleTime: 15_000,
    refetchInterval: 60_000, // auto sweep cadence
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: rollKey(mode, sessionId) });

  // Run the YELLOW→RED sweep whenever the roll data refreshes.
  useEffect(() => {
    if (!roll.length) return;
    const names: Record<string, string> = {};
    roll.forEach((r) => { if (r.participant_name) names[r.participant_id] = r.participant_name; });
    sweepAccountabilityRoll(table, sessionId, YELLOW_MINS_DEFAULT, RED_MINS_DEFAULT, names)
      .then((res) => {
        if (res.redRaised > 0 || res.yellowRaised > 0) {
          setLastSweep({ yellow: res.yellowRaised, red: res.redRaised });
          invalidate();
        }
      })
      .catch((e) => console.error("[accountability-roll] sweep failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll]);

  const handleSeed = async () => {
    if (!rollTimeClock) {
      toast.error("Set the " + (mode === "curfew" ? "curfew time" : "morning roll time") + " in Day Sessions first.");
      return;
    }
    setSeeding(true);
    try {
      const n = await seedAccountabilityRoll(table, {
        eventId: event.id,
        sessionId,
        rollTimeClock,
        sessionDate,
      });
      toast.success(`${n} participant${n === 1 ? "" : "s"} seeded onto ${mode} roll.`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  const accounted = roll.filter((r) => r.status === "accounted").length;
  const absent = roll.filter((r) => r.status === "absent").length;
  const outstanding = roll.filter((r) => r.status === "expected").length;
  const redCount = roll.filter((r) => r.escalation_severity === "red").length;
  const yellowCount = roll.filter((r) => r.escalation_severity === "yellow").length;

  const Icon = mode === "curfew" ? Moon : Sunrise;
  const label = mode === "curfew" ? "Curfew roll" : "Morning roll";

  return (
    <div className="space-y-3">
      {/* Header summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4" />
          {label}
          {rollTimeClock && (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Clock className="h-3 w-3" /> {rollTimeClock}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {redCount > 0 && (
            <span className="flex items-center gap-1 rounded bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
              <AlertTriangle className="h-3 w-3" /> {redCount} RED
            </span>
          )}
          {yellowCount > 0 && (
            <span className="flex items-center gap-1 rounded bg-yellow-500/15 px-2 py-0.5 text-[11px] font-semibold text-yellow-700">
              {yellowCount} YELLOW
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            {accounted} accounted · {absent} absent · {outstanding} outstanding
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSeed} disabled={seeding}>
            {seeding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
            Re-seed
          </Button>
        </div>
      </div>

      {lastSweep && (lastSweep.red > 0 || lastSweep.yellow > 0) && (
        <div className="rounded bg-yellow-500/10 px-3 py-2 text-[11px] font-medium text-yellow-700">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          Auto-sweep: {lastSweep.yellow > 0 ? `${lastSweep.yellow} YELLOW raised` : ""}
          {lastSweep.yellow > 0 && lastSweep.red > 0 ? " · " : ""}
          {lastSweep.red > 0 ? `${lastSweep.red} RED escalated + SMS dispatched` : ""}
        </div>
      )}

      {!rollTimeClock && (
        <p className="rounded border border-dashed py-3 text-center text-sm text-muted-foreground">
          No {mode === "curfew" ? "curfew" : "morning roll"} time set on this day session.
          Set it in Day Sessions → expand the row.
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : roll.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No participants on roll yet — click "Re-seed" to populate from the roster.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {roll.map((row) => (
            <AccountabilityRow
              key={row.id}
              row={row}
              table={table}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Individual accountability row ───────────────────────────────────────────

interface AccRowProps {
  row: EventAccountabilityRow;
  table: LogTable;
  onChanged: () => void;
}

function AccountabilityRow({ row, table, onChanged }: AccRowProps) {
  const [absentOpen, setAbsentOpen] = useState(false);
  const [absentNotes, setAbsentNotes] = useState("");

  const accountedMut = useMutation({
    mutationFn: () => markAccounted(table, row, ""),
    onSuccess: () => { toast.success("Accounted"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const absentMut = useMutation({
    mutationFn: () => markAbsent(table, row, absentNotes),
    onSuccess: () => { toast.success("Marked absent."); setAbsentOpen(false); setAbsentNotes(""); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const name = row.participant_name ?? "Participant";
  const isAccounted = row.status === "accounted";
  const isAbsent = row.status === "absent";

  const rowBg =
    row.escalation_severity === "red"
      ? "bg-red-500/5 border-l-4 border-l-destructive"
      : row.escalation_severity === "yellow"
        ? "bg-yellow-500/5 border-l-4 border-l-yellow-500"
        : isAccounted
          ? "bg-emerald-500/5"
          : "";

  return (
    <>
      <div className={`flex items-center gap-2 px-4 py-2.5 ${rowBg}`}>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{name}</span>
            {severityBadge(row.escalation_severity)}
            {isAbsent && (
              <Badge variant="secondary" className="text-[10px]">Absent</Badge>
            )}
          </div>
          {row.notes && (
            <p className="mt-0.5 text-[11px] italic text-muted-foreground truncate">
              {row.notes}
            </p>
          )}
          {isAccounted && row.accounted_at && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              ✓ {fmtTime(row.accounted_at)}
            </p>
          )}
        </div>

        {!isAccounted && !isAbsent && (
          <>
            <Button
              size="sm"
              variant="default"
              className="h-7 shrink-0 bg-emerald-600 hover:bg-emerald-700"
              disabled={accountedMut.isPending}
              onClick={() => accountedMut.mutate()}
            >
              {accountedMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 text-destructive hover:text-destructive"
              onClick={() => setAbsentOpen(true)}
            >
              <UserX className="h-3.5 w-3.5" />
            </Button>
          </>
        )}

        {isAccounted && (
          <Badge className="bg-emerald-600 text-white text-[10px] shrink-0">Accounted</Badge>
        )}
      </div>

      {/* Absent confirmation dialog */}
      <Dialog open={absentOpen} onOpenChange={setAbsentOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark absent — {name}</DialogTitle>
            <DialogDescription>
              This will close any open YELLOW/RED issue and record the participant as absent
              for this accountability check.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Notes / reason</Label>
            <Textarea
              value={absentNotes}
              onChange={(e) => setAbsentNotes(e.target.value)}
              placeholder="e.g. Participant notified — confirmed safe, returning via own transport."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbsentOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={absentMut.isPending}
              onClick={() => absentMut.mutate()}
            >
              {absentMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm absent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
