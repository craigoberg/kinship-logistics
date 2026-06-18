import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronsUpDown,
  Check,
  Plus,
  Pencil,
  Link2Off,
  Users,
  Phone,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CarerFormSheet } from "@/components/directory/carer-form-sheet";
import {
  useCarersForParticipant,
  useCarersRegistry,
  useSetPrimaryCarer,
  useDemoteCarer,
  useLinkCarerToParticipant,
  useUnlinkCarer,
} from "@/hooks/use-supabase-data";
import type { Carer } from "@/lib/data-store";
import { cn } from "@/lib/utils";

interface Props {
  participantId: string;
  participantName: string;
}

const RED_TOAST = "!bg-red-600 !text-white !border-red-700";

export function CarerNetworkPanel({ participantId, participantName }: Props) {
  const { data: linked = [], isLoading } = useCarersForParticipant(participantId);
  const { data: registry = [] } = useCarersRegistry();
  const setPrimary = useSetPrimaryCarer();
  const demote = useDemoteCarer();
  const link = useLinkCarerToParticipant();
  const unlink = useUnlinkCarer();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingCarer, setEditingCarer] = useState<Carer | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<Carer | null>(null);

  const linkedIds = useMemo(() => new Set(linked.map((c) => c.id)), [linked]);
  const linkable = useMemo(
    () => registry.filter((c) => !linkedIds.has(c.id)),
    [registry, linkedIds],
  );

  const handleTogglePrimary = async (carer: Carer, next: boolean) => {
    try {
      if (next) {
        await setPrimary.mutateAsync({ carerId: carer.id, participantId });
        toast.success("Primary contact updated", { description: carer.fullName });
      } else {
        await demote.mutateAsync({ carerId: carer.id, participantId });
        toast.success("Demoted to secondary", { description: carer.fullName });
      }
    } catch (err) {
      toast.error("Could not update primary contact", {
        description: (err as Error).message,
        className: RED_TOAST,
        duration: 12_000,
      });
    }
  };

  const handleLinkExisting = async (carer: Carer) => {
    setPickerOpen(false);
    try {
      await link.mutateAsync({ carerId: carer.id, participantId });
      toast.success("Carer linked", {
        description: `${carer.fullName} attached to ${participantName}.`,
      });
    } catch (err) {
      toast.error("Could not link carer", {
        description: (err as Error).message,
        className: RED_TOAST,
        duration: 12_000,
      });
    }
  };

  const handleConfirmUnlink = async () => {
    if (!unlinkTarget) return;
    const target = unlinkTarget;
    setUnlinkTarget(null);
    try {
      await unlink.mutateAsync({ carerId: target.id, participantId });
      toast.success("Carer unlinked", { description: target.fullName });
    } catch (err) {
      toast.error("Could not unlink carer", {
        description: (err as Error).message,
        className: RED_TOAST,
        duration: 12_000,
      });
    }
  };

  return (
    <>
      <Accordion type="single" collapsible className="rounded-lg border border-border bg-card/60">
        <AccordionItem value="carers" className="border-0">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2 text-left">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Carers &amp; Support Network</span>
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {linked.length} linked
              </span>
              {linked.some((c) => c.isPrimaryContact) && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Primary on file
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {/* Action bar */}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/60 p-2">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    size="sm"
                    className="min-w-[240px] flex-1 justify-between font-normal"
                  >
                    Link existing carer…
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search registry…" />
                    <CommandList>
                      <CommandEmpty>No unlinked carers found.</CommandEmpty>
                      <CommandGroup>
                        {linkable.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.fullName} ${c.relationship ?? ""} ${c.phone ?? ""}`}
                            onSelect={() => handleLinkExisting(c)}
                          >
                            <Check className="mr-2 h-4 w-4 opacity-0" />
                            <span>{c.fullName}</span>
                            {c.relationship && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {c.relationship}
                              </span>
                            )}
                            {c.participantId && (
                              <span className="ml-auto text-[10px] uppercase text-amber-600">
                                already linked elsewhere
                              </span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Button
                size="sm"
                onClick={() => {
                  setEditingCarer(null);
                  setSheetOpen(true);
                }}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Add brand new carer
              </Button>
            </div>

            {/* List */}
            {isLoading ? (
              <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                Loading carers…
              </div>
            ) : linked.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                No carers linked yet. Use the actions above to attach an existing record or create a new one.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Name</th>
                      <th className="px-3 py-2 font-semibold">Relationship</th>
                      <th className="px-3 py-2 font-semibold">Phone</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linked.map((c) => (
                      <tr key={c.id} className="border-t border-border/70">
                        <td className="px-3 py-2 font-medium text-foreground">{c.fullName}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.relationship ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.phone ? (
                            <a
                              href={`tel:${c.phone}`}
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              <Phone className="h-3 w-3" />
                              {c.phone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                              c.isPrimaryContact
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
                            )}
                          >
                            {c.isPrimaryContact ? "Primary" : "Secondary"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            <div className="flex items-center gap-1.5" title="Designate as primary emergency contact">
                              <Switch
                                checked={c.isPrimaryContact}
                                onCheckedChange={(v) => handleTogglePrimary(c, v)}
                                disabled={setPrimary.isPending || demote.isPending}
                              />
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Primary
                              </span>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingCarer(c);
                                setSheetOpen(true);
                              }}
                              aria-label="Edit carer"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setUnlinkTarget(c)}
                              aria-label="Unlink carer"
                            >
                              <Link2Off className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <CarerFormSheet
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o);
          if (!o) setEditingCarer(null);
        }}
        carer={editingCarer}
        defaultParticipantId={participantId}
        lockParticipant
      />

      <AlertDialog open={!!unlinkTarget} onOpenChange={(o) => !o && setUnlinkTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink carer?</AlertDialogTitle>
            <AlertDialogDescription>
              {unlinkTarget?.fullName} will be detached from {participantName}. The carer record
              itself stays in the registry and can be re-linked later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUnlink}>Unlink</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
