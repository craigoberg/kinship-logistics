/**
 * RaiseTicketDialog — BL-116
 *
 * GREEN-note intake: description + auto context. No RYGE / verbal path.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ticket } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { APP_TICKETS_KEY, createAppTicket } from "@/lib/api/app-tickets";
import { notifyAppTicketCreated } from "@/lib/app-tickets/notify-client";
import {
  buildAppTicketContext,
  useHarvestedOpsContext,
} from "@/lib/app-tickets/harvest-context";
import { useTicketSurface } from "@/lib/app-tickets/ticket-surface";
import { DEFAULT_STAFF_UUID } from "@/lib/data-store";

const MIN_DESC = 20;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RaiseTicketDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const ops = useHarvestedOpsContext();
  const surface = useTicketSurface();
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [snapForm, setSnapForm] = useState<string | null>(null);
  const [snapControl, setSnapControl] = useState<string | null>(null);

  // Snapshot context once when the sheet opens. Do not re-run on last-tap
  // changes — clicking File ticket used to wipe the description.
  useEffect(() => {
    if (!open) return;
    setDescription("");
    setSubmitting(false);
    setSubmitError(null);
    setSnapForm(surface.activeFormTitle);
    setSnapControl(surface.lastControlLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-only snapshot
  }, [open]);

  const descOk = description.trim().length >= MIN_DESC;
  const missing = descOk ? [] : ["What happened (≥20 characters)"];

  const preview = useMemo(() => {
    return {
      who: buildAppTicketContext({
        ops,
        formTitle: snapForm,
        lastControlLabel: snapControl,
      }).staffName,
      where: ops.pathLabel,
      form: snapForm,
      clicked: snapControl,
    };
  }, [ops, snapForm, snapControl]);

  const submit = async () => {
    if (!descOk || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const ctx = buildAppTicketContext({
        ops,
        formTitle: snapForm,
        lastControlLabel: snapControl,
      });
      const staffId = ctx.staffId && ctx.staffId !== DEFAULT_STAFF_UUID ? ctx.staffId : null;
      const titleBits = [ops.pathLabel, snapForm].filter(Boolean);
      const title = titleBits.join(" · ") || "App ticket";

      const ticket = await createAppTicket({
        title,
        description: description.trim(),
        reportedByStaffId: staffId,
        reportedByName: ctx.staffName,
        pathLabel: ops.pathLabel,
        formTitle: snapForm,
        lastControlLabel: snapControl,
        context: ctx,
      });

      qc.invalidateQueries({ queryKey: APP_TICKETS_KEY });
      void notifyAppTicketCreated(ticket);
      toast.success("GREEN ticket filed.", {
        description: "Visible on the Dashboard tile and Hub → App tickets.",
      });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not file ticket.";
      console.error("[RaiseTicketDialog] file failed", err);
      setSubmitError(message);
      toast.error("Ticket not filed", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  const body = (
    <div className="space-y-3">
      <div className="rounded-md border border-emerald-600/40 bg-emerald-600/10 p-3 text-xs leading-relaxed text-foreground">
        <p>
          <span className="font-semibold">Who:</span> {preview.who}
        </p>
        <p>
          <span className="font-semibold">Where:</span> {preview.where}
        </p>
        {preview.form && (
          <p>
            <span className="font-semibold">Form:</span> {preview.form}
          </p>
        )}
        {preview.clicked && (
          <p>
            <span className="font-semibold">Last tap:</span> {preview.clicked}
          </p>
        )}
        <p className="mt-1 text-muted-foreground">
          Lane, clock, and session details are attached automatically.
        </p>
      </div>

      <CharacterCountedTextarea
        id="app-ticket-description"
        label="What happened / what did you expect"
        value={description}
        onValueChange={setDescription}
        minChars={MIN_DESC}
        rows={5}
        required
        placeholder="e.g. Save on Add guest stayed disabled after I filled DOB."
      />

      {missing.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Needed: {missing.join(", ")}
        </div>
      )}
      {submitError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {submitError}
        </div>
      )}
    </div>
  );

  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
        Close
      </Button>
      <FieldActionButton
        type="button"
        variant="success"
        disabled={!descOk || submitting}
        onClick={() => void submit()}
        fullWidth={false}
        className="w-full sm:w-auto"
      >
        {submitting ? "Filing…" : "File ticket"}
      </FieldActionButton>
    </div>
  );

  if (isMobile) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        hideTicket
        title={
          <span className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-emerald-500" />
            Raise ticket
          </span>
        }
        description="GREEN note for the office to review — not an Incident / Fault."
      >
        <div className="space-y-4 pb-2">{body}</div>
        {footer}
      </BottomSheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideTicket className="z-[70] max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-emerald-500" />
            Raise ticket
          </DialogTitle>
          <DialogDescription>
            GREEN note for the office to review — not an Incident / Fault.
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
