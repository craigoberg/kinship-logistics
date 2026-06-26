import { useMemo, useState } from "react";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { iddsiLevel } from "@/lib/iddsi";
import { dayChronoIndex } from "@/lib/data-store";
import { usePendingScheduleMap } from "@/hooks/use-pending-schedules";
import {
  useParticipantDirectoryIndicators,
  EMPTY_INDICATORS,
  type ParticipantIndicators,
  type DaySchedule,
  type TransportMethod,
} from "@/hooks/use-participant-indicators";
import { GiveDoseModal } from "@/components/medication/give-dose-modal";
import type { MedicationSchedule, Participant } from "@/lib/data-store";

interface Props {
  participants: Participant[];
  onSelect: (p: Participant) => void;
  search: string;
  dayFilter: string; // 'all' | 'DAY-MON'…'DAY-FRI'
}

const WEEK_DAYS: { code: string; short: string; long: string }[] = [
  { code: "DAY-MON", short: "Mon", long: "Monday" },
  { code: "DAY-TUE", short: "Tue", long: "Tuesday" },
  { code: "DAY-WED", short: "Wed", long: "Wednesday" },
  { code: "DAY-THU", short: "Thu", long: "Thursday" },
  { code: "DAY-FRI", short: "Fri", long: "Friday" },
];

const DAY_SHORT_2: Record<string, string> = {
  "DAY-MON": "Mo",
  "DAY-TUE": "Tu",
  "DAY-WED": "We",
  "DAY-THU": "Th",
  "DAY-FRI": "Fr",
  "DAY-SAT": "Sa",
  "DAY-SUN": "Su",
};

const TRANSPORT_LABEL: Record<TransportMethod, string> = {
  bus: "Bus",
  private: "Self",
  walk_in: "Walk",
  other: "—",
};

const TRANSPORT_CLASS: Record<TransportMethod, string> = {
  bus: "bg-blue-600 text-white",
  private: "bg-slate-500 text-white",
  walk_in: "bg-emerald-600 text-white",
  other: "bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

export function ParticipantTable({ participants, onSelect, search, dayFilter }: Props) {
  const [verifying, setVerifying] = useState<{
    schedule: MedicationSchedule;
    participantName: string;
  } | null>(null);
  const pending = usePendingScheduleMap();
  const { data: indicators } = useParticipantDirectoryIndicators();

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return participants.filter((p) => {
      const ind = indicators?.get(p.id) ?? EMPTY_INDICATORS;
      if (dayFilter !== "all" && !ind.schedule[dayFilter]) return false;
      if (!needle) return true;
      return (
        p.fullName.toLowerCase().includes(needle) ||
        p.ndisNumber.toLowerCase().includes(needle)
      );
    });
  }, [participants, search, dayFilter, indicators]);

  const getInd = (id: string) => indicators?.get(id) ?? EMPTY_INDICATORS;

  return (
    <div className="space-y-4">
      {/* Mobile: card list */}
      <ul className="space-y-2 md:hidden">
        {filtered.map((p) => {
          const ind = getInd(p.id);
          return (
            <li key={p.id}>
              <button onClick={() => onSelect(p)} className="w-full text-left">
                <Card className="flex items-start justify-between gap-3 p-4 transition-colors hover:bg-accent/40">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{p.fullName}</span>
                      {pending.has(p.id) && (
                        <PendingBadge
                          onClick={() =>
                            setVerifying({
                              schedule: pending.get(p.id)!,
                              participantName: p.fullName,
                            })
                          }
                        />
                      )}
                    </div>
                    <DailyTransportSummary ind={ind} />
                    <div className="flex flex-wrap gap-1.5">
                      <MedDayChips ind={ind} />
                      <IddsiChips p={p} />
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </Card>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Desktop: Mon-Fri grid */}
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Participant</th>
              {WEEK_DAYS.map((d) => (
                <th key={d.code} className="px-2 py-2 font-medium w-[88px]">
                  <div className="flex flex-col items-center leading-tight">
                    <span>{d.short}</span>
                    <span className="mt-0.5 grid grid-cols-2 gap-1 text-[9px] font-normal normal-case text-muted-foreground/80">
                      <span>In</span>
                      <span>Out</span>
                    </span>
                  </div>
                </th>
              ))}
              <th className="px-2 py-2 font-medium w-[120px]">Meds</th>
              <th className="px-3 py-2 font-medium">IDDSI</th>
              <th className="px-2 py-2 font-medium sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const ind = getInd(p.id);
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelect(p)}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-accent/40"
                >
                  <td className="px-3 py-2 font-medium">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{p.fullName}</span>
                      {pending.has(p.id) && (
                        <PendingBadge
                          onClick={() =>
                            setVerifying({
                              schedule: pending.get(p.id)!,
                              participantName: p.fullName,
                            })
                          }
                        />
                      )}
                    </div>
                  </td>
                  {WEEK_DAYS.map((d) => (
                    <td key={d.code} className="px-2 py-2 align-middle">
                      <DayCell day={ind.schedule[d.code]} />
                    </td>
                  ))}
                  <td className="px-2 py-2 align-middle">
                    <MedDayChips ind={ind} />
                  </td>
                  <td className="px-3 py-2">
                    <IddsiChips p={p} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No participants match the current filters.
        </div>
      )}

      <GiveDoseModal
        open={!!verifying}
        onOpenChange={(o) => !o && setVerifying(null)}
        schedule={verifying?.schedule ?? null}
        participantName={verifying?.participantName ?? ""}
      />
    </div>
  );
}

