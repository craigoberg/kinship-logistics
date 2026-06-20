import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  resolveComplianceAsset,
  type ComplianceAsset,
} from "@/lib/api/compliance-assets";
import { listStaffRegistry, type StaffMember } from "@/lib/data-store";

const MIN_NOTES = 20;
const MIN_EVIDENCE = 6;

interface Props {
  asset: ComplianceAsset | null;
  onClose: () => void;
  onResolved?: () => void;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function oneYearFromTodayISO(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ResolveComplianceAssetModal({ asset, onClose, onResolved }: Props) {
  const [newExpiry, setNewExpiry] = useState<string>(oneYearFromTodayISO());
  const [actionDate, setActionDate] = useState<string>(todayISO());
  const [evidenceRef, setEvidenceRef] = useState("");
  const [notes, setNotes] = useState("");
  const [managerStaffId, setManagerStaffId] = useState<string>("");
  const [managerPin, setManagerPin] = useState("");
  const [witnessStaffId, setWitnessStaffId] = useState<string>("");
  const [witnessPin, setWitnessPin] = useState("");
  const [staff, setStaff] = useState<StaffMember[]>([]);

  const handshake = asset?.config?.handshake === "dual" ? "dual" : "single";

  useEffect(() => {
    if (!asset) return;
    setNewExpiry(oneYearFromTodayISO());
    setActionDate(todayISO());
    setEvidenceRef("");
    setNotes("");
    setManagerStaffId("");
    setManagerPin("");
    setWitnessStaffId("");
    setWitnessPin("");
    listStaffRegistry().then((s) => setStaff(s.filter((x) => x.active))).catch(() => setStaff([]));
  }, [asset]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!asset) throw new Error("No asset.");
      return resolveComplianceAsset({
        assetId: asset.id,
        newExpiry,
        actionDate,
        evidenceRef,
        justification: notes,
        managerStaffId,
        managerPin,
        witnessStaffId: handshake === "dual" ? witnessStaffId : null,
        witnessPin: handshake === "dual" ? witnessPin : null,
      });
    },
    onSuccess: () => {
      toast.success(`Resolved: ${asset?.name}`);
      onResolved?.();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = useMemo(() => {
    if (!asset) return false;
    if (!newExpiry || newExpiry <= todayISO()) return false;
    if (!actionDate || actionDate > todayISO()) return false;
    if (evidenceRef.trim().length < MIN_EVIDENCE) return false;
    if (notes.trim().length < MIN_NOTES) return false;
    if (!managerStaffId || managerPin.length < 4) return false;
    if (handshake === "dual") {
      if (!witnessStaffId || witnessPin.length < 4) return false;
      if (witnessStaffId === managerStaffId) return false;
    }
    return !mut.isPending;
  }, [
    asset,
    newExpiry,
    actionDate,
    evidenceRef,
    notes,
    managerStaffId,
    managerPin,
    witnessStaffId,
    witnessPin,
    handshake,
    mut.isPending,
  ]);

  if (!asset) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Resolve compliance asset
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{asset.name}</span> ·{" "}
            <span className="font-mono text-xs">{asset.category}</span> ·{" "}
            current expiry {asset.expiry_date ?? "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Action date</Label>
            <Input
              type="date"
              value={actionDate}
              max={todayISO()}
              onChange={(e) => setActionDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>New expiry</Label>
            <Input
              type="date"
              value={newExpiry}
              min={todayISO()}
              onChange={(e) => setNewExpiry(e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Evidence reference (min {MIN_EVIDENCE} chars)</Label>
            <Input
              placeholder="e.g. invoice #, policy ref, ticket id"
              value={evidenceRef}
              onChange={(e) => setEvidenceRef(e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Justification (min {MIN_NOTES} chars)</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why is this being resolved now? Recorded in the ledger."
            />
          </div>

          <div className="space-y-1">
            <Label>Manager</Label>
            <Select value={managerStaffId} onValueChange={setManagerStaffId}>
              <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Manager PIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>

          {handshake === "dual" && (
            <>
              <div className="space-y-1">
                <Label>Witness</Label>
                <Select value={witnessStaffId} onValueChange={setWitnessStaffId}>
                  <SelectTrigger><SelectValue placeholder="Select witness" /></SelectTrigger>
                  <SelectContent>
                    {staff
                      .filter((s) => s.id !== managerStaffId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.fullName}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Witness PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={witnessPin}
                  onChange={(e) => setWitnessPin(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!canSubmit}>
            {mut.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              "Resolve & log"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
