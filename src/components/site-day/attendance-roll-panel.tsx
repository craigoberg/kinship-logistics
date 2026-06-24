// MASTER_GUARDRAILS §4.4 — Mobile Checklist Tokens.
// Full-width, touch-friendly button cards for the Day Centre attendance roll.
// Tap toggles GREEN (Checked In) ↔ GREY (Expected). All timestamps render
// inside the canonical <ClientTime /> primitive.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, Loader2, Users, Bus } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { AdjustExpectedTimeModal } from "./adjust-expected-time-modal";
import { BulkDeferGroupModal } from "./bulk-defer-group-modal";

interface Props {
  sessionId: string;
}

const ROLL_KEY = (sid: string) => ["client-attendance-roll", sid] as const;

export function AttendanceRollPanel({ sessionId }: Props) {
  const qc = useQueryClient();
  const yellowMins = useSystemParameter<number>("attendance_yellow_threshold_mins", 30);
  const redMins = useSystemParameter<number>("attendance_red_threshold_mins", 60);

  const [adjustRow, setAdjustRow] = useState<ClientAttendanceRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

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
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[AttendanceRollPanel] seed failed", e);
        if (!cancelled) {
          toast.error("Attendance roll could not initialise", {
            description: msg,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, qc]);

  const rollQ = useQuery({
    queryKey: ROLL_KEY(sessionId),
    queryFn: async () => {
      const rows = await listAttendanceRoll(sessionId);
      if (Object.keys(nameMap).length > 0) {
        await sweepOverdueArrivals(sessionId, yellowMins, redMins, nameMap).catch(
          (e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[AttendanceRollPanel] sweep failed", e);
            toast.error("Attendance overdue sweep failed", { description: msg });
          },
        );
      }
      return rows;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    enabled: !!sessionId && participantsQ.isSuccess,
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
  const hasUnarrived = rows.some(
    (r) => r.status !== "checked_in" && r.status !== "accounted",
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
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
        <div className="flex items-center gap-2">
          {rollQ.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {hasUnarrived && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setBulkOpen(true)}
              className="h-8 gap-1.5"
            >
              <Bus className="h-4 w-4" />
              Bulk Defer Group
            </Button>
          )}
        </div>
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
          // WCAG: on Green/Yellow tinted surfaces, force solid charcoal so
          // text + timestamp both clear AA contrast.
          const subTextCls =
            isIn || isYellow ? "text-slate-900/80" : "text-muted-foreground";
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => toggleMut.mutate(r)}
                disabled={toggleMut.isPending}
                aria-pressed={isIn}
                className={cn(
                  "w-full min-h-[56px] rounded-lg border-2 px-4 py-3 text-left",
                  "flex items-center justify-between gap-3",
                  "transition-colors active:scale-[0.99] disabled:opacity-70",
                  isIn &&
                    "border-green-600 bg-green-50 hover:bg-green-100 text-slate-900",
                  !isIn && !isRed && !isYellow &&
                    "border-border bg-card hover:bg-muted/60",
                  isYellow &&
                    "border-amber-500 bg-amber-50 hover:bg-amber-100 text-slate-900",
                  isRed &&
                    "border-2 border-destructive bg-destructive/10 hover:bg-destructive/15 text-destructive",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="truncate text-base font-semibold">
                      {nameMap[r.participantId] ?? "Loading…"}
                    </span>
                    <Badge className="border border-slate-400 bg-white text-slate-900 text-[10px] uppercase">
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
                  <div className={cn("mt-0.5 text-xs", subTextCls)}>
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
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Adjust expected time for ${nameMap[r.participantId] ?? "client"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAdjustRow(r);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        e.preventDefault();
                        setAdjustRow(r);
                      }
                    }}
                    className={cn(
                      "inline-flex items-center justify-center rounded-md p-2",
                      "min-h-11 min-w-11 cursor-pointer",
                      "border border-border bg-background/80 hover:bg-muted",
                      "text-slate-900",
                    )}
                  >
                    <Clock className="h-4 w-4" />
                  </span>
                  <div
                    className={cn(
                      "rounded-full p-2",
                      isIn
                        ? "bg-green-600 text-white"
                        : "bg-muted text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    <Check className="h-5 w-5" />
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <AdjustExpectedTimeModal
        row={adjustRow}
        yellowThresholdMins={yellowMins}
        participantName={
          adjustRow ? (nameMap[adjustRow.participantId] ?? "Client") : ""
        }
        onClose={(changed: boolean) => {
          setAdjustRow(null);
          if (changed) qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
        }}
      />

      <BulkDeferGroupModal
        open={bulkOpen}
        sessionId={sessionId}
        rows={rows}
        nameMap={nameMap}
        yellowThresholdMins={yellowMins}
        onClose={(changed: boolean) => {
          setBulkOpen(false);
          if (changed) qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
        }}
      />

    </div>
  );
}
