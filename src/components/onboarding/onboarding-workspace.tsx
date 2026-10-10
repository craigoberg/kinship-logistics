import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ClipboardList,
  Plus,
  Trash2,
  UserPlus,
  Users,
  HeartHandshake,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  deleteOnboardingDraft,
  listOnboardingCases,
  startOnboardingReview,
  type OnboardingCase,
} from "@/lib/api/onboarding";
import {
  displayNameFromPayload,
  ONBOARDING_PACK_LABELS,
  type OnboardingCaseStatus,
  type OnboardingPackType,
} from "@/lib/onboarding/form-types";
import {
  daysUntilIsoDate,
  DEFAULT_ONBOARDING_REVIEW_RED_DAYS,
  DEFAULT_ONBOARDING_REVIEW_YELLOW_DAYS,
  isUnnamedOnboardingDraft,
  onboardingReviewUrgency,
} from "@/lib/onboarding/review-urgency";
import { OnboardingCaseDialog } from "@/components/onboarding/onboarding-case-dialog";
import { FormattedDate } from "@/components/ui/formatted-time";
import { isActiveUserManager } from "@/lib/data-store";
import { useOnboardingReviewParams } from "@/hooks/use-system-parameters";
import { useOperationalTodayIso } from "@/lib/operational-clock";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<OnboardingCaseStatus, string> = {
  draft: "Draft",
  office_confirmed: "Office confirmed",
  signed_filed: "Signed & filed",
  superseded: "Superseded",
};

/** Person column: the name typed on the draft, once it has been saved. */
function personLabel(row: OnboardingCase): string {
  const fromForm = displayNameFromPayload(row.formPayload);
  if (!isUnnamedOnboardingDraft(fromForm)) return fromForm;
  if (row.displayName && !isUnnamedOnboardingDraft(row.displayName)) return row.displayName;
  return fromForm || "—";
}

