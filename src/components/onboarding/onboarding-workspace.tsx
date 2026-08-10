import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ClipboardList,
  Plus,
  RefreshCw,
  UserPlus,
  Users,
  HeartHandshake,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createOnboardingCase,
  listOnboardingCases,
  startOnboardingReview,
  type OnboardingCase,
} from "@/lib/api/onboarding";
import {
  ONBOARDING_PACK_LABELS,
  type OnboardingCaseStatus,
  type OnboardingPackType,
} from "@/lib/onboarding/form-types";
import { OnboardingCaseDialog } from "@/components/onboarding/onboarding-case-dialog";
import { FormattedDate } from "@/components/ui/formatted-time";
import { isActiveUserManager } from "@/lib/data-store";

const STATUS_LABEL: Record<OnboardingCaseStatus, string> = {
  draft: "Draft",
  office_confirmed: "Office confirmed",
  signed_filed: "Signed & filed",
  superseded: "Superseded",
};

export function OnboardingWorkspace() {
  const [rows, setRows] = useState<OnboardingCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [packFilter, setPackFilter] = useState<string>("all");
  const [active, setActive] = useState<OnboardingCase | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const isManager = isActiveUserManager();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listOnboardingCases();
      setRows(list);
    } catch (e) {
      toast.error("Could not load onboarding", {
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const start = async (pack: OnboardingPackType) => {
    try {
      const created = await createOnboardingCase(pack);
      setActive(created);
      setDialogOpen(true);
      await reload();
    } catch (e) {
      toast.error("Could not start onboarding", {
        description: (e as Error).message,
      });
    }
  };

  const openCase = (c: OnboardingCase) => {
    setActive(c);
    setDialogOpen(true);
  };

  const review = async (c: OnboardingCase) => {
    try {
      const next = await startOnboardingReview(c.id);
      setActive(next);
      setDialogOpen(true);
      await reload();
      toast.success("Review/Update draft created");
    } catch (e) {
      toast.error("Could not start review", {
        description: (e as Error).message,
      });
    }
  };

  const filtered = rows.filter((r) => {
    if (statusFilter === "active" && r.status === "superseded") return false;
    if (statusFilter !== "all" && statusFilter !== "active" && r.status !== statusFilter)
      return false;
    if (packFilter !== "all" && r.packType !== packFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Onboarding</h2>
          <p className="text-sm text-muted-foreground">
            ALPHA: online form → office confirm → print → wet-sign → Filing
            location. Hub tracks annual review (+12 months) and cert expiries.
            Material changes use Review/Update.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void reload()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {!isManager ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          Staff/volunteer induction writes to Personnel require a Manager
          session. Client and accompanying packs can still be drafted; confirm
          may fail for workforce packs without Manager.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="gap-1.5"
          onClick={() => void start("client")}
        >
          <UserPlus className="h-4 w-4" />
          Client intake
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="gap-1.5"
          onClick={() => void start("staff")}
        >
          <Users className="h-4 w-4" />
          Paid staff
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="gap-1.5"
          onClick={() => void start("volunteer")}
        >
          <ClipboardList className="h-4 w-4" />
          Volunteer
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="gap-1.5"
          onClick={() => void start("accompanying")}
        >
          <HeartHandshake className="h-4 w-4" />
          Accompanying person
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (hide superseded)</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="office_confirmed">Office confirmed</SelectItem>
            <SelectItem value="signed_filed">Signed &amp; filed</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={packFilter} onValueChange={setPackFilter}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue placeholder="Pack" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All packs</SelectItem>
            {(Object.keys(ONBOARDING_PACK_LABELS) as OnboardingPackType[]).map(
              (k) => (
                <SelectItem key={k} value={k}>
                  {ONBOARDING_PACK_LABELS[k]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Pack</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Review due</th>
              <th className="px-3 py-2 font-medium">Filing</th>
              <th className="px-3 py-2 font-medium">Updated</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No onboarding cases yet. Start a pack above.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-medium">
                    {r.displayName ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {ONBOARDING_PACK_LABELS[r.packType]}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary">{STATUS_LABEL[r.status]}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {r.reviewDueAt ? (
                      <FormattedDate value={r.reviewDueAt} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground">
                    {r.filingLocation ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <FormattedDate value={r.updatedAt.slice(0, 10)} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openCase(r)}
                      >
                        Open
                      </Button>
                      {r.status === "signed_filed" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="gap-1"
                          onClick={() => void review(r)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Review/Update
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <OnboardingCaseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        caseRow={active}
        onSaved={(c) => {
          setActive(c);
          void reload();
        }}
      />
    </div>
  );
}
