/**
 * AppTicketsPanel — Governance Hub "App tickets" tab (BL-116)
 *
 * GREEN-note lifecycle: Log Note · Defer · Resolve / Close.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import { HubListCard } from "@/components/governance/hub-list-card";
import { HubListCardBody } from "@/components/governance/hub-list-card-body";
import { HubContextMetaGrid, HubListMetaRows } from "@/components/governance/hub-context-meta-grid";
import { ManageItemShell } from "@/components/governance/manage-item-shell";
import { operationToasts } from "@/lib/ui/operation-toasts";
import {
  HUB_WORKFLOW_STATUS_BADGE,
  HUB_WORKFLOW_STATUS_LABEL,
  maintenanceWorkflowStatus,
} from "@/lib/governance/hub-workflow-status";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";
import { defaultDeferIso } from "@/lib/governance/default-defer-iso";
import { formatDate, formatDateTime } from "@/lib/utils";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { isManagerProfile } from "@/lib/governance/is-manager";
import { resolveStaffIdWithFallback, getStaffId, resolveStaffDisplayName } from "@/lib/data-store";
import {
  addAppTicketNote,
  APP_TICKETS_KEY,
  appTicketNotesKey,
  deferAppTicket,
  listAppTicketNotes,
  listAppTickets,
  renderAppTicketNote,
  updateAppTicketStatus,
  type AppTicket,
  type AppTicketNote,
  type AppTicketTabFilter,
} from "@/lib/api/app-tickets";
import { openAppTicketOpenerUpdateMailto } from "@/lib/app-tickets/opener-update-mailto";

function staffName(id: string): string {
  return resolveStaffDisplayName(id);
}

function contextBits(ticket: AppTicket): Record<string, unknown> {
  const ctx = ticket.context;
  if (!ctx || typeof ctx !== "object") return {};
  return ctx as Record<string, unknown>;
}

interface ManageDialogProps {
  ticket: AppTicket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ManageAppTicketDialog({ ticket, open, onOpenChange }: ManageDialogProps) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [deferOn, setDeferOn] = useState(false);
  const [deferAt, setDeferAt] = useState<string>(defaultDeferIso());
  const [deferDatetimeValid, setDeferDatetimeValid] = useState(true);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"resolve" | "close">("resolve");

  useEffect(() => {
    if (open) {
      setNote("");
      setDeferOn(false);
      setDeferAt(defaultDeferIso());
      setDeferDatetimeValid(true);
    }
  }, [open, ticket.id]);

  const notesQuery = useQuery({
    queryKey: appTicketNotesKey(ticket.id),
    enabled: open,
    refetchInterval: 10_000,
    queryFn: () => listAppTicketNotes(ticket.id),
  });

  const timelineLines = useMemo(() => {
    const notes: AppTicketNote[] = notesQuery.data ?? [];
    const created = formatDateTime(ticket.createdAt);
    const createdLine = `[${created} · ${ticket.reportedByName}] Ticket filed — ${ticket.description}`;
    return [createdLine, ...notes.map(renderAppTicketNote)];
  }, [notesQuery.data, ticket]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: APP_TICKETS_KEY });
    qc.invalidateQueries({ queryKey: appTicketNotesKey(ticket.id) });
  };

  const getAuthor = async () => {
    const id = getStaffId() || (await resolveStaffIdWithFallback());
    return staffName(id);
  };

  const noteOk = note.trim().length >= MIN_TIMELINE_NOTE;
  const deferValid = !deferOn || deferDatetimeValid;

  const logMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      const text = note.trim();
      if (deferOn) {
        const dateOnly = deferAt.split("T")[0];
        await deferAppTicket(ticket.id, dateOnly, text, author);
        return {
          kind: "defer" as const,
          latestText: `Deferred to ${formatDate(dateOnly)}. Reason: ${text}`,
        };
      }
      await addAppTicketNote(ticket.id, text, author);
      return { kind: "note" as const, latestText: text };
    },
    onSuccess: async ({ kind, latestText }) => {
      invalidate();
      const mail = await openAppTicketOpenerUpdateMailto({
        ticket,
        kind,
        latestText,
        priorTimelineLines: timelineLines,
      });
      setNote("");
      setDeferOn(false);
      if (mail.opened) {
        operationToasts.ticketOpenerMailto("note");
      } else {
        if (kind === "defer") operationToasts.issueDeferred();
        else operationToasts.noteLogged();
        operationToasts.ticketOpenerMailtoMissing(ticket.reportedByName);
      }
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const startMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      await updateAppTicketStatus(ticket.id, "in_progress");
      await addAppTicketNote(ticket.id, "Review started.", author);
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const resolveMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      const text = note.trim();
      await updateAppTicketStatus(ticket.id, "resolved", {
        resolutionNotes: text || undefined,
        resolvedByName: author,
      });
      const latestText = text ? `Resolved. ${text}` : "Resolved.";
      if (text) {
        await addAppTicketNote(ticket.id, latestText, author);
      }
      return { latestText };
    },
    onSuccess: async ({ latestText }) => {
      invalidate();
      const mail = await openAppTicketOpenerUpdateMailto({
        ticket,
        kind: "resolve",
        latestText,
        priorTimelineLines: timelineLines,
      });
      setNote("");
      if (mail.opened) {
        operationToasts.ticketOpenerMailto("resolve");
      } else {
        operationToasts.ticketResolved();
        operationToasts.ticketOpenerMailtoMissing(ticket.reportedByName);
      }
      onOpenChange(false);
    },
    onError: (e: Error) => operationToasts.resolutionFailed(e.message),
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      await updateAppTicketStatus(ticket.id, "closed", { resolvedByName: author });
      await addAppTicketNote(ticket.id, "Ticket closed.", author);
    },
    onSuccess: () => {
      invalidate();
      operationToasts.ticketClosed();
      onOpenChange(false);
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const autoStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      autoStartRef.current = null;
      return;
    }
    if (ticket.status !== "open") return;
    if (autoStartRef.current === ticket.id) return;
    autoStartRef.current = ticket.id;
    startMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket.id, ticket.status]);

  const busy = logMut.isPending || resolveMut.isPending || closeMut.isPending;
  const canLog = noteOk && deferValid && !busy;
  const canResolve = noteOk && !deferOn && !busy;

  const ctx = contextBits(ticket);

  const contextCard = (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-green-600 text-white">GREEN</Badge>
        <Badge className="bg-emerald-700 text-white">App ticket</Badge>
        <Badge className={HUB_WORKFLOW_STATUS_BADGE[maintenanceWorkflowStatus(ticket.status)]}>
          {HUB_WORKFLOW_STATUS_LABEL[maintenanceWorkflowStatus(ticket.status)]}
        </Badge>
        {ticket.deferredUntil && ticket.status === "deferred" && (
          <span className="text-xs font-medium text-amber-600">
            ↻ Deferred to {formatDate(ticket.deferredUntil)}
            {ticket.deferCount > 1 && ` (×${ticket.deferCount})`}
          </span>
        )}
      </div>
      <p className="font-medium leading-snug">{ticket.title}</p>
      <p className="whitespace-pre-wrap text-xs text-muted-foreground">{ticket.description}</p>
      <HubContextMetaGrid
        rows={[
          { label: "Raised by", value: ticket.reportedByName },
          { label: "Screen", value: ticket.pathLabel },
          { label: "Form", value: ticket.formTitle },
          { label: "Last tap", value: ticket.lastControlLabel },
          { label: "Lane", value: typeof ctx.lane === "string" ? ctx.lane : null },
          {
            label: "SIM clock",
            value: ctx.simClock === true ? "Yes" : ctx.simClock === false ? "No" : null,
          },
          { label: "Logged", value: <FormattedDateTime value={ticket.createdAt} /> },
          ticket.resolvedAt
            ? { label: "Resolved", value: <FormattedDateTime value={ticket.resolvedAt} /> }
            : { label: "Resolved", value: null },
        ]}
      />
    </div>
  );

  return (
    <>
      <ManageItemShell
        open={open}
        onOpenChange={(o) => {
          if (!o) setNote("");
          onOpenChange(o);
        }}
        busy={busy}
        title="Manage App Ticket"
        description="Log a note, defer, or mark resolved. Log Note and Resolve open a draft email to the person who raised the ticket."
        contextCard={contextCard}
        timelineLines={timelineLines}
        timelineLoading={notesQuery.isFetching && !notesQuery.data}
        note={note}
        onNoteChange={setNote}
        noteLabel="Progress note"
        showDefer={ticket.status !== "resolved" && ticket.status !== "closed"}
        deferOn={deferOn}
        onDeferOnChange={setDeferOn}
        deferAt={deferAt}
        onDeferAtChange={setDeferAt}
        onDeferDatetimeValidChange={setDeferDatetimeValid}
        showEscalate={false}
        onLogUpdate={() => logMut.mutate()}
        logUpdateLabel={deferOn ? "Defer ticket" : "Log Note"}
        canLog={canLog}
        onResolveClose={
          ticket.status !== "resolved" && ticket.status !== "closed"
            ? () => {
                if (!canResolve) return;
                setPendingAction("resolve");
                setPinOpen(true);
              }
            : undefined
        }
        resolveCloseLabel="Mark Resolved"
        canResolve={canResolve}
        extraFooterStart={
          ticket.status === "resolved" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPendingAction("close");
                setPinOpen(true);
              }}
            >
              {closeMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Close ticket
            </Button>
          ) : undefined
        }
      />
      <PinReauthDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        reason="Manager PIN required to resolve or close an app ticket."
        onAuthenticated={() => {
          if (!isManagerProfile()) {
            operationToasts.managerPinRequired();
            setPinOpen(false);
            return;
          }
          setPinOpen(false);
          if (pendingAction === "close") closeMut.mutate();
          else resolveMut.mutate();
        }}
      />
    </>
  );
}

function TicketsList({
  tab,
  onManage,
}: {
  tab: AppTicketTabFilter;
  onManage: (ticket: AppTicket) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: tickets = [], isLoading, isFetching } = useQuery({
    queryKey: [...APP_TICKETS_KEY, tab],
    queryFn: () => listAppTickets(tab),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tickets;
    return tickets.filter((t) => {
      const hay = `${t.title} ${t.description} ${t.pathLabel} ${t.formTitle ?? ""} ${t.reportedByName}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [tickets, search]);

  const tabDesc = {
    active: "Open tickets waiting for a note or close-off.",
    deferred: "Parked until a next-action date.",
    resolved: "Resolved and closed history.",
    all: "All app tickets.",
  }[tab];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm text-muted-foreground">{tabDesc}</p>
        <div className="flex items-center gap-2">
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <div className="min-w-[12rem] space-y-1">
            <Label className="text-xs text-muted-foreground">Search</Label>
            <Input
              className="h-8"
              placeholder="Search title, screen, reporter…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          {tab === "active" ? "No open app tickets." : "Nothing here."}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((ticket) => (
            <HubListCard
              key={ticket.id}
              ariaLabel={`Manage ticket ${ticket.title}`}
              summary={ticket.description}
              body={
                <HubListCardBody
                  severity="green"
                  lines={{
                    issue: ticket.description,
                    workaround: null,
                    authorisingManager: null,
                    plan: null,
                  }}
                />
              }
              onClick={() => onManage(ticket)}
              badges={
                <>
                  <Badge className="bg-green-600 text-white">GREEN</Badge>
                  <Badge className="bg-emerald-700 text-white">App</Badge>
                </>
              }
              status={
                <Badge className={HUB_WORKFLOW_STATUS_BADGE[maintenanceWorkflowStatus(ticket.status)]}>
                  {HUB_WORKFLOW_STATUS_LABEL[maintenanceWorkflowStatus(ticket.status)]}
                </Badge>
              }
              meta={
                <HubListMetaRows
                  rows={[
                    { label: "Screen", value: ticket.pathLabel },
                    { label: "Form", value: ticket.formTitle },
                    { label: "Raised by", value: ticket.reportedByName },
                    { label: "Logged", value: <FormattedDateTime value={ticket.createdAt} /> },
                  ]}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AppTicketsPanel() {
  const [tab, setTab] = useState<AppTicketTabFilter>("active");
  const [managing, setManaging] = useState<AppTicket | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        In-app GREEN notes from <span className="font-medium text-foreground">Raise ticket</span>.
        Not incidents, faults, or maintenance. Everyone can see the list; resolve needs a manager PIN.
      </p>
      <Tabs value={tab} onValueChange={(v) => setTab(v as AppTicketTabFilter)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="deferred">Deferred</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="active" className="mt-4">
          <TicketsList tab="active" onManage={setManaging} />
        </TabsContent>
        <TabsContent value="deferred" className="mt-4">
          <TicketsList tab="deferred" onManage={setManaging} />
        </TabsContent>
        <TabsContent value="resolved" className="mt-4">
          <TicketsList tab="resolved" onManage={setManaging} />
        </TabsContent>
      </Tabs>

      {managing && (
        <ManageAppTicketDialog
          key={managing.id}
          ticket={managing}
          open
          onOpenChange={(o) => {
            if (!o) setManaging(null);
          }}
        />
      )}
    </div>
  );
}
