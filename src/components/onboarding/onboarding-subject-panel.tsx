import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createOnboardingCase,
  listOnboardingForSubject,
  startOnboardingReview,
  type OnboardingCase,
} from "@/lib/api/onboarding";
import {
  ONBOARDING_PACK_LABELS,
  type OnboardingPackType,
} from "@/lib/onboarding/form-types";
import { OnboardingCaseDialog } from "@/components/onboarding/onboarding-case-dialog";
import { FormattedDate } from "@/components/ui/formatted-time";

interface Props {
  subjectTable: "participants" | "staff_registry" | "carers_registry";
  subjectId: string;
  /** Default pack when starting new onboarding for this subject. */
  defaultPack: OnboardingPackType;
  /** Optional seed into a new draft (e.g. name fields). */
  seedName?: string;
}

/**
 * Compact onboarding status for Care Profile / Staff / Carer surfaces.
 */
export function OnboardingSubjectPanel({
  subjectTable,
  subjectId,
  defaultPack,
  seedName,
}: Props) {
  const [rows, setRows] = useState<OnboardingCase[]>([]);
  const [active, setActive] = useState<OnboardingCase | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listOnboardingForSubject(subjectTable, subjectId);
      setRows(list.filter((r) => r.status !== "superseded"));
    } catch (e) {
      // Table may not exist until SQL is loaded — soft fail.
      setRows([]);
      if (!/Onboarding table missing/i.test((e as Error).message)) {
        console.warn("[OnboardingSubjectPanel]", e);
      }
    } finally {
      setLoading(false);
    }
  }, [subjectTable, subjectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const latest = rows[0] ?? null;

  const startNew = async () => {
    try {
      const seed =
        defaultPack === "client"
          ? (() => {
              const parts = (seedName ?? "").trim().split(/\s+/);
              return {
                firstName: parts[0] ?? "",
                lastName: parts.slice(1).join(" "),
              };
            })()
          : { fullName: seedName ?? "" };
      const created = await createOnboardingCase(defaultPack, {
        subjectTable,
        subjectId,
        seedPayload: seed as never,
      });
      setActive(created);
      setOpen(true);
      await reload();
    } catch (e) {
      toast.error("Could not start onboarding", {
        description: (e as Error).message,
      });
    }
  };

  const review = async () => {
    if (!latest) return;
    try {
      const next = await startOnboardingReview(latest.id);
      setActive(next);
      setOpen(true);
      await reload();
    } catch (e) {
      toast.error("Could not start review", {
        description: (e as Error).message,
      });
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          Onboarding
        </div>
        {latest ? (
          <Badge variant="secondary">{latest.status.replace("_", " ")}</Badge>
        ) : (
          <Badge variant="outline">None</Badge>
        )}
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : latest ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{ONBOARDING_PACK_LABELS[latest.packType]}</p>
          {latest.reviewDueAt ? (
            <p>
              Review due <FormattedDate value={latest.reviewDueAt} />
            </p>
          ) : null}
          {latest.filingLocation ? (
            <p className="truncate">Filed: {latest.filingLocation}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No onboarding pack linked yet.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {latest ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setActive(latest);
              setOpen(true);
            }}
          >
            Open
          </Button>
        ) : null}
        {latest?.status === "signed_filed" ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-1"
            onClick={() => void review()}
          >
            <Plus className="h-3.5 w-3.5" />
            Review/Update
          </Button>
        ) : null}
        {!latest ? (
          <Button
            type="button"
            size="sm"
            className="gap-1"
            onClick={() => void startNew()}
          >
            <Plus className="h-3.5 w-3.5" />
            Start {ONBOARDING_PACK_LABELS[defaultPack]}
          </Button>
        ) : null}
      </div>

      <OnboardingCaseDialog
        open={open}
        onOpenChange={setOpen}
        caseRow={active}
        onSaved={() => void reload()}
      />
    </div>
  );
}
