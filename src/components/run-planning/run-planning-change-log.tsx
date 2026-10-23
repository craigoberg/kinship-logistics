/**
 * Newest-first list of who changed Run Planning IN/OUT.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ClientTime } from "@/components/ui/client-time";
import {
  PLANNING_SOURCE_LABEL,
  listRunPlanningChangeLog,
  RUN_PLANNING_CHANGE_LOG_KEY,
} from "@/lib/api/run-planning-changelog";

export function RunPlanningChangeLog() {
  const [search, setSearch] = useState("");
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: RUN_PLANNING_CHANGE_LOG_KEY,
    queryFn: () => listRunPlanningChangeLog(80),
    staleTime: 15_000,
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.personName, r.actorName, r.summary, PLANNING_SOURCE_LABEL[r.source] ?? r.source]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" />
          Change log
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Who changed IN/OUT, what they set, and when. Older rows from before this
          log will not name a person.
        </p>
      </div>

      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search person or who changed it…"
          className="h-11 pl-9"
          aria-label="Search run planning changes"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading changes…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          {rows.length === 0
            ? "No planning changes recorded yet. The next IN/OUT edit will appear here and in Admin → Activity log."
            : "No changes match this search."}
        </div>
      ) : (
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {visible.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-border bg-muted/20 px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-sm font-medium">{r.actorName}</span>
                <ClientTime
                  iso={r.createdAt}
                  className="text-xs tabular-nums text-muted-foreground"
                />
              </div>
              <p className="mt-0.5 text-sm">{r.summary}</p>
              <p className="text-[11px] text-muted-foreground">
                {PLANNING_SOURCE_LABEL[r.source] ?? r.source}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
