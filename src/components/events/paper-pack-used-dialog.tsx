/**
 * Record that a printed leader pack was the copy used for part of a trip day.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { Button } from "@/components/ui/button";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldActionButton } from "@/components/ui/field-action-button";
import {
  listPaperPackNotes,
  paperPackScopeWord,
  recordPaperPackUsed,
  type PaperPackScope,
} from "@/lib/api/paper-pack-note";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn, formatDateTime, formatDateWithWeekday } from "@/lib/utils";

const SCOPES: { id: PaperPackScope; title: string; subtitle: string }[] = [
  { id: "whole_day", title: "The whole day", subtitle: "The sheet covers this day" },
  { id: "roll", title: "The roll", subtitle: "Morning roll, evening roll, or check-in" },
  { id: "place", title: "A place", subtitle: "One stop was written on the sheet" },
  { id: "bus", title: "The bus", subtitle: "The bus check or the leave was on paper" },
];

export type PaperPackDay = { date: string; dayNumber: number };

export function PaperPackUsedControl({
  eventId,
  eventTitle,
  days,
  defaultDate,
  floor,
}: {
  eventId: string;
  eventTitle: string;
  days: PaperPackDay[];
  defaultDate?: string;
  /** Floor button on Event Deliver. Office uses an outline button. */
  floor?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const notesQ = useQuery({
    queryKey: ["paper-pack-notes", eventId],
    queryFn: () => listPaperPackNotes(eventId),
    staleTime: 15_000,
  });
  const notes = notesQ.data ?? [];

  return (
    <div className="space-y-2">
      {floor ? (
        <FieldActionButton variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <FileText className="h-4 w-4" />
          Paper pack was used
        </FieldActionButton>
      ) : (
        <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
          <FileText className="mr-2 h-4 w-4" />
          Paper pack was used
        </Button>
      )}
      {notes.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {notes.map((note) => (
            <li key={note.id}>
              {formatDateTime(note.createdAt)} — {note.summary}
            </li>
          ))}
        </ul>
      ) : null}
      <PaperPackUsedDialog
        open={open}
        onOpenChange={setOpen}
        eventId={eventId}
        eventTitle={eventTitle}
        days={days}
        defaultDate={defaultDate}
        onSaved={() => void qc.invalidateQueries({ queryKey: ["paper-pack-notes", eventId] })}
      />
    </div>
  );
}

function PaperPackUsedDialog({
  open,
  onOpenChange,
  eventId,
  eventTitle,
  days,
  defaultDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  eventTitle: string;
  days: PaperPackDay[];
  defaultDate?: string;
  onSaved: () => void;
}) {
  const initial = days.find((day) => day.date.slice(0, 10) === defaultDate?.slice(0, 10))?.date
    ?? days[0]?.date
    ?? "";
  const [date, setDate] = useState(initial);
  const [scope, setScope] = useState<PaperPackScope | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [filedWhere, setFiledWhere] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(initial);
    setScope(null);
    setPlaceName("");
    setFiledWhere("");
  }, [open, initial]);

  const day = days.find((row) => row.date.slice(0, 10) === date.slice(0, 10)) ?? null;
  const placeOk = scope !== "place" || placeName.trim().length >= 2;
  const filedOk = filedWhere.trim().length >= 2;
  const missing: string[] = [];
  if (!day) missing.push("which day");
  if (!scope) missing.push("what was on paper");
  if (scope === "place" && !placeOk) missing.push("which place");
  if (!filedOk) missing.push("where the sheet was filed");
  const valid = missing.length === 0 && !!day && !!scope;

  const save = async () => {
    if (!valid || !day || !scope) return;
    setSaving(true);
    try {
      await recordPaperPackUsed({
        eventId,
        eventTitle,
        sessionDate: day.date,
        dayNumber: day.dayNumber,
        scope,
        placeName: scope === "place" ? placeName.trim() : null,
        filedWhere,
      });
      toast.success("Paper pack noted on this trip.");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the paper note.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paper pack was used</DialogTitle>
          <DialogDescription>
            The sheet stays the record for the times written on it. This note points at that sheet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className={cn("space-y-2 rounded-xl p-1", requiredFieldOutline(!day))}>
            <p className="text-sm font-semibold">Which day</p>
            {days.map((row) => (
              <MobileFieldButton
                key={row.date}
                title={`Day ${row.dayNumber} · ${formatDateWithWeekday(row.date)}`}
                active={row.date.slice(0, 10) === date.slice(0, 10)}
                onClick={() => setDate(row.date)}
              />
            ))}
          </div>
          <div className={cn("space-y-2 rounded-xl p-1", requiredFieldOutline(!scope))}>
            <p className="text-sm font-semibold">What was on paper</p>
            {SCOPES.map((row) => (
              <MobileFieldButton
                key={row.id}
                title={row.title}
                subtitle={row.subtitle}
                active={scope === row.id}
                onClick={() => setScope(row.id)}
              />
            ))}
          </div>
          {scope === "place" ? (
            <CharacterCountedInput
              label="Which place"
              value={placeName}
              onValueChange={setPlaceName}
              minChars={2}
              maxChars={80}
            />
          ) : null}
          <CharacterCountedInput
            label="Where the sheet was filed"
            value={filedWhere}
            onValueChange={setFiledWhere}
            minChars={2}
            maxChars={120}
          />
          {missing.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Still needed: {missing.join(", ")}.
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {scope ? paperPackScopeWord(scope, placeName) : "This note"} on Day {day?.dayNumber}. The tablet is not filled in from these ticks.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={!valid || saving} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
