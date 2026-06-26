import { useMemo, useState } from "react";
import { Search, ChevronRight, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { iddsiLevel } from "@/lib/iddsi";
import { dayChronoIndex } from "@/lib/data-store";
import { usePendingScheduleMap } from "@/hooks/use-pending-schedules";
import {
  useParticipantDirectoryIndicators,
  type ParticipantIndicators,
} from "@/hooks/use-participant-indicators";
import { GiveDoseModal } from "@/components/medication/give-dose-modal";
import type { MedicationSchedule, Participant } from "@/lib/data-store";

interface Props {
  participants: Participant[];
  onSelect: (p: Participant) => void;
  search: string;
  dayFilter: string; // 'all' | 'DAY-MON'…'DAY-FRI'
}

const DAY_SHORT: Record<string, string> = {
  "DAY-MON": "Mo",
  "DAY-TUE": "Tu",
  "DAY-WED": "We",
  "DAY-THU": "Th",
  "DAY-FRI": "Fr",
  "DAY-SAT": "Sa",
  "DAY-SUN": "Su",
};

const EMPTY_INDICATORS: ParticipantIndicators = { days: [], transport: false, meds: false };

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
      if (dayFilter !== "all" && !ind.days.includes(dayFilter)) return false;
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
                <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-accent/40">
                  <div className="min-w-0 flex-1">
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
                    <IndicatorChips ind={ind} className="mt-2" />
                    <IddsiChips p={p} className="mt-2" />
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Card>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Participant</th>
              <th className="px-4 py-3 font-medium">Expected Days</th>
              <th className="px-4 py-3 font-medium">Transport</th>
              <th className="px-4 py-3 font-medium">Meds</th>
              <th className="px-4 py-3 font-medium">IDDSI</th>
              <th className="px-4 py-3 font-medium sr-only">Actions</th>
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
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{p.fullName}</span>
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
                  <td className="px-4 py-3">
                    <DayChips days={ind.days} />
                  </td>
                  <td className="px-4 py-3">
                    {ind.transport && (
                      <Badge className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-600 text-white hover:bg-blue-600">
                        Bus
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {ind.meds && (
                      <Badge className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-600 text-white hover:bg-amber-600">
                        Meds
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <IddsiChips p={p} />
                  </td>
                  <td className="px-4 py-3 text-right">
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

function DayChips({ days }: { days: string[] }) {
  if (!days.length) return null;
  const sorted = [...days].sort((a, b) => dayChronoIndex(a) - dayChronoIndex(b));
  return (
    <div className="flex flex-wrap gap-1">
      {sorted.map((d) => (
        <span
          key={d}
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100"
          title={d}
        >
          {DAY_SHORT[d] ?? d.replace("DAY-", "")}
        </span>
      ))}
    </div>
  );
}

function IndicatorChips({ ind, className }: { ind: ParticipantIndicators; className?: string }) {
  if (!ind.days.length && !ind.transport && !ind.meds) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      <DayChips days={ind.days} />
      {ind.transport && (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-600 text-white">
          Bus
        </span>
      )}
      {ind.meds && (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-600 text-white">
          Meds
        </span>
      )}
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
