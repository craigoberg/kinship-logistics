/**
 * One person per row, Mon–Fri IN/OUT. Edit opens that person’s record.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Search, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { useBusRunMap } from "@/hooks/use-supabase-data";
import { TransportCodeBadge } from "@/components/transport/schedule-transport-pills";
import {
  groupRunPlanningPeople,
  listRunPlanningRows,
  RUN_PLANNING_PEOPLE_KEY,
  WEEK_BOARD_DAYS,
  type RunPlanningPerson,
} from "@/lib/api/run-planning";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "participant", label: "Participants" },
  { value: "staff", label: "Staff" },
  { value: "volunteer", label: "Volunteers" },
  { value: "carer", label: "Carers" },
];

export function RunPlanningPeopleTable({
  onEdit,
}: {
  onEdit: (person: RunPlanningPerson) => void;
}) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const busRunMap = useBusRunMap();
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: RUN_PLANNING_PEOPLE_KEY,
    queryFn: listRunPlanningRows,
    staleTime: 15_000,
  });

  useRealtimeInvalidate({
    table: "participant_attendance_schedules",
    queryKeys: [RUN_PLANNING_PEOPLE_KEY],
  });
  useRealtimeInvalidate({
    table: "support_attendance_schedules",
    queryKeys: [RUN_PLANNING_PEOPLE_KEY, ["bus-run-default-routes"]],
  });

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupRunPlanningPeople(rows).filter((p) => {
      if (kindFilter !== "all" && p.personKind !== kindFilter) return false;
      if (!q) return true;
      return [p.name, p.roleLabel, p.address ?? ""].join(" ").toLowerCase().includes(q);
    });
  }, [rows, search, kindFilter]);

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" />
          Everyone on the board
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          One person per row. Pencil opens their Participant or Staff record to change IN/OUT.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name…"
            className="h-11 pl-9"
            aria-label="Search people on the run board"
          />
        </div>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="h-11 w-40" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading people…</p>
      ) : people.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          {rows.length === 0
            ? "No defaults yet. Set Transport IN/OUT on a participant schedule, or set Centre run on a Staff / carer record."
            : "No one matches these filters."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium" rowSpan={2}>
                  Person
                </th>
                {WEEK_BOARD_DAYS.map((d) => (
                  <th
                    key={d.code}
                    className="border-l border-border px-2 py-1 text-center font-medium"
                    colSpan={2}
                  >
                    {d.label}
                  </th>
                ))}
                <th className="w-12 px-2 py-2" rowSpan={2}>
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
              <tr>
                {WEEK_BOARD_DAYS.map((d) => (
                  <th
                    key={`${d.code}-io`}
                    className="border-l border-border px-2 py-1 text-center font-normal"
                    colSpan={2}
                  >
                    <span className="inline-flex w-full justify-around gap-2">
                      <span>In</span>
                      <span>Out</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.personKey} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.roleLabel}</div>
                  </td>
                  {WEEK_BOARD_DAYS.map((d) => {
                    const cell = p.cells[d.code];
                    return (
                      <td
                        key={`${p.personKey}-${d.code}`}
                        className="border-l border-border px-2 py-2"
                        colSpan={2}
                      >
                        {cell ? (
                          <div className="flex items-center justify-around gap-2">
                            <TransportCodeBadge code={cell.inboundTransport} runMap={busRunMap} />
                            <TransportCodeBadge code={cell.outboundTransport} runMap={busRunMap} />
                          </div>
                        ) : (
                          <div className="text-center text-xs text-muted-foreground/50">—</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 text-center">
                    <IconActionButton
                      tooltip={`Edit ${p.name} centre transport`}
                      onClick={() => onEdit(p)}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
