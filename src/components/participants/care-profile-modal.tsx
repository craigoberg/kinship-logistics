import { useEffect, useState } from "react";
import { Phone, Save, AlertTriangle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { IddsiMatrix } from "./iddsi-matrix";
import { iddsiLevel } from "@/lib/iddsi";
import { type Participant } from "@/lib/data-store";
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
  const [iddsi, setIddsi] = useState({ liquids: 0, foods: 7 });
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const online = useOnlineStatus();
  const updateMutation = useUpdateParticipant();

  useEffect(() => {
    if (participant) {
      setIddsi(participant.iddsi);
      setNotes(participant.notes);
      setDirty(false);
    }
  }, [participant]);

  if (!participant) return null;

  const liquid = iddsiLevel("liquids", iddsi.liquids);
  const food = iddsiLevel("foods", iddsi.foods);

  const save = async () => {
    const patch = { iddsi, notes };
    if (!online) {
      enqueue("iddsi_change", { id: participant.id, patch });
      toast.info("Queued offline", { description: "Profile changes will sync when back online." });
      setDirty(false);
      onOpenChange(false);
      return;
    }
    try {
      const updated = await updateMutation.mutateAsync({ id: participant.id, patch });
      toast.success("Profile updated", { description: `${participant.fullName} saved.` });
      onSaved?.(updated);
      setDirty(false);
      onOpenChange(false);
    } catch (err) {
      enqueue("iddsi_change", { id: participant.id, patch });
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
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{participant.fullName}</span>
            {participant.flags.includes("Choking risk") && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> Choking risk
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            NDIS {participant.ndisId} · DOB {participant.dob}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="iddsi">IDDSI</TabsTrigger>
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 pt-4">
            <Section label="Mobility">{participant.mobility}</Section>
            <Section label="Allergies">
              {participant.allergies.length === 0 ? (
                <span className="text-muted-foreground">None recorded</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {participant.allergies.map((a) => (
                    <Badge key={a} variant="destructive">{a}</Badge>
                  ))}
                </div>
              )}
            </Section>
            <Section label="Care flags">
              {participant.flags.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {participant.flags.map((f) => (
                    <Badge key={f} variant="outline">{f}</Badge>
                  ))}
                </div>
              )}
            </Section>
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

          <TabsContent value="contact" className="space-y-3 pt-4">
            <Section label="Primary contact">{participant.primaryContact.name} ({participant.primaryContact.relation})</Section>
            <Section label="Phone">
              <a
                href={`tel:${participant.primaryContact.phone.replace(/\s/g, "")}`}
                className="inline-flex items-center gap-2 text-primary underline-offset-4 hover:underline"
              >
                <Phone className="h-4 w-4" />
                {participant.primaryContact.phone}
              </a>
            </Section>
          </TabsContent>

          <TabsContent value="notes" className="space-y-2 pt-4">
            <Label htmlFor="care-notes">Coordinator notes</Label>
            <Textarea
              id="care-notes"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
              rows={6}
              placeholder="Add notes about supports, preferences, or recent changes…"
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={save} disabled={!dirty} className="gap-1.5">
            <Save className="h-4 w-4" /> Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
