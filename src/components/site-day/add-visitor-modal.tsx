/**
 * BL-097 — Add a non-registered Day Centre visitor (not a participants walk-in).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, UserRoundPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MobileOptionButton } from "@/components/manifest/mobile-field-button";
import { listParticipants } from "@/lib/data-store";
import {
  addSiteDayVisitor,
  siteDayVisitorsKey,
  VISITOR_KIND_LABELS,
  type SiteDayVisitorKind,
} from "@/lib/api/site-day-visitors";

interface Props {
  open: boolean;
  sessionId: string;
  onClose: (changed: boolean) => void;
}

const KINDS: SiteDayVisitorKind[] = [
  "trial",
  "friend_family",
  "site",
  "other",
];

export function AddVisitorModal({ open, sessionId, onClose }: Props) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [kind, setKind] = useState<SiteDayVisitorKind>("trial");
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const participantsQ = useQuery({
    queryKey: ["participants", "all-for-roll"],
    queryFn: listParticipants,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const activeParticipants = useMemo(() => {
    const rows = participantsQ.data ?? [];
    return rows
      .map((p) => ({ id: p.id, fullName: p.fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [participantsQ.data]);

  const linkedName = linkedId
    ? (activeParticipants.find((p) => p.id === linkedId)?.fullName ?? null)
    : null;

  const reset = () => {
    setDisplayName("");
    setKind("trial");
    setLinkedId(null);
    setNote("");
  };

  const addMut = useMutation({
    mutationFn: () =>
      addSiteDayVisitor({
        sessionId,
        displayName,
        kind,
        linkedParticipantId: linkedId,
        note,
      }),
    onSuccess: (row) => {
      toast.success(`${row.displayName} added as visitor.`, {
        description: "On site until Mark left.",
      });
      qc.invalidateQueries({ queryKey: siteDayVisitorsKey(sessionId) });
      reset();
      onClose(true);
    },
    onError: (e: Error) => {
      toast.error("Could not add visitor", { description: e.message });
    },
  });

  const handleOpenChange = (o: boolean) => {
    if (addMut.isPending) return;
    if (!o) {
      reset();
      onClose(false);
    }
  };

  const nameOk = displayName.trim().length > 0;
  const submitDisabled = !nameOk || addMut.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add visitor</DialogTitle>
          <DialogDescription>
            Non-registered person on site today — trial, friend/family, site
            visitor (tradie, inspector, council, etc.), or other. Not a client on
            the attendance roll — mark left before Close Centre.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="visitor-name">Display name</Label>
            <Input
              id="visitor-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Sam Visitor"
              autoComplete="off"
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Kind</Label>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <MobileOptionButton
                  key={k}
                  label={VISITOR_KIND_LABELS[k]}
                  selected={kind === k}
                  onClick={() => setKind(k)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Linked client (optional)</Label>
            <div className="rounded-md border">
              <Command>
                <CommandInput placeholder="Search participants…" />
                <CommandList className="max-h-40">
                  {participantsQ.isLoading ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : activeParticipants.length === 0 ? (
                    <CommandEmpty>No participants.</CommandEmpty>
                  ) : (
                    <CommandGroup>
                      <CommandItem
                        value="__none__"
                        onSelect={() => setLinkedId(null)}
                        className={!linkedId ? "bg-primary/10 text-primary" : ""}
                      >
                        None
                      </CommandItem>
                      {activeParticipants.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={p.fullName}
                          onSelect={() => setLinkedId(p.id)}
                          className={
                            linkedId === p.id
                              ? "bg-primary/10 text-primary"
                              : ""
                          }
                        >
                          {p.fullName}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </div>
            {linkedName && (
              <p className="text-xs text-muted-foreground">
                With: <span className="font-medium text-foreground">{linkedName}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="visitor-note">Note (optional)</Label>
            <Textarea
              id="visitor-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="e.g. AC repair / fire inspection / with support worker…"
            />
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={() => addMut.mutate()}
            disabled={submitDisabled}
            className="gap-2"
          >
            {addMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserRoundPlus className="h-4 w-4" />
            )}
            Add visitor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
