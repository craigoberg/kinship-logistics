import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useInsertParticipant } from "@/hooks/use-supabase-data";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LIQUIDS = [0, 1, 2, 3, 4]; // IDDSI 0–4 for drinks
const SOLIDS = [3, 4, 5, 6, 7]; // IDDSI 3–7 for foods

export function AddParticipantModal({ open, onOpenChange }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [ndisNumber, setNdisNumber] = useState("");
  const [liquids, setLiquids] = useState(0);
  const [foods, setFoods] = useState(7);
  const [pinHash, setPinHash] = useState("");
  const insert = useInsertParticipant();

  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setNdisNumber("");
      setLiquids(0);
      setFoods(7);
      setPinHash("");
    }
  }, [open]);

  const canSave =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    ndisNumber.trim().length > 0 &&
    !insert.isPending;

  const save = async () => {
    try {
      const created = await insert.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ndisNumber: ndisNumber.trim(),
        iddsi: { liquids, foods },
        dualWitnessPinHash: pinHash.trim() || null,
      });
      toast.success("Participant added", { description: created.fullName });
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not add participant", {
        description: (err as Error).message,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add new participant</DialogTitle>
          <DialogDescription>
            Writes directly to the participants table.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 sm:grid-cols-2">
          <Field label="First name">
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Last name">
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
          <Field label="NDIS number" className="sm:col-span-2">
            <Input
              value={ndisNumber}
              onChange={(e) => setNdisNumber(e.target.value)}
              placeholder="e.g. 430000001"
            />
          </Field>

          <Field label="IDDSI liquids (0–4)">
            <Select value={String(liquids)} onValueChange={(v) => setLiquids(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIQUIDS.map((n) => (
                  <SelectItem key={n} value={String(n)}>Level {n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="IDDSI solids (3–7)">
            <Select value={String(foods)} onValueChange={(v) => setFoods(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOLIDS.map((n) => (
                  <SelectItem key={n} value={String(n)}>Level {n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Dual-witness PIN hash (optional)" className="sm:col-span-2">
            <Input
              value={pinHash}
              onChange={(e) => setPinHash(e.target.value)}
              placeholder="hashed pin"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave} className="gap-1.5">
            <UserPlus className="h-4 w-4" />
            {insert.isPending ? "Saving…" : "Add participant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