function DayCell({ day }: { day: DaySchedule | undefined }) {
  if (!day) return null;
  return (
    <div className="grid grid-cols-2 gap-1 w-full">
      <TransportBadge method={day.inbound} />
      <TransportBadge method={day.outbound} />
    </div>
  );
}

function TransportBadge({ method }: { method: TransportMethod }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded px-1 py-0.5 text-[10px] font-semibold ${TRANSPORT_CLASS[method]}`}
      title={TRANSPORT_LABEL[method]}
    >
      {TRANSPORT_LABEL[method]}
    </span>
  );
}

function MedDayChips({ ind }: { ind: ParticipantIndicators }) {
  if (ind.hasPrnOnly) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-600 text-white">
        PRN
      </span>
    );
  }
  if (!ind.medDays.length) return null;
  const sorted = [...ind.medDays].sort((a, b) => dayChronoIndex(a) - dayChronoIndex(b));
  return (
    <div className="flex flex-wrap gap-1">
      {sorted.map((d) => (
        <span
          key={d}
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-600 text-white"
          title={d}
        >
          {DAY_SHORT_2[d] ?? d.replace("DAY-", "")}
        </span>
      ))}
    </div>
  );
}

function DailyTransportSummary({ ind }: { ind: ParticipantIndicators }) {
  const codes = Object.keys(ind.schedule).sort(
    (a, b) => dayChronoIndex(a) - dayChronoIndex(b),
  );
  if (!codes.length) {
    return <p className="text-xs text-muted-foreground">No recurring schedule</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {codes.map((c) => {
        const d = ind.schedule[c];
        const short = DAY_SHORT_2[c] ?? c.replace("DAY-", "").slice(0, 2);
        return (
          <span
            key={c}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <span className="font-semibold">{short}:</span>
            <span>
              {TRANSPORT_LABEL[d.inbound]}/{TRANSPORT_LABEL[d.outbound]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function IddsiChips({ p, className }: { p: Participant; className?: string }) {
  const liq = iddsiLevel("liquids", p.iddsi.liquids);
  const food = iddsiLevel("foods", p.iddsi.foods);
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {liq && (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${liq.swatch} ${liq.text}`}>
          Liq L{liq.level}
        </span>
      )}
      {food && (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${food.swatch} ${food.text}`}>
          Food L{food.level}
        </span>
      )}
    </div>
  );
}

function PendingBadge({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex items-center gap-1 rounded-md border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/60 cursor-pointer"
      title="Open Medication Administration Verification"
      aria-label="Open Medication Administration Verification"
    >
      <AlertTriangle className="h-3 w-3" />
      Scheduled Care Pending
    </button>
  );
}
