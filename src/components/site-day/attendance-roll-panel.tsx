// MASTER_GUARDRAILS §4.4 — Mobile Checklist Tokens.
// Full-width, touch-friendly button cards for the Day Centre attendance roll.
// Tap toggles GREEN (Checked In) ↔ GREY (Expected). All timestamps render
// inside the canonical <ClientTime /> primitive.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, Loader2, Users, Bus, UserPlus } from "lucide-react";
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
  sweepOverdueDepartures,
  toggleCheckIn,
  type ClientAttendanceRow,
} from "@/lib/api/client-attendance";
import { AdjustExpectedTimeModal } from "./adjust-expected-time-modal";
import { BulkDeferGroupModal } from "./bulk-defer-group-modal";
import { AddAttendeeModal } from "./add-attendee-modal";
import { CheckOutPopover } from "./check-out-popover";

interface Props {
  sessionId: string;
}

const ROLL_KEY = (sid: string) => ["client-attendance-roll", sid] as const;

export function AttendanceRollPanel({ sessionId }: Props) {
  const qc = useQueryClient();
  const yellowMins = useSystemParameter<number>("attendance_yellow_threshold_mins", 30);
  const redMins = useSystemParameter<number>("attendance_red_threshold_mins", 60);
  const depYellowMins = useSystemParameter<number>(
    "attendance_departure_yellow_threshold_mins",
    30,
  );
  const depRedMins = useSystemParameter<number>(
    "attendance_departure_red_threshold_mins",
    60,
  );

  const [adjustRow, setAdjustRow] = useState<ClientAttendanceRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

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
            console.error("[AttendanceRollPanel] arrival sweep failed", e);
            toast.error("Attendance overdue sweep failed", { description: msg });
          },
        );
        await sweepOverdueDepartures(
          sessionId,
          depYellowMins,
          depRedMins,
          nameMap,
        ).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[AttendanceRollPanel] departure sweep failed", e);
          toast.error("Departure overdue sweep failed", { description: msg });
        });
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setAddOpen(true)}
            className="h-8 gap-1.5"
          >
            <UserPlus className="h-4 w-4" />
            + Add Attendee
          </Button>
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
          const isOut = r.status === "checked_out";
          const isAbsent = r.status === "absent";
          // Departure rail takes precedence over arrival rail when the
          // participant is already checked in (arrival rail is, by
          // definition, satisfied at that point).
          const depRed = r.departureSeverity === "red" && isIn;
          const depYellow = r.departureSeverity === "yellow" && isIn && !depRed;
          const isRed =
            !isAbsent && !isOut &&
            ((r.escalationSeverity === "red" && !isIn) || depRed);
          const isYellow =
            !isAbsent && !isOut && !isRed &&
            ((r.escalationSeverity === "yellow" && !isIn) || depYellow);
          // Parse the [ABSENT:CODE] tag we wrote into notes for the badge.
          const absentMatch = isAbsent && r.notes
            ? /\[ABSENT:([A-Z_]+)\]\s*([^—(]+)/.exec(r.notes)
            : null;
          const absentLabel = absentMatch?.[2]?.trim() ?? "Absent today";
          // WCAG: on Green/Yellow/Absent tinted surfaces, force solid charcoal
          // so text + timestamp both clear AA contrast.
          const subTextCls =
            isIn || isYellow || isAbsent || isOut
              ? "text-slate-900/80"
              : "text-muted-foreground";
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => !isAbsent && !isOut && toggleMut.mutate(r)}
                disabled={toggleMut.isPending || isAbsent || isOut}
                aria-pressed={isIn}
                className={cn(
                  "w-full min-h-[56px] rounded-lg border-2 px-4 py-3 text-left",
                  "flex items-center justify-between gap-3",
                  "transition-colors active:scale-[0.99] disabled:opacity-100",
                  isIn && !isYellow && !isRed &&
                    "border-green-600 bg-green-50 hover:bg-green-100 text-slate-900",
                  !isIn && !isRed && !isYellow && !isAbsent && !isOut &&
                    "border-border bg-card hover:bg-muted/60",
                  isYellow &&
                    "border-amber-500 bg-amber-50 hover:bg-amber-100 text-slate-900",
                  isRed &&
                    "border-2 border-destructive bg-destructive/10 hover:bg-destructive/15 text-destructive",
                  isAbsent &&
                    "border-slate-400 bg-slate-200/70 text-slate-900 cursor-default",
                  isOut &&
                    "border-slate-400 bg-slate-100 text-slate-900 cursor-default",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        "truncate text-base font-semibold",
                        (isAbsent || isOut) && "line-through decoration-slate-500/60",
                      )}
                    >
                      {nameMap[r.participantId] ?? "Loading…"}
                    </span>
                    <Badge className="border border-slate-400 bg-white text-slate-900 text-[10px] uppercase">
                      {r.arrivalMethod.replace("_", " ")}
                    </Badge>

                    {depRed && (
                      <Badge className="bg-destructive text-destructive-foreground text-[10px] uppercase">
                        Departure Escalated — Manager notified
                      </Badge>
                    )}
                    {depYellow && (
                      <Badge className="bg-amber-500 text-white text-[10px] uppercase">
                        Departure Overdue
                      </Badge>
                    )}
                    {isRed && !depRed && (
                      <Badge className="bg-destructive text-destructive-foreground text-[10px] uppercase">
                        Escalated — Manager notified
                      </Badge>
                    )}
                    {isYellow && !depYellow && (
                      <Badge className="bg-amber-500 text-white text-[10px] uppercase">
                        Overdue
                      </Badge>
                    )}
                    {isAbsent && (
                      <Badge className="bg-slate-600 text-white text-[10px] uppercase">
                        Absent · {absentLabel}
                      </Badge>
                    )}
                    {isOut && (
                      <Badge className="bg-slate-600 text-white text-[10px] uppercase">
                        Checked out
                      </Badge>
                    )}
                  </div>
                  <div className={cn("mt-0.5 text-xs", subTextCls)}>
                    Expected{" "}
                    <ClientTime
                      iso={r.expectedArrivalAt}
                      options={{ hour: "2-digit", minute: "2-digit" }}
                    />
                    {r.expectedDepartureAt && (
                      <>
                        {" "}→{" "}
                        <ClientTime
                          iso={r.expectedDepartureAt}
                          options={{ hour: "2-digit", minute: "2-digit" }}
                        />
                      </>
                    )}
                    {r.checkedInAt && (
                      <>
                        {" "}· In{" "}
                        <ClientTime
                          iso={r.checkedInAt}
                          options={{ hour: "2-digit", minute: "2-digit" }}
                        />
                      </>
                    )}
                    {r.checkedOutAt && (
                      <>
                        {" "}· Out{" "}
                        <ClientTime
                          iso={r.checkedOutAt}
                          options={{ hour: "2-digit", minute: "2-digit" }}
                        />
                      </>
                    )}
                    {isAbsent && (
                      <> · Not attending today (PIN verified)</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isIn && !isOut && (
                    <CheckOutPopover
                      row={r}
                      participantName={nameMap[r.participantId] ?? "client"}
                      onCheckedOut={() =>
                        qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) })
                      }
                    />
                  )}
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
                      "border border-slate-300 bg-white hover:bg-slate-100",
                      "text-slate-900 shadow-sm",
                    )}
                  >
                    <Clock className="h-4 w-4" />
                  </span>
                  <div
                    className={cn(
                      "rounded-full p-2",
                      isIn
                        ? "bg-green-600 text-white"
                        : isAbsent || isOut
                          ? "bg-slate-400 text-white"
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

      <AddAttendeeModal
        open={addOpen}
        sessionId={sessionId}
        onClose={(changed: boolean) => {
          setAddOpen(false);
          if (changed) qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
        }}
      />


    </div>
  );
}
