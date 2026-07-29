// End-of-Day Closure rail.
//
// • Gates the workspace via the primary "Initiate Day Centre Closure" CTA
//   on the ActiveDayPanel.
// • Lists every roll row that is not yet checked out / accounted.
// • If any client is un-accounted-for, demands ≥ 20 char justification via
//   <CharacterCountedTextarea> (blue progress line + X/Y tracker + §4.3
//   thick red required outline). Finalise stays disabled until valid.
// • Operator PIN sign-off via PinReauthDialog.
// • On success: writes CENTRE_CLOSED to operational_ledger AND flips the
//   site_day_sessions row to closed_orderly. Ledger-write failure aborts.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { ClientTime } from "@/components/ui/client-time";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { MandatedChecksList } from "@/components/site-day/mandated-checks-list";
import { supabase } from "@/integrations/supabase/client";
import { listParticipants, resolveStaffIdWithFallback } from "@/lib/data-store";
import { tryGetGps } from "@/lib/api/ledger";
import {
  listAttendanceRoll,
  type ClientAttendanceRow,
} from "@/lib/api/client-attendance";
import {
  listSiteDayVisitors,
  siteDayVisitorsKey,
} from "@/lib/api/site-day-visitors";
import { closeSession } from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { useMandatedCloseChecks } from "@/hooks/use-system-parameters";
import {
  countOpenSiteDayActivities,
  siteDayActivitiesKey,
} from "@/lib/api/site-day-activities";
import { CAUTION_STRIP_CLASS } from "@/lib/ui/caution-callout";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
}

const ROLL_KEY = (sid: string) => ["client-attendance-roll", sid] as const;

