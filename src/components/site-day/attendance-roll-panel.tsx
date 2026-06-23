// MASTER_GUARDRAILS §4.4 — Mobile Checklist Tokens.
// Full-width, touch-friendly button cards for the Day Centre attendance roll.
// Tap toggles GREEN (Checked In) ↔ GREY (Expected). All timestamps render
// inside the canonical <ClientTime /> primitive.

import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientTime } from "@/components/ui/client-time";
import { cn } from "@/lib/utils";
import { listParticipants } from "@/lib/data-store";
import { useSystemParameter } from "@/hooks/use-system-parameters";
import {
  listAttendanceRoll,
  seedRollFromSchedules,
  sweepOverdueArrivals,
  toggleCheckIn,
  type ClientAttendanceRow,
} from "@/lib/api/client-attendance";

interface Props {
  sessionId: string;
}

const ROLL_KEY = (sid: string) => ["client-attendance-roll", sid] as const;

export function AttendanceRollPanel({ sessionId }: Props) {
  const qc = useQueryClient();
  const yellowMins = useSystemParameter<number>("attendance_yellow_threshold_mins", 30);
  const redMins = useSystemParameter<number>("attendance_red_threshold_mins", 60);

  const participantsQ = useQuery({
    queryKey: ["participants", "all-for-roll"],
    queryFn: listParticipants,
    staleTime: 5 * 60_000,
  });
  const nameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of participantsQ.data ?? []) map[p.id] = p.fullName;
    return map;
  }, [participantsQ.data]);

  // One-shot auto-seed when the panel first mounts for the session.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const seeded = await seedRollFromSchedules(sessionId);
        if (!cancelled && seeded > 0) {
          qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
        }
      } catch (e) {
        console.error("[AttendanceRollPanel] seed failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, qc]);

  // 60-second sweep — promotes overdue rows YELLOW → RED on the SAME issue row.
  const rollQ = useQuery({
    queryKey: ROLL_KEY(sessionId),
    queryFn: async () => {
      const rows = await listAttendanceRoll(sessionId);
      if (Object.keys(nameMap).length > 0) {
        await sweepOverdueArrivals(sessionId, yellowMins, redMins, nameMap).catch(
          (e) => console.error("[AttendanceRollPanel] sweep failed", e),
        );
      }
      return rows;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    enabled: !!sessionId,
  });

  const toggleMut = useMutation({
    mutationFn: (row: ClientAttendanceRow) => toggleCheckIn(row),
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: ROLL_KEY(sessionId) });
      const prev = qc.getQueryData<ClientAttendanceRow[]>(ROLL_KEY(sessionId));
      const flipped: ClientAttendanceRow = {
        ...row,
        status: row.status === "checked_in" ? "expected" : "checked_in",
        checkedInAt: row.status === "checked_in" ? null : new Date().toISOString(),
      };
      qc.setQueryData<ClientAttendanceRow[]>(ROLL_KEY(sessionId), (prevRows) =>
        (prevRows ?? []).map((r) => (r.id === row.id ? flipped : r)),
      );
      return { prev };
    },
    onError: (e: Error, _row, ctx) => {
      if (ctx?.prev) qc.setQueryData(ROLL_KEY(sessionId), ctx.prev);
      toast.error("Could not update check-in", { description: e.message });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
    },
  });

  const rows = rollQ.data ?? [];
  const checkedIn = rows.filter((r) => r.status === "checked_in").length;
  const overdue = rows.filter((r) => r.escalationSeverity !== null && !r.checkedInAt);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Attendance Roll{" "}
          <span className="ml-1 font-mono normal-case text-muted-foreground/70">
            ({checkedIn}/{rows.length} in
            {overdue.length > 0 && (
              <>
                {" "}· <span className="text-destructive">{overdue.length} overdue</span>
              </>
            )})
          </span>
        </h3>
        {rollQ.isFetching && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {rollQ.isError && (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              <div className="font-medium">Could not load attendance roll.</div>
              <div className="text-xs">{(rollQ.error as Error).message}</div>
            </div>
          </div>
        </Card>
      )}

      {!rollQ.isError && rows.length === 0 && !rollQ.isLoading && (
        <Card className="border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            No clients scheduled for today, or the roll has not seeded yet.
          </div>
        </Card>
      )}

      <ul className="space-y-2">
        {rows.map((r) => {
          const isIn = r.status === "checked_in";
          const isRed = r.escalationSeverity === "red" && !isIn;
          const isYellow = r.escalationSeverity === "yellow" && !isIn && !isRed;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => toggleMut.mutate(r)}
                disabled={toggleMut.isPending}
                aria-pressed={isIn}
                className={cn(
                  // §4.4 — full-width, large touch target (min 56px)
                  "w-full min-h-[56px] rounded-lg border-2 px-4 py-3 text-left",
                  "flex items-center justify-between gap-3",
                  "transition-colors active:scale-[0.99] disabled:opacity-70",
                  isIn &&
                    "border-green-600 bg-green-50 hover:bg-green-100 text-green-900",
                  !isIn && !isRed && !isYellow &&
                    "border-border bg-card hover:bg-muted/60",
                  isYellow &&
                    "border-amber-500 bg-amber-50 hover:bg-amber-100 text-amber-900",
                  isRed &&
                    "border-2 border-destructive bg-destructive/10 hover:bg-destructive/15 text-destructive",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold">
                      {nameMap[r.participantId] ?? "Loading…"}
                    </span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {r.arrivalMethod.replace("_", " ")}
                    </Badge>
                    {isRed && (
                      <Badge className="bg-destructive text-destructive-foreground text-[10px] uppercase">
                        Escalated — Manager notified
                      </Badge>
                    )}
                    {isYellow && (
                      <Badge className="bg-amber-500 text-white text-[10px] uppercase">
                        Overdue
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Expected{" "}
                    <ClientTime
                      iso={r.expectedArrivalAt}
                      options={{ hour: "2-digit", minute: "2-digit" }}
                    />
                    {r.checkedInAt && (
                      <>
                        {" "}· Checked in{" "}
                        <ClientTime
                          iso={r.checkedInAt}
                          options={{ hour: "2-digit", minute: "2-digit" }}
                        />
                      </>
                    )}
                  </div>
                </div>
                <div
                  className={cn(
                    "shrink-0 rounded-full p-2",
                    isIn
                      ? "bg-green-600 text-white"
                      : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden
                >
                  <Check className="h-5 w-5" />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
