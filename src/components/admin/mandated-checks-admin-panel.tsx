import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { IconActionButton } from "@/components/ui/icon-action-button";
import {
  canManageSystemParameters,
  updateSystemParameter,
} from "@/lib/api/system-parameters";
import {
  SYSTEM_PARAMETERS_QUERY_KEY,
  useMandatedChecks,
  useMandatedCloseChecks,
  useMealPrepChecks,
  useVenueOpenChecks,
} from "@/hooks/use-system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import { MEAL_PREP_CHECKS_PARAM_KEY } from "@/lib/meal-open";

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

function listsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function normalizeLabels(labels: string[]): string[] {
  return labels.map((l) => l.trim()).filter(Boolean);
}

/** Keys edited here — hide from the raw JSON System Parameters table. */
export const MANDATED_CHECK_PARAM_KEYS = [
  "site_management.mandated_compliance_checks",
  "site_management.mandated_close_checks",
  "event_deliver.venue_open_checks",
  MEAL_PREP_CHECKS_PARAM_KEY,
] as const;

type CheckListKey = (typeof MANDATED_CHECK_PARAM_KEYS)[number];

interface CheckListSectionProps {
  title: string;
  blurb: string;
  paramKey: CheckListKey;
  saved: string[];
  canEdit: boolean;
}

/**
 * One mandated-check list — Venue Safety Template layout (prompt + Yes/No + Required),
 * persisted as a JSON string array on system_parameters.
 */
function CheckListSection({
  title,
  blurb,
  paramKey,
  saved,
  canEdit,
}: CheckListSectionProps) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string[]>(saved);
  const [addOpen, setAddOpen] = useState(false);
  const [addPrompt, setAddPrompt] = useState("");
  const [justification, setJustification] = useState("");

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const dirty = !listsEqual(draft, saved);

  const save = useMutation({
    mutationFn: async () => {
      const next = normalizeLabels(draft);
      const reason =
        justification.trim().length >= 10
          ? justification.trim()
          : `Updated ${title} checklist from Admin.`;
      await updateSystemParameter({
        key: paramKey,
        newValue: next,
        justification: reason,
      });
      return next;
    },
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: SYSTEM_PARAMETERS_QUERY_KEY });
      setDraft(next);
      setJustification("");
      setAddOpen(false);
      setAddPrompt("");
      toast.success("Checklist saved", {
        description:
          next.length === 0
            ? "Empty list = high-trust (no ticks required)."
            : `${next.length} field${next.length === 1 ? "" : "s"} — required at open/close.`,
      });
    },
    onError: (e: Error) =>
      toast.error("Could not save checklist", { description: e.message }),
  });

  const handleAdd = () => {
    const label = addPrompt.trim();
    if (!label) {
      toast.error("Enter a prompt for the check.");
      return;
    }
    if (draft.some((d) => d.toLowerCase() === label.toLowerCase())) {
      toast.error("That check is already on the list.");
      return;
    }
    setDraft((prev) => [...prev, label]);
    setAddPrompt("");
    setAddOpen(false);
  };

  const handleDelete = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setAddOpen(true)}
            disabled={save.isPending}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add field
          </Button>
        )}
      </div>

      {draft.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">
          No fields yet — high-trust open/close (no ticks required).
        </p>
      ) : (
        <div className="divide-y rounded-lg border text-sm">
          {draft.map((label, index) => (
            <div key={`${label}-${index}`} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{label}</span>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    Yes / No
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    Required
                  </Badge>
                </div>
              </div>
              {canEdit && (
                <IconActionButton
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  tooltip="Remove check"
                  onClick={() => handleDelete(index)}
                  disabled={save.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconActionButton>
              )}
            </div>
          ))}
        </div>
      )}

      {addOpen && canEdit && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Prompt</Label>
            <Input
              placeholder="e.g. Fire extinguisher accessible?"
              value={addPrompt}
              onChange={(e) => setAddPrompt(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Operators tick Yes/No at open or close — same idea as venue safety fields.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="space-y-1.5">
            <Label htmlFor={`just-${paramKey}`} className="text-xs">
              Justification (optional if ≥10 chars; otherwise a default is used)
            </Label>
            <Textarea
              id={`just-${paramKey}`}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
              className="text-sm"
              placeholder="Why this checklist changed…"
              disabled={save.isPending}
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
            >
              <Save className="mr-1 h-3.5 w-3.5" />
              {save.isPending ? "Saving…" : "Save checklist"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Admin editor for Day Centre Open/Close and Event Deliver Open walkthroughs.
 * Mirrors Venue → Safety template (list + Add field); no raw JSON.
 */
export function MandatedChecksAdminPanel() {
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permissionQ.data === true;

  const openChecks = useMandatedChecks();
  const closeChecks = useMandatedCloseChecks();
  const venueOpenChecks = useVenueOpenChecks();
  const mealPrepChecks = useMealPrepChecks();

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Mandated walkthrough checklists
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            These fields appear as Yes/No ticks at Day Centre open/close, Event Deliver open
            location, and Open meal (cooked/packed). Empty list = high-trust (no ticks). Same
            layout idea as Venue → Safety template — no JSON editing.
          </p>
        </div>
        {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      </div>

      <CheckListSection
        title="Day Centre — Open (Start of Day)"
        blurb="Ticked in Start of Day before the centre opens. Fridge temp lives here — not on meal open."
        paramKey="site_management.mandated_compliance_checks"
        saved={openChecks}
        canEdit={canEdit}
      />
      <CheckListSection
        title="Day Centre — Close"
        blurb="Ticked in Close Centre before finalise."
        paramKey="site_management.mandated_close_checks"
        saved={closeChecks}
        canEdit={canEdit}
      />
      <CheckListSection
        title="Event Deliver — Open location"
        blurb="Ticked in Open location before trip-leader PIN (BL-070)."
        paramKey="event_deliver.venue_open_checks"
        saved={venueOpenChecks}
        canEdit={canEdit}
      />
      <CheckListSection
        title="Meal prep — Open meal (cooked / packed)"
        blurb="Ticked when opening a cooked or packed meal (Centre Activities + Trip Programme). Skipped for takeaway, venue-provided, and brought-own-food. Fridge temp stays on Open Centre."
        paramKey={MEAL_PREP_CHECKS_PARAM_KEY}
        saved={mealPrepChecks}
        canEdit={canEdit}
      />
    </div>
  );
}