export function DayCentreClosureModal({ open, onOpenChange, sessionId }: Props) {
  const qc = useQueryClient();
  const [justification, setJustification] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const closeChecks = useMandatedCloseChecks();
  const allChecksConfirmed =
    closeChecks.length === 0 || ticked.size >= closeChecks.length;

  useEffect(() => {
    if (open) {
      setTicked(new Set());
      setJustification("");
    }
  }, [open]);

  const participantsQ = useQuery({
    queryKey: ["participants", "all-for-roll"],
    queryFn: listParticipants,
    staleTime: 5 * 60_000,
  });
  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of participantsQ.data ?? []) m[p.id] = p.fullName;
    return m;
  }, [participantsQ.data]);

  const rollQ = useQuery({
    queryKey: ROLL_KEY(sessionId),
    queryFn: () => listAttendanceRoll(sessionId),
    enabled: open && !!sessionId,
    staleTime: 5_000,
  });

  const visitorsQ = useQuery({
    queryKey: siteDayVisitorsKey(sessionId),
    queryFn: () => listSiteDayVisitors(sessionId),
    enabled: open && !!sessionId,
    staleTime: 5_000,
  });

  const openActivitiesQ = useQuery({
    queryKey: [...siteDayActivitiesKey(sessionId), "open-count"],
    queryFn: () => countOpenSiteDayActivities(sessionId),
    enabled: open && !!sessionId,
    staleTime: 5_000,
  });
  const openActivityCount = openActivitiesQ.data ?? 0;

  // Never arrived → may close with justification (marked absent).
  // Still checked in → must check out first — do NOT mark them absent
  // (that left present clients looking like "Absent today" after Reset).
  const stillOnSite: ClientAttendanceRow[] = (rollQ.data ?? []).filter(
    (r) => r.status === "checked_in",
  );
  const visitorsStillPresent = (visitorsQ.data ?? []).filter((v) => !v.leftAt);
  const unaccounted: ClientAttendanceRow[] = (rollQ.data ?? []).filter(
    (r) =>
      r.status !== "checked_in" &&
      r.status !== "checked_out" &&
      r.status !== "accounted" &&
      r.status !== "absent",
  );
  const needsJustification = unaccounted.length > 0;
  const justOk = !needsJustification || justification.trim().length >= 20;
  const canFinalise =
    !rollQ.isLoading &&
    !visitorsQ.isLoading &&
    justOk &&
    stillOnSite.length === 0 &&
    visitorsStillPresent.length === 0 &&
    allChecksConfirmed;

  const finaliseMut = useMutation({
    mutationFn: async () => {
      if (!allChecksConfirmed) {
        throw new Error("Complete all mandated close checks before closing.");
      }
      if (stillOnSite.length > 0) {
        throw new Error("Check out all clients still on site before closing.");
      }
      if (visitorsStillPresent.length > 0) {
        throw new Error("Mark all visitors left before closing.");
      }
      const staffId = await resolveStaffIdWithFallback();
      const gps = await tryGetGps();
      const closeChecksConfirmed = closeChecks.filter((_, i) => ticked.has(i));

      // 1) Append-only ledger receipt. Guardrail §1.1 — abort if it fails.
      const { error: ledgerErr } = await supabase
        .from("operational_ledger")
        .insert({
          staff_id: staffId,
          category: "CENTRE",
          severity: "INFO",
          action_type: "CENTRE_CLOSED",
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          metadata: {
            session_id: sessionId,
            unaccounted_count: unaccounted.length,
            unaccounted: unaccounted.map((u) => ({
              attendance_id: u.id,
              participant_id: u.participantId,
              participant_name: nameMap[u.participantId] ?? "",
              expected_arrival_at: u.expectedArrivalAt,
              escalation_severity: u.escalationSeverity,
            })),
            justification: needsJustification ? justification.trim() : null,
            closed_by: staffId,
            close_checks_confirmed: closeChecksConfirmed,
          },
        });
      if (ledgerErr) {
        throw new Error(
          `Ledger write failed — closure aborted: ${ledgerErr.message}`,
        );
      }

      // 2) Mark remaining un-accounted rows as 'absent' with justification copy.
      if (unaccounted.length > 0) {
        const ids = unaccounted.map((u) => u.id);
        await supabase
          .from("client_attendance_log")
          .update({ status: "absent", notes: justification.trim() })
          .in("id", ids);
      }

      // 3) Flip site_day_sessions to closed_orderly (existing helper writes
      //    its own ledger row too — that's fine, additional audit trail).
      const next = await closeSession(
        needsJustification ? justification.trim() : "All clients accounted.",
      );
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(SITE_SESSION_QUERY_KEY, next);
      qc.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
      qc.invalidateQueries({ queryKey: siteDayVisitorsKey(sessionId) });
      toast.success("Day Centre closed.", {
        description: `${unaccounted.length} un-accounted client${unaccounted.length === 1 ? "" : "s"} recorded to the ledger.`,
      });
      setJustification("");
      setTicked(new Set());
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error("Closure failed", { description: e.message });
    },
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Initiate Day Centre Closure</DialogTitle>
            <DialogDescription>
              Final teardown. All workspace actions are gated until this
              modal is satisfied. The closure is committed as an immutable{" "}
              <code>CENTRE_CLOSED</code> entry on the operational ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {rollQ.isLoading || visitorsQ.isLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading roll…
              </div>
            ) : (
              <>
                {openActivityCount > 0 && (
                  <div
                    className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${CAUTION_STRIP_CLASS}`}
                  >
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <strong>{openActivityCount}</strong> Activities tab item
                      {openActivityCount === 1 ? " is" : "s are"} still{" "}
                      <strong>Open</strong> (meal or med round). Complete them
                      on Activities when you can — soft warning only; Close is
                      not blocked.
                    </span>
                  </div>
                )}
                {stillOnSite.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                      <span>
                        <strong>{stillOnSite.length}</strong> client
                        {stillOnSite.length === 1 ? " is" : "s are"} still
                        checked in. Check them out on the Attendance Roll
                        before closing (Check-Out tab) — they will not be
                        marked absent.
                      </span>
                    </div>
                    <ul className="max-h-32 space-y-1 overflow-auto rounded border bg-muted/20 p-2 text-xs">
                      {stillOnSite.map((u) => (
                        <li key={u.id} className="font-medium">
                          {nameMap[u.participantId] ?? u.participantId}
                          {u.checkedInAt && (
                            <span className="ml-2 font-normal text-muted-foreground">
                              In{" "}
                              <ClientTime
                                iso={u.checkedInAt}
                                options={{ hour: "2-digit", minute: "2-digit" }}
                              />
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {visitorsStillPresent.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                      <span>
                        <strong>{visitorsStillPresent.length}</strong> visitor
                        {visitorsStillPresent.length === 1 ? " is" : "s are"}{" "}
                        still on site. Mark them left on the Attendance Roll
                        before closing.
                      </span>
                    </div>
                    <ul className="max-h-32 space-y-1 overflow-auto rounded border bg-muted/20 p-2 text-xs">
                      {visitorsStillPresent.map((v) => (
                        <li key={v.id} className="font-medium">
                          {v.displayName}
                          <span className="ml-2 font-normal text-muted-foreground">
                            In{" "}
                            <ClientTime
                              iso={v.arrivedAt}
                              options={{ hour: "2-digit", minute: "2-digit" }}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {unaccounted.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-md border-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive">
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      <span>
                        <strong>{unaccounted.length}</strong> client
                        {unaccounted.length === 1 ? " never arrived" : "s never arrived"}
                        . A justification of at least 20 characters is required;
                        they will be recorded as absent on close.
                      </span>
                    </div>
                    <ul className="max-h-44 space-y-1 overflow-auto rounded border bg-muted/20 p-2 text-xs">
                      {unaccounted.map((u) => (
                        <li key={u.id} className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {nameMap[u.participantId] ?? u.participantId}
                          </span>
                          <span className="text-muted-foreground">
                            Expected{" "}
                            <ClientTime
                              iso={u.expectedArrivalAt}
                              options={{ hour: "2-digit", minute: "2-digit" }}
                            />
                            {u.escalationSeverity && (
                              <>
                                {" "}·{" "}
                                <span
                                  className={
                                    u.escalationSeverity === "red"
                                      ? "font-semibold text-destructive"
                                      : "font-semibold text-amber-600"
                                  }
                                >
                                  {u.escalationSeverity.toUpperCase()}
                                </span>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <CharacterCountedTextarea
                      label="Justification for clients who never arrived"
                      hint="Min 20 characters"
                      value={justification}
                      onValueChange={setJustification}
                      minChars={20}
                      maxChars={500}
                      required
                      placeholder="Describe contact attempts, family follow-ups, and operational rationale for closing with these clients un-accounted."
                    />
                  </div>
                )}

                {stillOnSite.length === 0 && (
                  <>
                    <MandatedChecksList
                      items={closeChecks}
                      ticked={ticked}
                      onTickedChange={setTicked}
                      heading="Confirm site is ready to close"
                      paramKey="site_management.mandated_close_checks"
                      emptyTrustVerb="close"
                    />

                    {closeChecks.length > 0 && !allChecksConfirmed && (
                      <div className="flex items-start gap-2 rounded-md border border-yellow-500/60 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
                        <p>
                          Tick each close confirmation above before Finalise
                          &amp; PIN.
                        </p>
                      </div>
                    )}

                    {/* Primary CTA — big green FieldActionButton (not a footer blue chip) */}
                    <FieldActionButton
                      variant={canFinalise ? "success" : "secondary"}
                      onClick={() => setPinOpen(true)}
                      disabled={!canFinalise || finaliseMut.isPending}
                    >
                      <span className="flex items-center justify-center gap-3">
                        {finaliseMut.isPending ? (
                          <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-6 w-6 shrink-0" />
                        )}
                        {finaliseMut.isPending
                          ? "Finalising…"
                          : unaccounted.length === 0 && allChecksConfirmed
                            ? "All clients accounted for — Finalise & sign with PIN"
                            : "Finalise & sign with PIN"}
                      </span>
                    </FieldActionButton>
                  </>
                )}
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinReauthDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        reason="Operator sign-off required to commit CENTRE_CLOSED."
        onAuthenticated={() => {
          setPinOpen(false);
          finaliseMut.mutate();
        }}
      />
    </>
  );
}
