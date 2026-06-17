import { useMemo, useState } from "react";
import { Search, ChevronRight, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { iddsiLevel } from "@/lib/iddsi";
import { usePendingScheduleMap } from "@/hooks/use-pending-schedules";
import type { Participant } from "@/lib/data-store";


interface Props {
  participants: Participant[];
  onSelect: (p: Participant) => void;
}

export function ParticipantTable({ participants, onSelect }: Props) {
  const [q, setQ] = useState("");
  const pending = usePendingScheduleMap();


  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return participants;
    return participants.filter(
      (p) =>
        p.fullName.toLowerCase().includes(needle) ||
        p.ndisNumber.toLowerCase().includes(needle),
    );
  }, [participants, q]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or NDIS number…"
          className="h-11 pl-9"
          aria-label="Search participants"
        />
      </div>

      {/* Mobile: card list */}
      <ul className="space-y-2 md:hidden">
        {filtered.map((p) => (
          <li key={p.id}>
            <button onClick={() => onSelect(p)} className="w-full text-left">
              <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-accent/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{p.fullName}</span>
                    {pending.has(p.id) && <PendingBadge />}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">NDIS {p.ndisNumber}</div>
                  <IddsiChips p={p} className="mt-2" />
                </div>

                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Card>
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Participant</th>
              <th className="px-4 py-3 font-medium">NDIS number</th>
              <th className="px-4 py-3 font-medium">IDDSI</th>
              <th className="px-4 py-3 font-medium sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                onClick={() => onSelect(p)}
                className="cursor-pointer border-t border-border transition-colors hover:bg-accent/40"
              >
                <td className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    <span>{p.fullName}</span>
                    {pending.has(p.id) && <PendingBadge />}
                  </div>
                </td>

                <td className="px-4 py-3 tabular-nums text-muted-foreground">{p.ndisNumber}</td>
                <td className="px-4 py-3">
                  <IddsiChips p={p} />
                </td>
                <td className="px-4 py-3 text-right">
                  <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No participants match "{q}".
        </div>
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
