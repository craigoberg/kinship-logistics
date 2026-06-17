import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IddsiMatrix } from "./iddsi-matrix";
import { iddsiLevel } from "@/lib/iddsi";
import { type Participant, type ParticipantPatch } from "@/lib/data-store";
import { enqueue } from "@/lib/sync-queue";
import { useUpdateParticipant } from "@/hooks/use-supabase-data";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { toast } from "sonner";

interface Props {
  participant: Participant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (p: Participant) => void;
}

export function CareProfileModal({ participant, open, onOpenChange, onSaved }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [ndisNumber, setNdisNumber] = useState("");
  const [iddsi, setIddsi] = useState({ liquids: 0, foods: 7 });
  const [dirty, setDirty] = useState(false);
  const online = useOnlineStatus();
  const updateMutation = useUpdateParticipant();

  useEffect(() => {
    if (participant) {
      setFirstName(participant.firstName);
      setLastName(participant.lastName);
      setNdisNumber(participant.ndisNumber);
      setIddsi(participant.iddsi);
      setDirty(false);
    }
  }, [participant]);

  if (!participant) return null;

  const liquid = iddsiLevel("liquids", iddsi.liquids);
  const food = iddsiLevel("foods", iddsi.foods);

  const save = async () => {
    const patch: ParticipantPatch = { firstName, lastName, ndisNumber, iddsi };
    if (!online) {
      enqueue("iddsi_change", { id: participant.id, patch: patch as unknown as Record<string, unknown> });
      toast.info("Queued offline", { description: "Profile changes will sync when back online." });
      setDirty(false);
      onOpenChange(false);
      return;
    }
    try {
      const updated = await updateMutation.mutateAsync({ id: participant.id, patch });
      toast.success("Profile updated", { description: `${updated.fullName} saved.` });
      onSaved?.(updated);
      setDirty(false);
      onOpenChange(false);
    } catch (err) {
      enqueue("iddsi_change", { id: participant.id, patch: patch as unknown as Record<string, unknown> });
      toast.warning("Saved offline", {
        description: `Will retry automatically. (${(err as Error).message})`,
      });
      setDirty(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{participant.fullName || "Participant"}</DialogTitle>
          <DialogDescription>
            NDIS {participant.ndisNumber} · Updated{" "}
            {new Date(participant.updatedAt).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="iddsi">IDDSI</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First name">
                <Input
                  value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); setDirty(true); }}
                />
              </Field>
              <Field label="Last name">
                <Input
                  value={lastName}
                  onChange={(e) => { setLastName(e.target.value); setDirty(true); }}
                />
              </Field>
              <Field label="NDIS number">
                <Input
                  value={ndisNumber}
                  onChange={(e) => { setNdisNumber(e.target.value); setDirty(true); }}
                />
              </Field>
            </div>

            <Section label="IDDSI summary">
              <div className="flex flex-wrap gap-2">
                {liquid && (
                  <div className={`rounded-md px-3 py-1.5 text-xs font-semibold ${liquid.swatch} ${liquid.text}`}>
                    Liquids · L{liquid.level} {liquid.name}
                  </div>
                )}
                {food && (
                  <div className={`rounded-md px-3 py-1.5 text-xs font-semibold ${food.swatch} ${food.text}`}>
                    Foods · L{food.level} {food.name}
                  </div>
                )}
              </div>
            </Section>
          </TabsContent>

          <TabsContent value="iddsi" className="pt-4">
            <IddsiMatrix
              liquids={iddsi.liquids}
              foods={iddsi.foods}
              onChange={(next) => {
                setIddsi(next);
                setDirty(true);
              }}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={save} disabled={!dirty || updateMutation.isPending} className="gap-1.5">
            <Save className="h-4 w-4" />
            {updateMutation.isPending ? "Saving…" : online ? "Save changes" : "Queue offline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