export function OnboardingWorkspace() {
  const [rows, setRows] = useState<OnboardingCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("inbox");
  const [packFilter, setPackFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<OnboardingCase | null>(null);
  const [dialogPack, setDialogPack] = useState<OnboardingPackType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OnboardingCase | null>(null);
  const [busy, setBusy] = useState(false);
  const isManager = isActiveUserManager();
  const sla = useOnboardingReviewParams();
  const todayIso = useOperationalTodayIso();

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

  const start = (pack: OnboardingPackType) => {
    setPackFilter(pack);
    setActive(null);
    setDialogPack(pack);
    setDialogOpen(true);
  };

  const openCase = (c: OnboardingCase) => {
    setActive(c);
    setDialogPack(c.packType);
    setDialogOpen(true);
  };

  const review = async (c: OnboardingCase) => {
    try {
      const next = await startOnboardingReview(c.id);
      setActive(next);
      setDialogPack(next.packType);
      setDialogOpen(true);
      await reload();
      toast.success("Review/Update draft created");
    } catch (e) {
      toast.error("Could not start review", {
        description: (e as Error).message,
      });
    }
  };

  const reviewDue = useMemo(() => {
    const yellow = sla.yellowDays ?? DEFAULT_ONBOARDING_REVIEW_YELLOW_DAYS;
    const red = sla.redDays ?? DEFAULT_ONBOARDING_REVIEW_RED_DAYS;
    return rows
      .filter((r) => r.status === "signed_filed" && r.reviewDueAt)
      .map((r) => {
        const days = daysUntilIsoDate(r.reviewDueAt!, todayIso);
        const urgency =
          days === null ? "ok" : onboardingReviewUrgency(days, yellow, red);
        return { row: r, days, urgency };
      })
      .filter((x) => x.urgency !== "ok")
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  }, [rows, sla.yellowDays, sla.redDays, todayIso]);

  const inboxRows = useMemo(
    () => rows.filter((r) => r.status === "draft" || r.status === "office_confirmed"),
    [rows],
  );

  const filtered = rows.filter((r) => {
    if (statusFilter === "inbox") {
      if (r.status !== "draft" && r.status !== "office_confirmed") return false;
    } else if (statusFilter === "review_due") {
      if (!reviewDue.some((x) => x.row.id === r.id)) return false;
    } else if (statusFilter === "active" && r.status === "superseded") {
      return false;
    } else if (
      statusFilter !== "all" &&
      statusFilter !== "active" &&
      r.status !== statusFilter
    ) {
      return false;
    }
    if (packFilter !== "all" && r.packType !== packFilter) return false;
    const needle = search.trim().toLowerCase();
    if (needle) {
      const hay =
        `${personLabel(r)} ${ONBOARDING_PACK_LABELS[r.packType]} ${STATUS_LABEL[r.status]} ${r.filingLocation ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const runDelete = async (c: OnboardingCase) => {
    setBusy(true);
    try {
      await deleteOnboardingDraft(c.id);
      if (active?.id === c.id) {
        setDialogOpen(false);
        setActive(null);
      }
      toast.success("Draft deleted");
      await reload();
    } catch (e) {
      toast.error("Could not delete draft", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Onboarding</h2>
        <p className="text-sm text-muted-foreground">
          Start a pack to type a form. Nothing is stored until you Save draft.
          Click a row to open it. Delete removes that draft. Review/Update
          copies a signed pack for the next year. Print a blank form from
          inside the open pack.
        </p>
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
          variant="outline"
          className="gap-1.5"
          onClick={() => start("client")}
        >
          <UserPlus className="h-4 w-4" />
          Start new client pack
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() => start("staff")}
        >
          <Users className="h-4 w-4" />
          Start new paid-staff pack
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() => start("volunteer")}
        >
          <ClipboardList className="h-4 w-4" />
          Start new volunteer pack
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() => start("accompanying")}
        >
          <HeartHandshake className="h-4 w-4" />
          Start new accompanying pack
        </Button>
      </div>

      {reviewDue.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-amber-400/50 bg-amber-500/5 p-3">
          <h3 className="text-sm font-semibold">Review due</h3>
          <p className="text-xs text-muted-foreground">
            Signed packs inside the Admin yellow/red window (default 30 days
            before due, red on the due date). Click a row to open, or start
            Review/Update.
          </p>
          <ul className="space-y-1.5">
            {reviewDue.map(({ row, days, urgency }) => (
              <li
                key={row.id}
                className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 hover:bg-muted/40"
                onClick={() => openCase(row)}
              >
                <div className="min-w-0">
                  <p className="font-medium">{personLabel(row)}</p>
                  <p className="text-xs text-muted-foreground">
                    {ONBOARDING_PACK_LABELS[row.packType]} · due{" "}
                    {row.reviewDueAt ? <FormattedDate value={row.reviewDueAt} /> : "—"}
                    {days !== null
                      ? days < 0
                        ? ` · ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`
                        : days === 0
                          ? " · due today"
                          : ` · ${days} day${days === 1 ? "" : "s"} left`
                      : null}
                  </p>
                </div>
                <div
                  className="flex flex-wrap items-center gap-2"
                  onClick={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => ev.stopPropagation()}
                >
                  <Badge
                    className={
                      urgency === "red"
                        ? "bg-red-600 text-white hover:bg-red-600"
                        : "bg-amber-500 text-black hover:bg-amber-500"
                    }
                  >
                    {urgency === "red" ? "Red" : "Yellow"}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="gap-1"
                    onClick={() => void review(row)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Review/Update
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inboxRows.length > 0 && statusFilter !== "inbox" ? (
        <p className="text-xs text-muted-foreground">
          {inboxRows.length} draft / waiting to file in the inbox filter.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Show</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-52">
              <SelectValue placeholder="Show" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inbox">Inbox (draft / to file)</SelectItem>
              <SelectItem value="review_due">Review due</SelectItem>
              <SelectItem value="active">Active (hide superseded)</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="office_confirmed">Office confirmed</SelectItem>
              <SelectItem value="signed_filed">Signed &amp; filed</SelectItem>
              <SelectItem value="superseded">Superseded</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Pack</Label>
          <Select value={packFilter} onValueChange={setPackFilter}>
            <SelectTrigger className="h-9 w-52">
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
        <div className="min-w-[12rem] flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input
            className="h-9"
            placeholder="Search person, pack, filing…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
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
                  {search.trim()
                    ? "No packs match this search."
                    : statusFilter === "inbox"
                      ? "No drafts waiting. Close a form without Save draft and nothing is stored."
                      : "No onboarding cases match these filters."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const name = personLabel(r);
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t hover:bg-muted/40"
                    onClick={() => openCase(r)}
                  >
                    <td className="px-3 py-2 font-medium">
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${name}`}
                        className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            openCase(r);
                          }
                        }}
                      >
                        {name}
                      </span>
                    </td>
                    <td className="px-3 py-2">{ONBOARDING_PACK_LABELS[r.packType]}</td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary">{STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {r.reviewDueAt ? <FormattedDate value={r.reviewDueAt} /> : "—"}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground">
                      {r.filingLocation ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      <FormattedDate value={r.updatedAt.slice(0, 10)} />
                    </td>
                    <td className="px-3 py-2">
                      <div
                        className="flex flex-wrap justify-end gap-1"
                        onClick={(ev) => ev.stopPropagation()}
                        onKeyDown={(ev) => ev.stopPropagation()}
                      >
                        {r.status === "draft" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className={cn("gap-1 text-destructive")}
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        ) : null}
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <OnboardingCaseDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setActive(null);
            setDialogPack(null);
          }
        }}
        caseRow={active}
        packType={dialogPack ?? active?.packType}
        onSaved={(c) => {
          setActive(c);
          setDialogPack(c.packType);
          void reload();
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? personLabel(deleteTarget) : "This pack"} will be removed. Nothing
              has been confirmed to the live record yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => deleteTarget && void runDelete(deleteTarget)}
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
