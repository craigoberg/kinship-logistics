import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";

export interface CouncilSeverityOption {
  value: string;
  label: string;
}

export interface ManageItemShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  title: string;
  description: string;
  contextCard: ReactNode;
  timelineLines: string[];
  timelineLoading?: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  noteLabel?: string;
  /** Replaces the Timeline Adjustments block (compliance manage). */
  renewalSection?: ReactNode;
  /** Timeline adjustments */
  deferOn?: boolean;
  onDeferOnChange?: (value: boolean) => void;
  deferAt?: string;
  onDeferAtChange?: (value: string) => void;
  escalateOn?: boolean;
  onEscalateOnChange?: (value: boolean) => void;
  councilSev?: string;
  onCouncilSevChange?: (value: string) => void;
  councilOptions?: CouncilSeverityOption[];
  showEscalate?: boolean;
  showDefer?: boolean;
  /** Footer actions */
  secondaryActions?: ReactNode;
  onLogUpdate?: () => void;
  logUpdateLabel?: string;
  canLog?: boolean;
  onResolveClose?: () => void;
  resolveCloseLabel?: string;
  canResolve?: boolean;
  resolveButtonClassName?: string;
  extraFooterStart?: ReactNode;
}

export function ManageItemShell({
  open,
  onOpenChange,
  busy = false,
  title,
  description,
  contextCard,
  timelineLines,
  timelineLoading,
  note,
  onNoteChange,
  noteLabel = "Update note",
  renewalSection,
  deferOn = false,
  onDeferOnChange,
  deferAt = "",
  onDeferAtChange,
  escalateOn = false,
  onEscalateOnChange,
  councilSev = "Sev 2",
  onCouncilSevChange,
  councilOptions = [],
  showEscalate = false,
  showDefer = true,
  secondaryActions,
  onLogUpdate,
  logUpdateLabel = "Log Note",
  canLog = false,
  onResolveClose,
  resolveCloseLabel = "Resolve",
  canResolve = false,
  resolveButtonClassName = "bg-emerald-600 hover:bg-emerald-700 text-white",
  extraFooterStart,
}: ManageItemShellProps) {
  const deferValid =
    !deferOn || (deferAt.length > 0 && !Number.isNaN(Date.parse(deferAt)));

  const effectiveNoteLabel = deferOn
    ? "Defer reason / next action"
    : escalateOn
      ? "Council escalation note"
      : noteLabel;

  const showAdjustments =
    !renewalSection && (showDefer || showEscalate || !!secondaryActions);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {contextCard}

        <div className="space-y-1">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Timeline
          </Label>
          <div
            className="max-h-48 overflow-y-auto rounded-md border bg-muted/20 p-3 text-xs font-mono whitespace-pre-wrap text-muted-foreground"
            aria-readonly
          >
            {timelineLoading ? (
              <span className="inline-flex items-center gap-1.5 italic">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </span>
            ) : timelineLines.length === 0 ? (
              <span className="italic">No prior updates.</span>
            ) : (
              timelineLines.join("\n")
            )}
          </div>
        </div>

        <CharacterCountedTextarea
          id="manage-item-note"
          label={effectiveNoteLabel}
          value={note}
          onValueChange={onNoteChange}
          minChars={MIN_TIMELINE_NOTE}
          maxChars={2000}
          counterMode="minimum"
          rows={4}
          placeholder="Min 10 chars — appended to the immutable timeline."
          required
        />

        {renewalSection && (
          <div className="space-y-3 rounded-md border border-dashed bg-muted/10 p-3">
            {renewalSection}
          </div>
        )}

        {showAdjustments && (
          <div className="space-y-3 rounded-md border border-dashed bg-muted/10 p-3">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Timeline Adjustments (optional)
            </Label>

            {secondaryActions}

            {showDefer && onDeferOnChange && onDeferAtChange && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={deferOn}
                    onCheckedChange={(v) => {
                      const next = v === true;
                      onDeferOnChange(next);
                      if (next && onEscalateOnChange) onEscalateOnChange(false);
                    }}
                  />
                  Defer / Set next action date
                </label>
                {deferOn && (
                  <div className="space-y-1 pl-6">
                    <Label htmlFor="manage-defer-at" className="text-xs">
                      Next action date
                    </Label>
                    <Input
                      id="manage-defer-at"
                      type="datetime-local"
                      value={deferAt}
                      onChange={(e) => onDeferAtChange(e.target.value)}
                      className="[color-scheme:dark]"
                    />
                    {!deferValid && (
                      <span className="text-xs text-destructive">
                        A valid next-action date is required.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {showEscalate && onEscalateOnChange && onCouncilSevChange && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={escalateOn}
                    onCheckedChange={(v) => {
                      const next = v === true;
                      onEscalateOnChange(next);
                      if (next && onDeferOnChange) onDeferOnChange(false);
                    }}
                  />
                  Escalate to Council
                </label>
                {escalateOn && councilOptions.length > 0 && (
                  <div className="space-y-1 pl-6">
                    <Label className="text-xs">Council severity</Label>
                    <Select value={councilSev} onValueChange={onCouncilSevChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {councilOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {extraFooterStart}
          {onLogUpdate && (
            <Button variant="secondary" onClick={onLogUpdate} disabled={!canLog}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {logUpdateLabel}
            </Button>
          )}
          {onResolveClose && (
            <Button
              onClick={onResolveClose}
              disabled={!canResolve}
              className={resolveButtonClassName}
            >
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {resolveCloseLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
