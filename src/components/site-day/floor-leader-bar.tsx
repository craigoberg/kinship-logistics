import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClientTime } from "@/components/ui/client-time";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import { verifyNamedStaffPin } from "@/components/auth/pin-verify";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { DutyRequirementGapPanel } from "@/components/duty/duty-requirement-gap-panel";
import { useDutyFunctionGap } from "@/hooks/use-duty-function-gap";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { assignFloorLeader, type SiteDaySession } from "@/lib/api/site-day-sessions";
import {
  listSupportAttendanceRoll,
  SUPPORT_ROLL_KEY,
} from "@/lib/api/support-attendance";
import { listStaffRegistry } from "@/lib/data-store";

export function FloorLeaderLine({ session }: { session: SiteDaySession }) {
  const name = useFloorLeaderName(session.floorLeaderStaffId);
  if (!session.floorLeaderStaffId) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Floor leader {name}
      {session.floorLeaderSince ? (
        <>
          {" "}
          since <ClientTime iso={session.floorLeaderSince} options={{ hour: "2-digit", minute: "2-digit" }} />
        </>
      ) : null}
    </p>
  );
}

export function FloorLeaderBar({ session }: { session: SiteDaySession }) {
  const [open, setOpen] = useState(false);
  const name = useFloorLeaderName(session.floorLeaderStaffId);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Floor leader
          </p>
          <p className="text-base font-semibold">{name ?? "No floor leader yet"}</p>
          {session.floorLeaderSince ? (
            <p className="text-xs text-muted-foreground">
              Since{" "}
              <ClientTime
                iso={session.floorLeaderSince}
                options={{ hour: "2-digit", minute: "2-digit" }}
              />
            </p>
          ) : null}
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Hand over floor
        </Button>
      </div>
      <FloorLeaderHandoverDialog
        open={open}
        onOpenChange={setOpen}
        session={session}
        currentName={name}
      />
    </>
  );
}

function useFloorLeaderName(staffId: string | null): string | null {
  const staffQ = useQuery({
    queryKey: ["staff_registry"],
    queryFn: listStaffRegistry,
    staleTime: 60_000,
    enabled: !!staffId,
  });
  if (!staffId) return null;
  return staffQ.data?.find((s) => s.id === staffId)?.fullName ?? "Floor leader";
}

function FloorLeaderHandoverDialog({
  open,
  onOpenChange,
  session,
  currentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: SiteDaySession;
  currentName: string | null;
}) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const rollQ = useQuery({
    queryKey: SUPPORT_ROLL_KEY(session.id),
    queryFn: () => listSupportAttendanceRoll(session.id),
    enabled: open,
  });
  const gap = useDutyFunctionGap({
    functionKey: "floor_leader",
    staffId: selectedId,
    subjectLabel: "Floor Leader",
    enabled: open && !!selectedId,
    ledgerCategory: "CENTRE",
  });

  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const rows = [];
    for (const row of rollQ.data ?? []) {
      if (row.status !== "checked_in") continue;
      if (row.personKind === "carer" || !row.staffId) continue;
      if (row.staffId === session.floorLeaderStaffId) continue;
      if (seen.has(row.staffId)) continue;
      seen.add(row.staffId);
      rows.push(row);
    }
    return rows;
  }, [rollQ.data, session.floorLeaderStaffId]);

  const selected = candidates.find((row) => row.staffId === selectedId) ?? null;
  const missing: string[] = [];
  if (!selectedId) missing.push("Who takes the floor");
  if (gap.needsGap && !gap.approved) missing.push("Manager approval");
  const canHandover = !!selected && gap.ready && missing.length === 0;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setSelectedId(null);
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Hand over the floor</DialogTitle>
            <DialogDescription>
              Choose someone who is already checked in and is not a client. They enter their own PIN. If Floor Leader certificates are set, those are checked. If none are set, check-in is enough.
              {currentName ? ` ${currentName} leads the floor now.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {rollQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Checking who is in…</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody else is checked in. They need to arrive on the support roll first.
              </p>
            ) : (
              candidates.map((row) => (
                <MobileFieldButton
                  key={row.staffId}
                  title={row.displayName}
                  subtitle={row.personKind === "volunteer" ? "Volunteer" : "Staff"}
                  tone="success"
                  active={selectedId === row.staffId}
                  onClick={() => setSelectedId(row.staffId)}
                />
              ))
            )}
            {selected && !gap.ready ? (
              <p className="text-sm text-muted-foreground">Checking certificates…</p>
            ) : null}
            {selected && gap.needsGap ? (
              <DutyRequirementGapPanel
                actorName={selected.displayName}
                evalResult={gap.evalResult}
                note={gap.note}
                onNoteChange={gap.setNote}
                managerId={gap.managerId}
                onManagerIdChange={gap.setManagerId}
                managerPin={gap.managerPin}
                onManagerPin={gap.setManagerPin}
                managers={gap.managers}
                title="Floor Leader certificates"
              />
            ) : null}
            {missing.length > 0 && !rollQ.isLoading ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Still needed: {missing.join(" · ")}
              </div>
            ) : null}
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="button" disabled={!canHandover} onClick={() => setPinOpen(true)}>
              Hand over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Floor Leader PIN"
        length={6}
        description={
          selected
            ? `${selected.displayName}'s PIN. This does not change who is signed in.`
            : "Their PIN. This does not change who is signed in."
        }
        onVerify={async (pin) => {
          if (!selected?.staffId) throw new Error("Choose who takes the floor.");
          await verifyNamedStaffPin(selected.staffId, pin);
          const ok = await gap.ensureApproved();
          if (!ok) throw new Error("Manager must approve the duty requirement gap first.");
          const next = await assignFloorLeader({
            sessionId: session.id,
            staffId: selected.staffId,
            staffName: selected.displayName,
            previousName: currentName,
          });
          qc.setQueryData(SITE_SESSION_QUERY_KEY, next);
          toast.success(`${selected.displayName} is Floor Leader`);
          setPinOpen(false);
          setSelectedId(null);
          onOpenChange(false);
        }}
      />
    </>
  );
}
