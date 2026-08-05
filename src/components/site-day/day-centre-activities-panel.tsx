/**
 * BL-100 / BL-073 / BL-077 — Day Centre Activities tab (meals + med rounds).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pill,
  Play,
  UtensilsCrossed,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientTime } from "@/components/ui/client-time";
import { ClinicalFlagChips } from "@/components/ui/clinical-flag-chips";
import { TodaysMedicationCard } from "@/components/medication/todays-medication-card";
import { MealServiceSummary } from "@/components/meals/meal-service-summary";
import { OpenMealSheet } from "@/components/meals/open-meal-sheet";
import { SiteDayMealServiceRoll } from "@/components/site-day/site-day-meal-service-roll";
import { useTodaysMedicationRound } from "@/hooks/use-todays-medication-round";
import { clinicalFlagsFromParticipant } from "@/lib/clinical-flags";
import {
  completeSiteDayActivity,
  ensureSiteDayActivitiesSeeded,
  listSiteDayActivities,
  MEAL_SOURCE_LABELS,
  MEAL_SLOT_LABELS,
  openSiteDayActivity,
  siteDayActivitiesKey,
  type SiteDayActivity,
} from "@/lib/api/site-day-activities";
import { countOutstandingSiteDayMealServes } from "@/lib/api/site-day-meal-service";
import { listAttendanceRoll } from "@/lib/api/client-attendance";
import { listParticipants } from "@/lib/data-store";
import type { MealOpenPayload } from "@/lib/meal-open";
import { cn } from "@/lib/utils";

type Props = {
  sessionId: string;
};

export function DayCentreActivitiesPanel({ sessionId }: Props) {
  const qc = useQueryClient();
  const [expandedMed, setExpandedMed] = useState(false);

  const activitiesQ = useQuery({
    queryKey: siteDayActivitiesKey(sessionId),
    queryFn: async () => {
      await ensureSiteDayActivitiesSeeded(sessionId);
      return listSiteDayActivities(sessionId);
    },
    staleTime: 15_000,
  });

  const rollQ = useQuery({
    queryKey: ["client-attendance-roll", sessionId],
    queryFn: () => listAttendanceRoll(sessionId),
    staleTime: 20_000,
  });
  const participantsQ = useQuery({
    queryKey: ["participants", "all-for-roll"],
    queryFn: listParticipants,
    staleTime: 60_000,
  });

  const onSiteFlags = useMemo(() => {
    const onSite = new Set(
      (rollQ.data ?? [])
        .filter((r) => r.status === "checked_in")
        .map((r) => r.participantId),
    );
    return (participantsQ.data ?? [])
      .filter((p) => onSite.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.fullName,
        chips: clinicalFlagsFromParticipant(p),
      }))
      .filter((p) => p.chips.length > 0);
  }, [rollQ.data, participantsQ.data]);

  const openMut = useMutation({
    mutationFn: ({
      id,
      mealOpen,
    }: {
      id: string;
      mealOpen?: MealOpenPayload | null;
    }) => openSiteDayActivity(id, mealOpen),
    onSuccess: (act) => {
      void qc.invalidateQueries({ queryKey: siteDayActivitiesKey(sessionId) });
      if (act.activityKind === "meal") {
        void qc.invalidateQueries({
          queryKey: ["site-day-meal-service-roll", act.id],
        });
      }
      toast.success("Activity opened");
    },
    onError: (e: Error) =>
      toast.error("Could not open activity", { description: e.message }),
  });
  const completeMut = useMutation({
    mutationFn: async (activity: SiteDayActivity) => {
      if (activity.activityKind === "meal") {
        const outstanding = await countOutstandingSiteDayMealServes(activity.id);
        if (outstanding > 0) {
          throw new Error(
            `${outstanding} person${outstanding === 1 ? "" : "s"} still expected on the meal roll. Mark Served / Modified / Own order / Declined / N/A before completing.`,
          );
        }
      }
      return completeSiteDayActivity(activity.id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: siteDayActivitiesKey(sessionId) });
      toast.success("Activity completed");
    },
    onError: (e: Error) =>
      toast.error("Could not complete activity", { description: e.message }),
  });

  useEffect(() => {
    const activeMed = (activitiesQ.data ?? []).find(
      (a) => a.activityKind === "medication_round" && a.phase === "active",
    );
    if (activeMed) setExpandedMed(true);
  }, [activitiesQ.data]);

  const rows = activitiesQ.data ?? [];

  if (activitiesQ.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (activitiesQ.isError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        Could not load activities. Run{" "}
        <code className="text-xs">docs/sql/2026-07-26_site_day_activities.sql</code>{" "}
        then hard refresh. {(activitiesQ.error as Error).message}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Meals and medication rounds for people on site. Allergy / diet chips
        below for anyone checked in with flags.
      </p>

      {onSiteFlags.length > 0 && (
        <Card className="space-y-2 border-amber-500/40 bg-amber-500/5 p-3">
          <div className="text-xs font-semibold uppercase text-amber-900">
            On-site clinical flags
          </div>
          <ul className="space-y-1.5">
            {onSiteFlags.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                <ClinicalFlagChips chips={p.chips} personName={p.name} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ul className="space-y-2">
        {rows.map((a) =>
          a.activityKind === "medication_round" ? (
            <MedicationActivityCard
              key={a.id}
              activity={a}
              busy={openMut.isPending || completeMut.isPending}
              onOpen={() => openMut.mutate({ id: a.id })}
              onComplete={() => completeMut.mutate(a)}
              medExpanded={expandedMed}
              onToggleMed={() => setExpandedMed((v) => !v)}
            />
          ) : a.activityKind === "meal" ? (
            <MealActivityCard
              key={a.id}
              activity={a}
              busy={openMut.isPending || completeMut.isPending}
              onOpenMeal={(payload) =>
                openMut.mutate({ id: a.id, mealOpen: payload })
              }
              onComplete={() => completeMut.mutate(a)}
            />
          ) : (
            <ActivityCard
              key={a.id}
              activity={a}
              busy={openMut.isPending || completeMut.isPending}
              onOpen={() => openMut.mutate({ id: a.id })}
              onComplete={() => completeMut.mutate(a)}
            />
          ),
        )}
      </ul>

      {rows.length === 0 && (
        <Card className="border-dashed p-4 text-sm text-muted-foreground">
          No activities seeded. Close and re-open the centre after running the
          Activities SQL, or wait for Open Centre seed.
        </Card>
      )}
    </div>
  );
}

function ActivityCard({
  activity,
  busy,
  onOpen,
  onComplete,
}: {
  activity: SiteDayActivity;
  busy: boolean;
  onOpen: () => void;
  onComplete: () => void;
}) {
  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-2.5",
        activity.phase === "active" && "border-primary/50 bg-primary/5",
        activity.phase === "completed" && "opacity-75",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 rounded-md bg-muted p-2">
          <UtensilsCrossed className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-sm">{activity.title}</span>
            <Badge variant="outline" className="text-[10px] uppercase">
              {activity.phase}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {activity.phase === "pending" && (
            <Button
              type="button"
              size="sm"
              className="h-11 min-h-11 gap-1"
              disabled={busy}
              onClick={onOpen}
            >
              <Play className="h-3.5 w-3.5" />
              Open
            </Button>
          )}
          {activity.phase === "active" && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-11 min-h-11 gap-1"
              disabled={busy}
              onClick={onComplete}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Complete
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function MealActivityCard({
  activity,
  busy,
  onOpenMeal,
  onComplete,
}: {
  activity: SiteDayActivity;
  busy: boolean;
  onOpenMeal: (payload: MealOpenPayload) => void;
  onComplete: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState(
    activity.phase === "active" || activity.phase === "completed",
  );

  useEffect(() => {
    if (activity.phase === "active") {
      setExpanded(true);
      setSheetOpen(false);
    }
  }, [activity.phase]);

  const isCompleted = activity.phase === "completed";
  const isActive = activity.phase === "active";

  return (
    <li
      className={cn(
        "rounded-xl border-2 transition-colors",
        isActive && "border-primary/60 bg-primary/5",
        !isActive && !isCompleted && "border-border bg-card",
        isCompleted && "border-border bg-card",
        isCompleted && !expanded && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div
          className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-3"
          onClick={() => {
            if (isActive || isCompleted) setExpanded((v) => !v);
          }}
          role="button"
          aria-expanded={expanded}
        >
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              isCompleted
                ? "bg-emerald-600 text-white"
                : isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {isCompleted ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <UtensilsCrossed className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-semibold">
                {activity.title}
              </span>
              <Badge
                className={cn(
                  "text-[10px] font-bold uppercase",
                  isCompleted && "bg-emerald-600 text-white",
                  isActive && "bg-primary text-primary-foreground",
                  activity.phase === "pending" &&
                    "bg-muted text-muted-foreground",
                )}
              >
                {activity.phase}
              </Badge>
              <Badge className="gap-0.5 bg-amber-600 text-[10px] text-white">
                <UtensilsCrossed className="h-3 w-3" />
                Meal
              </Badge>
            </div>
            {(activity.menuNotes || activity.mealSource) && (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                {activity.menuNotes?.trim() ||
                  (activity.mealSource
                    ? MEAL_SOURCE_LABELS[activity.mealSource]
                    : "")}
              </p>
            )}
            {isCompleted && activity.closedAt && (
              <p className="text-[11px] text-muted-foreground">
                Completed{" "}
                <ClientTime
                  iso={activity.closedAt}
                  options={{ hour: "2-digit", minute: "2-digit" }}
                />
                {!expanded ? " · tap row to review" : ""}
              </p>
            )}
            {isActive && activity.openedAt && (
              <p className="text-[11px] text-muted-foreground">
                Opened{" "}
                <ClientTime
                  iso={activity.openedAt}
                  options={{ hour: "2-digit", minute: "2-digit" }}
                />
              </p>
            )}
            {activity.phase === "pending" && activity.mealSlot && (
              <p className="text-[11px] text-muted-foreground">
                {MEAL_SLOT_LABELS[activity.mealSlot]}
                {activity.mealSource
                  ? ` · ${MEAL_SOURCE_LABELS[activity.mealSource]}`
                  : ""}
              </p>
            )}
          </div>
          {(isActive || isCompleted) &&
            (expanded ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ))}
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          {activity.phase === "pending" && (
            <Button
              type="button"
              size="sm"
              className="h-11 min-h-11 gap-1"
              disabled={busy}
              onClick={() => setSheetOpen(true)}
            >
              <Play className="h-3.5 w-3.5" />
              Open
            </Button>
          )}
          {isActive && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-11 min-h-11 gap-1"
              disabled={busy}
              onClick={onComplete}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Complete
            </Button>
          )}
          {isCompleted && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 min-h-11 gap-1"
              onClick={() => setExpanded((v) => !v)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Done
            </Button>
          )}
        </div>
      </div>

      {isActive && expanded && (
        <div className="space-y-2 border-t px-3 pb-3 pt-2">
          <SiteDayMealServiceRoll
            activityId={activity.id}
            sessionId={activity.sessionId}
            editable
          />
        </div>
      )}

      {isCompleted && expanded && (
        <div className="border-t px-3 pb-3 pt-2">
          <MealServiceSummary
            kind="centre"
            activityId={activity.id}
            title={activity.title}
            mealSource={activity.mealSource}
            menuNotes={activity.menuNotes}
            preparedByStaffId={activity.preparedByStaffId}
            preparerCertStatus={activity.preparerCertStatus}
            preparerAckNote={activity.preparerAckNote}
            prepChecksCompleted={activity.prepChecksCompleted}
            prepAttestationMode={activity.prepAttestationMode}
            prepAttestedByStaffId={activity.prepAttestedByStaffId}
            guestPreparerName={activity.guestPreparerName}
            prepAttestationNote={activity.prepAttestationNote}
            openedAt={activity.openedAt}
            closedAt={activity.closedAt}
          />
        </div>
      )}

      <OpenMealSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={activity.title}
        initialSource={activity.mealSource}
        initialMenuNotes={activity.menuNotes}
        pending={busy}
        onConfirm={(payload) => onOpenMeal(payload)}
      />
    </li>
  );
}

function MedicationActivityCard({
  activity,
  busy,
  onOpen,
  onComplete,
  medExpanded,
  onToggleMed,
}: {
  activity: SiteDayActivity;
  busy: boolean;
  onOpen: () => void;
  onComplete: () => void;
  medExpanded: boolean;
  onToggleMed: () => void;
}) {
  const round = useTodaysMedicationRound();
  const isActive = activity.phase === "active";
  const canComplete = isActive && round.canCompleteRound;
  const flashRed = isActive && round.urgency === "red";
  const flashAmber = isActive && round.urgency === "amber";

  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-2.5",
        activity.phase === "completed" && "opacity-75",
        isActive && !flashRed && !flashAmber && "border-primary/50 bg-primary/5",
        flashAmber &&
          "animate-pulse border-amber-500 bg-amber-500/15 dark:border-amber-400",
        flashRed && "animate-pulse border-red-600 bg-red-600/15",
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 rounded-md p-2",
            flashRed
              ? "bg-red-600 text-white"
              : flashAmber
                ? "bg-amber-500 text-white"
                : "bg-muted",
          )}
        >
          <Pill className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-sm text-slate-900 dark:text-slate-50">
              {activity.title}
            </span>
            <Badge variant="outline" className="text-[10px] uppercase">
              {activity.phase}
            </Badge>
            {flashRed && (
              <Badge className="bg-red-600 text-[10px] uppercase text-white">
                Overdue
              </Badge>
            )}
            {flashAmber && (
              <Badge className="bg-amber-500 text-[10px] uppercase text-white">
                Due soon
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {round.isLoading
              ? "Loading medication requirements…"
              : round.outstandingCount > 0
                ? `${round.outstandingCount} dose${
                    round.outstandingCount === 1 ? "" : "s"
                  } still to manage before Complete`
                : "All checked-in medication managed — ready to complete"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {activity.phase === "pending" && (
            <Button
              type="button"
              size="sm"
              className="h-11 min-h-11 gap-1"
              disabled={busy}
              onClick={onOpen}
            >
              <Play className="h-3.5 w-3.5" />
              Open
            </Button>
          )}
          {isActive && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-11 min-h-11 gap-1"
              disabled={busy || !canComplete}
              title={
                canComplete
                  ? "Mark medication round complete"
                  : round.isLoading
                    ? "Wait until medication requirements finish loading"
                    : "Administer or resolve every outstanding dose first"
              }
              onClick={onComplete}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Complete
            </Button>
          )}
          {activity.phase === "completed" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 min-h-11 gap-1"
              disabled
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Done
            </Button>
          )}
        </div>
      </div>

      {isActive && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-0 text-xs"
            onClick={onToggleMed}
          >
            {medExpanded ? "Hide med list" : "Show med list"}
          </Button>
          {medExpanded && <TodaysMedicationCard />}
        </div>
      )}
    </li>
  );
}
