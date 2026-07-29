/**
 * EventStatusPanel — lifecycle badge + promote/close day session actions (§12 / Phase 4)
 *
 * Shown at the top of ManageEventModal for all events (outing or legacy).
 * For legacy events only the Planning→Confirmed→Open→Closed ladder is shown.
 * For outings the "Close day session" action is surfaced too.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  Info,
  Lock,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  checkPromoteGuards,
  closeEventDaySession,
  promoteEventStatus,
  repairEventStatusIfDaysStillOpen,
  type EventStatus,
  type StatusGuardResult,
} from "@/lib/api/event-lifecycle";
import { inferEventKind, listEventDaySessions } from "@/lib/api/event-outing";
import type { EventManifest } from "@/lib/data-store";
import { refetchEventManifest } from "@/lib/query/invalidation";
import { formatDate } from "@/lib/utils";

interface Props {
  event: EventManifest;
  onStatusChanged: () => void;
  /**
   * When true (mobile compact header): show only the current status chip +
   * the next-action promote/close button inline. Full ladder is hidden.
   * When false/omitted: render the full ladder + all actions (desktop default).
   */
  mobileCompact?: boolean;
}

const STATUS_ORDER: EventStatus[] = ["Planning", "Confirmed", "Open", "Closed"];

function statusIdx(s: string): number {
  return STATUS_ORDER.indexOf(s as EventStatus);
}

function statusColor(s: string): string {
  switch (s) {
    case "Planning": return "bg-blue-600";
    case "Confirmed": return "bg-indigo-600";
    case "Open": return "bg-emerald-600";
    case "Closed": return "bg-zinc-600";
    default: return "bg-slate-500";
  }
}

function statusIcon(s: string): React.ReactNode {
  switch (s) {
    case "Planning": return <Info className="h-3 w-3" />;
    case "Confirmed": return <CalendarCheck2 className="h-3 w-3" />;
    case "Open": return <CheckCircle2 className="h-3 w-3" />;
    case "Closed": return <Lock className="h-3 w-3" />;
    default: return null;
  }
}

const PROMOTE_LABELS: Record<string, string> = {
  Planning: "Confirm event",
  Confirmed: "Open event",
  Open: "Close event",
};
const PROMOTE_CONFIRM: Record<string, string> = {
  Planning:
    "This will mark the event as Confirmed. All day sessions must have a manager assigned.",
  Confirmed:
    "This authorises transport and coordinator workflows for today. The event floor does not start until the trip leader opens the location (Trip days → Config → Manager PIN).",
  Open:
    "This will close the event and lock billing. All day sessions must be closed first, and the return home manifest must be completed if bus passengers are going home. This cannot be undone.",
};

const sessionsKey = (eventId: string) => ["event-day-sessions", eventId] as const;

