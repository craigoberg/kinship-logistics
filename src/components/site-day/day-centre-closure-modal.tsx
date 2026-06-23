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

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert } from "lucide-react";
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
import { ClientTime } from "@/components/ui/client-time";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { supabase } from "@/integrations/supabase/client";
import { listParticipants, resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import {
  listAttendanceRoll,
  type ClientAttendanceRow,
} from "@/lib/api/client-attendance";
import { closeSession } from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";

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

  const unaccounted: ClientAttendanceRow[] = (rollQ.data ?? []).filter(
    (r) => r.status !== "checked_out" && r.status !== "accounted" && r.status !== "absent",
  );
  const needsJustification = unaccounted.length > 0;
  const justOk = !needsJustification || justification.trim().length >= 20;
  const canFinalise = !rollQ.isLoading && justOk;

  const finaliseMut = useMutation({
    mutationFn: async () => {
      const staffId = await resolveStaffIdWithFallback();
      const gps = await tryGetGps();

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
      toast.success("Day Centre closed.", {
        description: `${unaccounted.length} un-accounted client${unaccounted.length === 1 ? "" : "s"} recorded to the ledger.`,
      });
      setJustification("");
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
        onOpenChange={(o) => {
          if (finaliseMut.isPending) return;
          onOpenChange(o);
        }}
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
            {rollQ.isLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading roll…
              </div>
            ) : unaccounted.length === 0 ? (
              <div className="rounded-md border border-green-600/40 bg-green-50 p-3 text-sm text-green-900">
                All clients accounted for. Proceed to PIN sign-off.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-md border-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>
                    <strong>{unaccounted.length}</strong> client
                    {unaccounted.length === 1 ? " is" : "s are"} un-accounted-for.
                    A justification of at least 20 characters is required before
                    closure can finalise.
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
                  label="Justification for un-accounted clients"
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
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={finaliseMut.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => setPinOpen(true)}
              disabled={!canFinalise || finaliseMut.isPending}
            >
              {finaliseMut.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Finalising…
                </>
              ) : (
                "Finalise & sign with PIN"
              )}
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
