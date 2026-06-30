import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import type { Participant } from "@/lib/data-store";
import type { TransportRequest, TransportRequestStatus } from "@/lib/api/transport-requests";
import { todayDateStr, TRANSPORT_REQUEST_STATUS_LABELS } from "@/lib/api/transport-requests";
import { useUpsertTransportRequest, useStaffRegistry, useTransportAssets } from "@/hooks/use-supabase-data";

function parseISODate(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participants: Participant[];
  editing: TransportRequest | null;
  defaultDate?: string;
}

export function TransportRequestFormDialog({
  open,
  onOpenChange,
  participants,
  editing,
  defaultDate,
}: Props) {
  const isEdit = !!editing;
  const upsert = useUpsertTransportRequest();
  const { data: staff = [] } = useStaffRegistry();
  const { data: fleet = [] } = useTransportAssets();

  const [participantId, setParticipantId] = useState("");
  const [requestDate, setRequestDate] = useState<Date | undefined>(undefined);
  const [scheduledTime, setScheduledTime] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [reason, setReason] = useState("");
  const [hoistRequired, setHoistRequired] = useState(false);
  const [status, setStatus] = useState<TransportRequestStatus>("requested");
  const [assignedDriverStaffId, setAssignedDriverStaffId] = useState("");
  const [assignedAssetId, setAssignedAssetId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setParticipantId(editing.participantId);
      setRequestDate(parseISODate(editing.requestDate));
      setScheduledTime(editing.scheduledTime?.slice(0, 5) ?? "");
      setPickupAddress(editing.pickupAddress ?? "");
      setDestinationLabel(editing.destinationLabel);
      setReason(editing.reason ?? "");
      setHoistRequired(editing.hoistRequired);
      setStatus(editing.status);
      setAssignedDriverStaffId(editing.assignedDriverStaffId ?? "");
      setAssignedAssetId(editing.assignedAssetId ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setParticipantId("");
      setRequestDate(parseISODate(defaultDate ?? todayDateStr()));
      setScheduledTime("");
      setPickupAddress("");
      setDestinationLabel("");
      setReason("");
      setHoistRequired(false);
      setStatus("requested");
      setAssignedDriverStaffId("");
      setAssignedAssetId("");
      setNotes("");
    }
  }, [open, editing, defaultDate]);

  const onParticipantChange = (id: string) => {
    setParticipantId(id);
    const p = participants.find((x) => x.id === id);
    if (p && !pickupAddress.trim()) {
      const addr =
        (p.regularPickupAddress ?? "").trim() || (p.streetAddress ?? "").trim();
      if (addr) setPickupAddress(addr);
    }
  };

  const save = async () => {
    if (!participantId) {
      toast.error("Select a participant");
      return;
    }
    if (!requestDate) {
      toast.error("Request date is required");
      return;
    }
    if (!destinationLabel.trim()) {
      toast.error("Destination is required");
      return;
    }

    try {
      await upsert.mutateAsync({
        id: editing?.id,
        participantId,
        requestDate: toISODate(requestDate),
        scheduledTime: scheduledTime.trim() || null,
        pickupAddress: pickupAddress.trim() || null,
        destinationLabel: destinationLabel.trim(),
        reason: reason.trim() || null,
        hoistRequired,
        status,
        assignedDriverStaffId: assignedDriverStaffId || null,
        assignedAssetId: assignedAssetId || null,
        notes: notes.trim() || null,
      });
      toast.success(isEdit ? "Request updated" : "Request created");
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save request", { description: (err as Error).message });
    }
  };

  const activeFleet = fleet.filter((a) => a.isActive);
  const activeStaff = staff.filter((s) => s.active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit transport request" : "New transport request"}</DialogTitle>
          <DialogDescription>
            One-off runs — doctor, vaccination, or special drop. Drivers complete these from the Log
            run tab.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label>Participant</Label>
            <Select value={participantId} onValueChange={onParticipantChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select participant…" />
              </SelectTrigger>
              <SelectContent>
                {participants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Date</Label>
              <DatePicker value={requestDate} onChange={setRequestDate} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="req-time">Time (optional)</Label>
              <Input
                id="req-time"
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="req-pickup">Pickup address</Label>
            <Input
              id="req-pickup"
              value={pickupAddress}
              onChange={(e) => setPickupAddress(e.target.value)}
              placeholder="Defaults from participant profile"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="req-dest">Destination</Label>
            <Input
              id="req-dest"
              value={destinationLabel}
              onChange={(e) => setDestinationLabel(e.target.value)}
              placeholder="Dr Smith — 12 Main St"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="req-reason">Reason (optional)</Label>
            <Input
              id="req-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Flu vaccination, GP review…"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="text-sm font-medium">Hoist required</div>
              <div className="text-xs text-muted-foreground">Passenger needs wheelchair hoist access</div>
            </div>
            <Switch checked={hoistRequired} onCheckedChange={setHoistRequired} />
          </div>

          {isEdit && (
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TransportRequestStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRANSPORT_REQUEST_STATUS_LABELS) as TransportRequestStatus[]).map(
                    (s) => (
                      <SelectItem key={s} value={s}>
                        {TRANSPORT_REQUEST_STATUS_LABELS[s]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Assign driver (optional)</Label>
              <Select
                value={assignedDriverStaffId || "__none__"}
                onValueChange={(v) => setAssignedDriverStaffId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {activeStaff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Assign vehicle (optional)</Label>
              <Select
                value={assignedAssetId || "__none__"}
                onValueChange={(v) => setAssignedAssetId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Any</SelectItem>
                  {activeFleet.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.regoPlate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="req-notes">Coordinator notes</Label>
            <Textarea
              id="req-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={upsert.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            {upsert.isPending ? "Saving…" : "Save request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
