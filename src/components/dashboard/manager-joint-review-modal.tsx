import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { cn } from "@/lib/utils";

import type {
  AssetClearanceItem,
  AssetDailyClearance,
  ClearanceIssueSeverity,
  PendingManagerReviewRow,
} from "@/lib/data-store";
import {
  DEFAULT_STAFF_UUID,
  getStaffId,
  listClearanceItems,
  submitManagerAuthorization,
  subscribeToClearance,
} from "@/lib/data-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: PendingManagerReviewRow | null;
}

function issueChip(s: ClearanceIssueSeverity | null) {
  if (s === "red") return { tone: "bg-red-600 text-white", label: "RED", emoji: "🛑" };
  if (s === "yellow")
    return { tone: "bg-yellow-400 text-black", label: "YELLOW", emoji: "🟡" };
  return { tone: "bg-green-600 text-white", label: "GREEN", emoji: "🟢" };
}

export function ManagerJointReviewModal({ open, onOpenChange, row }: Props) {
  const [live, setLive] = useState<AssetDailyClearance | null>(
    row?.clearance ?? null,
  );
  const [managerPinVerified, setManagerPinVerified] = useState(false);
  const verifiedManagerPinRef = useRef("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLive(row?.clearance ?? null);
    setManagerPinVerified(false);
    verifiedManagerPinRef.current = "";
  }, [row?.clearance.id]);

  useEffect(() => {
    if (!row) return;
    const off = subscribeToClearance(row.clearance.id, (next) => setLive(next));
    return off;
  }, [row?.clearance.id]);

  const itemsQ = useQuery<AssetClearanceItem[]>({
    queryKey: ["clearance-items", row?.clearance.id],
    queryFn: () => listClearanceItems(row!.clearance.id),
    enabled: !!row && open,
  });

  useEffect(() => {
    if (live?.status === "authorized_override") {
      toast.success("Driver confirmed — dual handshake complete.");
      onOpenChange(false);
    }
  }, [live?.status, onOpenChange]);

  if (!row) return null;

  const managerCleared = !!live?.managerAuthPinVerifiedAt;

  const managerStaffId = getStaffId() || DEFAULT_STAFF_UUID;

  const submitManager = async () => {
    if (submitting) return;
    if (!managerPinVerified) return;
    setSubmitting(true);
    try {
      const next = await submitManagerAuthorization(
        row.clearance.id,
        managerStaffId,
        verifiedManagerPinRef.current,
      );
      setLive(next);
      toast.success("Manager PIN verified — driver may now confirm.");
    } catch (err) {
      setManagerPinVerified(false);
      verifiedManagerPinRef.current = "";
      toast.error("Manager PIN rejected", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-red-600/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-300">
            <ShieldAlert className="h-5 w-5" />
            Joint Review — {row.assetName}
          </DialogTitle>
          <DialogDescription>
            {row.assetRego ?? "—"} · Driver-submitted RED clearance awaiting your
            authorization.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-background/60 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Driver's accumulated issues
          </div>
          {itemsQ.isLoading ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading items…
            </div>
          ) : (
            <ol className="mt-2 space-y-2">
              {(itemsQ.data ?? []).map((it, idx) => {
                const c = issueChip(it.severity);
                return (
                  <li key={it.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
                        c.tone,
                      )}
                    >
                      #{idx + 1} {c.label}
                    </span>
                    <span>{it.workaroundText ?? it.notes ?? it.checkpointLabel}</span>
                  </li>
                );
              })}
              {(itemsQ.data ?? []).length === 0 && (
                <li className="text-xs text-muted-foreground">
                  No item rows attached.
                </li>
              )}
            </ol>
          )}
          {row.clearance.accumulatedIssues && (
            <pre className="mt-3 whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
              {row.clearance.accumulatedIssues}
            </pre>
          )}
        </div>

        {!managerCleared ? (
          <div className="rounded-md border-2 border-red-600/40 bg-red-600/5 p-3">
            <Label
              htmlFor="manager-pin"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Supervisor Authorization PIN
            </Label>
            <PinEntryTrigger
              label="Tap to enter manager PIN"
              verified={managerPinVerified}
              verifiedLabel="Manager PIN verified"
              length={4}
              title="Supervisor authorization"
              description="Confirms you authorize the driver to proceed with logged issues."
              className="mt-1"
              onVerify={async (pin) => {
                await verifyManagerPin(managerStaffId, pin);
              }}
              onSuccess={(pin) => {
                verifiedManagerPinRef.current = pin;
                setManagerPinVerified(true);
              }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-green-600/40 bg-green-600/5 p-3 text-sm">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            <div>
              Manager PIN confirmed. Driver's tablet has unlocked — awaiting
              driver PIN…
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!managerCleared && (
            <Button
              onClick={submitManager}
              disabled={submitting || !managerPinVerified}
              className="bg-red-600 hover:bg-red-700"
            >
              {submitting ? "Verifying…" : "Confirm Manager Authorization"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
