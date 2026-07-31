/**
 * BL-073 — read-only meal summary after Complete (Centre + Trips).
 * Shows what was served, preparer/SFH, and per-person outcomes/notes.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, UtensilsCrossed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ClientTime } from "@/components/ui/client-time";
import { listMealServiceRoll } from "@/lib/api/event-meal-service";
import { listSiteDayMealServiceRoll } from "@/lib/api/site-day-meal-service";
import { listParticipants, listStaffRegistry } from "@/lib/data-store";
import {
  MEAL_SOURCE_LABELS,
  type MealSource,
  type PrepAttestationMode,
  type PreparerCertStatus,
} from "@/lib/meal-open";
import { cn } from "@/lib/utils";

export type MealServiceSummaryProps = {
  title: string;
  mealSource: MealSource | null;
  menuNotes: string | null;
  preparedByStaffId: string | null;
  preparerCertStatus: PreparerCertStatus | null;
  preparerAckNote: string | null;
  prepChecksCompleted?: string[];
  prepAttestationMode?: PrepAttestationMode | null;
  prepAttestedByStaffId?: string | null;
  guestPreparerName?: string | null;
  prepAttestationNote?: string | null;
  openedAt: string | null;
  closedAt: string | null;
} & (
  | { kind: "trip"; venueStopId: string }
  | { kind: "centre"; activityId: string }
);

const STATUS_LABEL: Record<string, string> = {
  expected: "Expected",
  served: "Served",
  modified: "Modified",
  own_order: "Own order",
  declined: "Declined",
  na: "N/A",
};

const CERT_LABEL: Record<PreparerCertStatus, string> = {
  ok: "SFH OK",
  warn_missing: "SFH missing (acked)",
  warn_expired: "SFH expired (acked)",
  na: "SFH n/a",
};

export function MealServiceSummary(props: MealServiceSummaryProps) {
  const staffQ = useQuery({
    queryKey: ["staff_registry"],
    queryFn: listStaffRegistry,
    staleTime: 60_000,
  });
  const participantsQ = useQuery({
    queryKey: ["participants", "meal-summary"],
    queryFn: listParticipants,
    staleTime: 60_000,
  });

  const rollQ = useQuery({
    queryKey:
      props.kind === "trip"
        ? (["meal-service-roll", props.venueStopId] as const)
        : (["site-day-meal-service-roll", props.activityId] as const),
    queryFn: () =>
      props.kind === "trip"
        ? listMealServiceRoll(props.venueStopId)
        : listSiteDayMealServiceRoll(props.activityId),
  });

  const preparerName =
    (staffQ.data ?? []).find((s) => s.id === props.preparedByStaffId)?.fullName ??
    null;
  const attestorName =
    (staffQ.data ?? []).find((s) => s.id === props.prepAttestedByStaffId)
      ?.fullName ?? null;
  const byId = new Map((participantsQ.data ?? []).map((p) => [p.id, p]));
  const rows = rollQ.data ?? [];

  const counts = {
    served: rows.filter((r) => r.status === "served").length,
    modified: rows.filter((r) => r.status === "modified").length,
    own_order: rows.filter((r) => r.status === "own_order").length,
    declined: rows.filter((r) => r.status === "declined").length,
    na: rows.filter((r) => r.status === "na").length,
    expected: rows.filter((r) => r.status === "expected").length,
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Meal summary — read only
      </p>

      <div className="space-y-1.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <UtensilsCrossed className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{props.title}</span>
          {props.mealSource && (
            <Badge variant="secondary" className="text-[10px]">
              {MEAL_SOURCE_LABELS[props.mealSource]}
            </Badge>
          )}
        </div>

        {props.menuNotes?.trim() ? (
          <p className="text-sm text-slate-900 dark:text-slate-50">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What it was ·{" "}
            </span>
            {props.menuNotes.trim()}
          </p>
        ) : props.mealSource === "own_food" ? (
          <p className="text-xs text-muted-foreground">
            Brought own food — no group menu recorded.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No menu text recorded.</p>
        )}

        {(props.prepChecksCompleted?.length ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            Prep checks ·{" "}
            <span className="font-medium text-foreground">
              {props.prepChecksCompleted!.length} confirmed
            </span>
          </p>
        )}

        {props.guestPreparerName?.trim() ? (
          <p className="text-xs text-muted-foreground">
            Guest preparer{" "}
            <span className="font-medium text-foreground">
              {props.guestPreparerName.trim()}
            </span>
            {attestorName && (
              <>
                {" "}
                · attested by Manager{" "}
                <span className="font-medium text-foreground">{attestorName}</span>
              </>
            )}
          </p>
        ) : preparerName ? (
          <div className="text-xs text-muted-foreground">
            Prepared by{" "}
            <span className="font-medium text-foreground">{preparerName}</span>
            {props.preparerCertStatus && (
              <>
                {" "}
                ·{" "}
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    props.preparerCertStatus === "ok" &&
                      "border-emerald-600/50 text-emerald-800 dark:text-emerald-200",
                    (props.preparerCertStatus === "warn_missing" ||
                      props.preparerCertStatus === "warn_expired") &&
                      "border-amber-500/50 text-amber-900 dark:text-amber-100",
                  )}
                >
                  {CERT_LABEL[props.preparerCertStatus]}
                </Badge>
              </>
            )}
            {attestorName && props.prepAttestationMode === "preparer_pin" && (
              <> · PIN attested</>
            )}
          </div>
        ) : null}
        {props.preparerAckNote?.trim() && (
          <p className="text-xs text-amber-900 dark:text-amber-100">
            SFH Manager approval: {props.preparerAckNote.trim()}
          </p>
        )}
        {props.prepAttestationNote?.trim() && (
          <p className="text-xs text-amber-900 dark:text-amber-100">
            Manager override: {props.prepAttestationNote.trim()}
          </p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {props.openedAt && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Opened{" "}
              <ClientTime
                iso={props.openedAt}
                options={{ hour: "2-digit", minute: "2-digit" }}
              />
            </span>
          )}
          {props.closedAt && (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Closed{" "}
              <ClientTime
                iso={props.closedAt}
                options={{ hour: "2-digit", minute: "2-digit" }}
              />
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Who ate what
          </p>
          {!rollQ.isLoading && rows.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {counts.served} served
              {counts.modified ? ` · ${counts.modified} modified` : ""}
              {counts.own_order ? ` · ${counts.own_order} own order` : ""}
              {counts.declined ? ` · ${counts.declined} declined` : ""}
              {counts.na ? ` · ${counts.na} n/a` : ""}
              {counts.expected ? ` · ${counts.expected} outstanding` : ""}
            </Badge>
          )}
        </div>

        {rollQ.isLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 py-3 text-center text-xs text-muted-foreground">
            No serve-roll rows recorded for this meal.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {[...rows]
              .sort((a, b) => {
                const an = byId.get(a.participantId)?.fullName ?? "";
                const bn = byId.get(b.participantId)?.fullName ?? "";
                return an.localeCompare(bn);
              })
              .map((r) => {
                const name =
                  byId.get(r.participantId)?.fullName ?? "Participant";
                return (
                  <li
                    key={r.id}
                    className="rounded-md border px-2.5 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{name}</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase"
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </div>
                    {r.notes?.trim() && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {r.notes.trim()}
                      </p>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
  );
}