export function EventStatusPanel({ event, onStatusChanged, mobileCompact = false }: Props) {
  const qc = useQueryClient();
  const isOuting = event.eventKind === "single_day_outing" || event.eventKind === "multi_day_tour"
    || inferEventKind({
      startDate: event.startDate,
      endDate: event.endDate ?? event.startDate,
      eventTypeCode: event.eventTypeCode,
      primaryVenueId: event.primaryVenueId,
    }) !== "legacy";

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [guards, setGuards] = useState<StatusGuardResult | null>(null);
  const [checkingGuards, setCheckingGuards] = useState(false);
  const [closeSessionId, setCloseSessionId] = useState<string | null>(null);
  const [closeOutcome, setCloseOutcome] = useState<"closed_orderly" | "closed_incident">("closed_orderly");
  const [closeNotes, setCloseNotes] = useState("");

  const { data: sessions = [] } = useQuery({
    queryKey: sessionsKey(event.id),
    queryFn: () => listEventDaySessions(event.id),
    enabled: isOuting,
    staleTime: 30_000,
  });

  const openSessions = sessions.filter(
    (s) => s.phase !== "closed_orderly" && s.phase !== "closed_incident",
  );
  // BL-088: never show Closed while trip days remain open (integrity).
  const statusInconsistent =
    event.status === "Closed" && isOuting && openSessions.length > 0;
  const displayStatus: EventStatus = statusInconsistent
    ? "Open"
    : (event.status as EventStatus);
  const isClosed = displayStatus === "Closed";
  const currentIdx = statusIdx(displayStatus);
  const canPromote = !isClosed && currentIdx < STATUS_ORDER.length - 1;
  const nextStatus = STATUS_ORDER[currentIdx + 1] ?? null;
  const canCloseDays =
    isOuting && openSessions.length > 0 && (displayStatus === "Open" || statusInconsistent);

  // Heal Closed+open-days so promote/close paths use a real Open status.
  useEffect(() => {
    if (!statusInconsistent) return;
    let cancelled = false;
    void (async () => {
      try {
        const repaired = await repairEventStatusIfDaysStillOpen(event.id);
        if (cancelled || !repaired) return;
        toast.message("Event reopened — trip days were still open.", {
          description: "Close each day, then Close event when ready.",
        });
        await refetchEventManifest(qc);
        onStatusChanged();
      } catch (e) {
        if (!cancelled) toast.error((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusInconsistent, event.id, qc, onStatusChanged]);

  // Promote mutation
  const promoteMut = useMutation({
    mutationFn: () =>
      promoteEventStatus(event.id, event.startDate, displayStatus),
    onMutate: async () => {
      if (!nextStatus) return {};
      await qc.cancelQueries({ queryKey: ["event_manifest"] });
      const prev = qc.getQueryData<EventManifest[]>(["event_manifest"]);
      qc.setQueryData<EventManifest[]>(["event_manifest"], (old) =>
        old?.map((e) =>
          e.id === event.id
            ? {
                ...e,
                status: nextStatus,
                ...(nextStatus === "Closed" ? { billingLocked: true } : {}),
              }
            : e,
        ) ?? old,
      );
      return { prev };
    },
    onSuccess: async ({
      newStatus,
      guestsArchived,
      guestsSkipped,
      guestArchiveError,
    }) => {
      const closedBits: string[] = [];
      if (newStatus === "Closed") {
        closedBits.push("Billing locked.");
        if ((guestsArchived ?? 0) > 0) {
          closedBits.push(
            `${guestsArchived} guest${guestsArchived === 1 ? "" : "s"} archived — reuse from Add guest.`,
          );
        }
        if ((guestsSkipped ?? 0) > 0) {
          closedBits.push(
            `${guestsSkipped} guest${guestsSkipped === 1 ? "" : "s"} still on another Open/Confirmed trip — left active.`,
          );
        }
      }
      toast.success(`Event → ${newStatus}`, {
        description: closedBits.length > 0 ? closedBits.join(" ") : undefined,
      });
      if (guestArchiveError) {
        toast.warning("Guests were not archived", {
          description: guestArchiveError,
          duration: 10_000,
        });
      }
      await refetchEventManifest(qc);
      onStatusChanged();
      setConfirmOpen(false);
      setGuards(null);
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(["event_manifest"], ctx.prev);
      }
      toast.error(e.message, { duration: 10_000 });
    },
  });

  // Close day session mutation
  const closeDayMut = useMutation({
    mutationFn: () => closeEventDaySession(closeSessionId!, closeOutcome, closeNotes),
    onSuccess: () => {
      toast.success("Day session closed.");
      qc.invalidateQueries({ queryKey: sessionsKey(event.id) });
      setCloseSessionId(null);
      setCloseNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePromoteClick = async () => {
    setCheckingGuards(true);
    try {
      const result = await checkPromoteGuards(
        event.id,
        event.startDate,
        displayStatus,
      );
      setGuards(result);
      setConfirmOpen(true);
    } finally {
      setCheckingGuards(false);
    }
  };

  // ── Mobile compact: single status chip + action button inline ──────────
  if (mobileCompact) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {/* Current status chip */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white ${statusColor(displayStatus)}`}
          >
            {statusIcon(displayStatus)}
            {displayStatus}
          </span>

          {canPromote && nextStatus && (
            <Button
              size="sm"
              variant={nextStatus === "Closed" ? "destructive" : "default"}
              disabled={checkingGuards || promoteMut.isPending}
              onClick={handlePromoteClick}
              className="h-7 text-xs"
            >
              {checkingGuards ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : nextStatus === "Closed" ? (
                <Lock className="mr-1 h-3 w-3" />
              ) : (
                <ShieldCheck className="mr-1 h-3 w-3" />
              )}
              {PROMOTE_LABELS[displayStatus] ?? `→ ${nextStatus}`}
            </Button>
          )}

          {canCloseDays && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Office close:</span>
              {openSessions.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => { setCloseSessionId(s.id); setCloseOutcome("closed_orderly"); setCloseNotes(""); }}
                >
                  {formatDate(s.session_date)}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Promote + close-day dialogs (shared) */}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {PROMOTE_LABELS[displayStatus] ?? `Promote to ${nextStatus}`}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {PROMOTE_CONFIRM[displayStatus]}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {guards && !guards.ok && (
              <div className="space-y-2 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-3">
                <div className="flex items-center gap-1.5 text-sm font-bold text-destructive">
                  <XCircle className="h-4 w-4" />
                  Cannot promote — unmet conditions:
                </div>
                <ul className="ml-5 list-disc space-y-0.5 text-sm text-destructive">
                  {guards.blockers.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            )}
            {guards?.ok && (guards.warnings?.length ?? 0) > 0 && (
              <div className="space-y-2 rounded-lg border-2 border-amber-500/50 bg-amber-50 p-3">
                <div className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  Warning — you can Confirm, but Open location will be blocked until fixed:
                </div>
                <ul className="ml-5 list-disc space-y-0.5 text-sm text-amber-950">
                  {guards.warnings!.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {guards?.ok && !(guards.warnings?.length) && (
              <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                All conditions met — ready to promote.
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant={nextStatus === "Closed" ? "destructive" : "default"}
                disabled={!guards?.ok || promoteMut.isPending}
                onClick={() => promoteMut.mutate()}
              >
                {promoteMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {PROMOTE_LABELS[displayStatus] ?? "Promote"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!closeSessionId} onOpenChange={(o) => !o && setCloseSessionId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Close day session — {closeSessionId && formatDate(sessions.find((s) => s.id === closeSessionId)?.session_date ?? "")}</AlertDialogTitle>
              <AlertDialogDescription>
                Select the outcome and provide close notes before locking the session.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Outcome</Label>
                <div className="space-y-1.5">
                  {([
                    { value: "closed_orderly", label: "Closed — orderly" },
                    { value: "closed_incident", label: "Closed — incident" },
                  ] as const).map((opt) => (
                    <MobileFieldButton
                      key={opt.value}
                      title={opt.label}
                      selected={closeOutcome === opt.value}
                      onClick={() => setCloseOutcome(opt.value)}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Close notes (optional)</Label>
                <Textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} rows={3} placeholder="End-of-day summary…" />
              </div>
              {closeOutcome === "closed_incident" && (
                <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Incident outcome will be flagged in the Trip Report.
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant={closeOutcome === "closed_incident" ? "destructive" : "default"}
                disabled={closeDayMut.isPending}
                onClick={() => closeDayMut.mutate()}
              >
                {closeDayMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Close day session
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  // ── Full / desktop render ─────────────────────────────────────────────
  return (
    <>
      <div className="space-y-3">
        {statusInconsistent && (
          <div className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Event was marked Closed while trip days are still open. Status is being
              reopened — close each day, then Close event.
            </span>
          </div>
        )}

        {/* Ladder */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_ORDER.map((s, idx) => {
            // Terminal Closed = all steps complete (green), not a grey "active" step.
            const complete = isClosed ? idx <= currentIdx : idx < currentIdx;
            const active = idx === currentIdx && !isClosed;
            return (
              <div key={s} className="flex items-center gap-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white ${
                    complete
                      ? "bg-emerald-600"
                      : active
                        ? `${statusColor(s)} ring-2 ring-white/25 shadow-sm`
                        : "bg-muted text-muted-foreground"
                  }`}
                  aria-current={active ? "step" : undefined}
                >
                  {complete || active ? statusIcon(s) : null}
                  {s}
                </span>
                {idx < STATUS_ORDER.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
            );
          })}
        </div>

        {/* Billing locked note */}
        {event.billingLocked && (
          <div className="flex items-center gap-1.5 rounded bg-zinc-500/10 px-3 py-1.5 text-xs font-semibold text-zinc-600">
            <Lock className="h-3 w-3" />
            Billing locked — no further financial edits permitted.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* Promote button */}
          {canPromote && nextStatus && (
            <Button
              size="sm"
              variant={nextStatus === "Closed" ? "destructive" : "default"}
              disabled={checkingGuards || promoteMut.isPending}
              onClick={handlePromoteClick}
            >
              {checkingGuards ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : nextStatus === "Closed" ? (
                <Lock className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              )}
              {PROMOTE_LABELS[displayStatus] ?? `Promote to ${nextStatus}`}
            </Button>
          )}

          {/* Close day session quick actions (Open events, outings) */}
          {canCloseDays && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Office close day:</span>
              {openSessions.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => { setCloseSessionId(s.id); setCloseOutcome("closed_orderly"); setCloseNotes(""); }}
                >
                  {formatDate(s.session_date)}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Promote confirm dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {PROMOTE_LABELS[displayStatus] ?? `Promote to ${nextStatus}`}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {PROMOTE_CONFIRM[displayStatus]}
              </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Guard results */}
          {guards && !guards.ok && (
            <div className="space-y-2 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-3">
              <div className="flex items-center gap-1.5 text-sm font-bold text-destructive">
                <XCircle className="h-4 w-4" />
                Cannot promote — unmet conditions:
              </div>
              <ul className="ml-5 list-disc space-y-0.5 text-sm text-destructive">
                {guards.blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}

          {guards?.ok && (guards.warnings?.length ?? 0) > 0 && (
            <div className="space-y-2 rounded-lg border-2 border-amber-500/50 bg-amber-50 p-3">
              <div className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                Warning — you can Confirm, but Open location will be blocked until fixed:
              </div>
              <ul className="ml-5 list-disc space-y-0.5 text-sm text-amber-950">
                {guards.warnings!.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {guards?.ok && !(guards.warnings?.length) && (
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              All conditions met — ready to promote.
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant={nextStatus === "Closed" ? "destructive" : "default"}
              disabled={!guards?.ok || promoteMut.isPending}
              onClick={() => promoteMut.mutate()}
            >
              {promoteMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {PROMOTE_LABELS[displayStatus] ?? "Promote"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close day session dialog */}
      <AlertDialog open={!!closeSessionId} onOpenChange={(o) => !o && setCloseSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close day session — {closeSessionId && formatDate(sessions.find((s) => s.id === closeSessionId)?.session_date ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>
              Select the outcome and provide close notes before locking the session.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Outcome</Label>
              <div className="space-y-1.5">
                {([
                  { value: "closed_orderly", label: "Closed — orderly" },
                  { value: "closed_incident", label: "Closed — incident" },
                ] as const).map((opt) => (
                  <MobileFieldButton
                    key={opt.value}
                    title={opt.label}
                    selected={closeOutcome === opt.value}
                    onClick={() => setCloseOutcome(opt.value)}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Close notes (optional)</Label>
              <Textarea
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                rows={3}
                placeholder="End-of-day summary, handover notes, incident reference…"
              />
            </div>
            {closeOutcome === "closed_incident" && (
              <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Incident outcome will be flagged in the Trip Report.
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant={closeOutcome === "closed_incident" ? "destructive" : "default"}
              disabled={closeDayMut.isPending}
              onClick={() => closeDayMut.mutate()}
            >
              {closeDayMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Close day session
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
