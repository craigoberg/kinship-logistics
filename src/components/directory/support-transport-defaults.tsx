/**
 * Staff / volunteer / carer Centre run — IN/OUT pills for days the centre is open.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import { useBusRunMap, useLookupParameters } from "@/hooks/use-supabase-data";
import {
  SELF_TRANSPORT_CODE,
  ScheduleTransportPills,
} from "@/components/transport/schedule-transport-pills";
import {
  SUPPORT_SCHEDULES_KEY,
  deactivateSupportSchedule,
  listSupportSchedulesForPerson,
  upsertSupportSchedule,
} from "@/lib/api/support-attendance";
import {
  RUN_PLANNING_PEOPLE_KEY,
  normalizeDayCode,
  type WeekBoardDayCode,
} from "@/lib/api/run-planning";
import {
  CENTRE_HOURS_QUERY_KEY,
  DAY_CODE_LABEL,
  DEFAULT_CENTRE_CLOSE,
  DEFAULT_CENTRE_OPEN,
  isKnownDayCode,
  listCentreHours,
} from "@/lib/api/centre-hours";
import type { SupportPersonKind } from "@/lib/support-person";

async function invalidateTransportQueries(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: SUPPORT_SCHEDULES_KEY }),
    qc.invalidateQueries({ queryKey: RUN_PLANNING_PEOPLE_KEY }),
    qc.invalidateQueries({ queryKey: ["bus-run-default-routes"] }),
  ]);
}

interface Props {
  personKind: SupportPersonKind;
  staffId?: string | null;
  carerId?: string | null;
  personName: string;
}

export function SupportTransportDefaults({
  personKind,
  staffId,
  carerId,
  personName,
}: Props) {
  const qc = useQueryClient();
  const { data: busRuns = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const { data: operatingDays = [], isLoading: daysLoading } = useLookupParameters(
    LOOKUP_CATEGORIES.operatingDay,
  );
  const busRunMap = useBusRunMap();
  const { data: centreHours = [] } = useQuery({
    queryKey: CENTRE_HOURS_QUERY_KEY,
    queryFn: listCentreHours,
    staleTime: 5 * 60_000,
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: [...SUPPORT_SCHEDULES_KEY, personKind, staffId ?? "", carerId ?? ""],
    queryFn: () => listSupportSchedulesForPerson({ staffId, carerId }),
  });

  const openDays = useMemo(() => {
    return operatingDays
      .map((d) => {
        const raw = d.code.trim().toUpperCase();
        const code = normalizeDayCode(raw);
        if (!code) return null;
        const full = isKnownDayCode(raw) ? DAY_CODE_LABEL[raw] : d.displayName;
        return { code, label: (full || d.displayName).slice(0, 3) };
      })
      .filter((d): d is { code: WeekBoardDayCode; label: string } => d != null);
  }, [operatingDays]);

  const byDay = new Map<WeekBoardDayCode, (typeof rows)[number]>();
  for (const s of rows) {
    const day = normalizeDayCode(s.dayOfWeek);
    if (day) byDay.set(day, s);
  }

  const saveDay = useMutation({
    mutationFn: async (input: {
      day: WeekBoardDayCode;
      inbound: string;
      outbound: string;
      existingId?: string;
    }) => {
      if (!input.inbound && !input.outbound) {
        if (input.existingId) await deactivateSupportSchedule(input.existingId);
        return;
      }
      const hours = centreHours.find((h) => normalizeDayCode(h.dayOfWeek) === input.day);
      await upsertSupportSchedule({
        id: input.existingId,
        personKind,
        staffId: personKind === "carer" ? null : staffId,
        carerId: personKind === "carer" ? carerId : null,
        dayOfWeek: input.day,
        inboundTransport: input.inbound || SELF_TRANSPORT_CODE,
        outboundTransport: input.outbound || SELF_TRANSPORT_CODE,
        expectedArrivalTime: hours?.openTime || DEFAULT_CENTRE_OPEN,
        expectedDepartureTime: hours?.closeTime || DEFAULT_CENTRE_CLOSE,
      });
    },
    onSuccess: async () => {
      await invalidateTransportQueries(qc);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openDayLabels = openDays.map((d) => d.label).join(" · ") || "no open days";

  return (
    <Accordion type="single" collapsible className="rounded-lg border border-border bg-muted/20">
      <AccordionItem value="centre-run" className="border-0">
        <AccordionTrigger className="px-3 py-3 hover:no-underline">
          <div className="text-left">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Centre run (IN / OUT)
            </div>
            <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
              Centre open {openDayLabels}. How {personName || "they"} get in and out.
            </p>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3">
      {isLoading || daysLoading ? (
        <p className="text-xs text-muted-foreground">Loading centre run…</p>
      ) : openDays.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No centre operating days on file. Set them in Admin → Lookups → Operating days.
        </p>
      ) : (
        <div className="space-y-3">
          {openDays.map((d) => {
            const existing = byDay.get(d.code);
            const inbound = existing?.inboundTransport ?? "";
            const outbound = existing?.outboundTransport ?? "";
            return (
              <div key={d.code} className="space-y-2 rounded-md border border-border bg-card px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{d.label}</span>
                  {existing ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={saveDay.isPending}
                      onClick={() =>
                        saveDay.mutate({
                          day: d.code,
                          inbound: "",
                          outbound: "",
                          existingId: existing.id,
                        })
                      }
                    >
                      Clear day
                    </Button>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    In
                  </p>
                  <ScheduleTransportPills
                    value={inbound}
                    busRuns={busRuns}
                    busRunMap={busRunMap}
                    invalid={false}
                    onSelect={(code) =>
                      saveDay.mutate({
                        day: d.code,
                        inbound: code,
                        outbound: outbound || code,
                        existingId: existing?.id,
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Out
                  </p>
                  <ScheduleTransportPills
                    value={outbound}
                    busRuns={busRuns}
                    busRunMap={busRunMap}
                    invalid={false}
                    onSelect={(code) =>
                      saveDay.mutate({
                        day: d.code,
                        inbound: inbound || code,
                        outbound: code,
                        existingId: existing?.id,
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
